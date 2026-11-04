const { spawn } = require('child_process');
const { MongoClient } = require('mongodb');
const LogService = require('../LogService');

/**
 * MongoDB engine implementation.
 * Full backups use mongodump --archive --gzip.
 * Incremental backups dump a slice of local.oplog.rs.
 * PITR restores apply oplog slices via a temporary database.
 */
class MongoEngine {
  constructor() {
    this.name = 'mongodb';
    this.label = 'MongoDB';
    this.fullFileExtension = '.gz';
    this.incrementalFileExtension = '.oplog.gz';
    this.changeLogName = 'oplog';
  }

  isConfigured(settings) {
    return !!settings.mongoUrl;
  }

  /**
   * Name of the database being backed up (from the connection URL path)
   */
  getTargetName(settings) {
    try {
      const pathname = new URL(settings.mongoUrl).pathname;
      return decodeURIComponent(pathname.replace(/^\//, '').split('/')[0]) || 'all databases';
    } catch {
      const m = String(settings.mongoUrl).match(/\/([^/?]+)(\?|$)/);
      return m ? m[1] : 'unknown';
    }
  }

  assertConfigured(settings) {
    if (!settings.mongoUrl) {
      throw new Error('MongoDB URL not configured');
    }
  }

  /**
   * Test the MongoDB connection
   */
  async testConnection(settings) {
    this.assertConfigured(settings);
    let client;
    try {
      client = new MongoClient(settings.mongoUrl);
      await client.connect();
      const admin = client.db().admin();
      const serverInfo = await admin.serverStatus();
      const isReplicaSet = !!(serverInfo.repl && serverInfo.repl.setName);
      await client.close();
      return {
        success: true,
        message: 'Connection successful',
        details: {
          version: serverInfo.version,
          replicaSet: isReplicaSet ? serverInfo.repl.setName : false
        }
      };
    } catch (error) {
      if (client) await client.close().catch(() => {});
      return { success: false, message: error.message };
    }
  }

  /**
   * Check whether the change log needed for incremental backups / PITR is available.
   * For MongoDB this requires a replica set (oplog).
   */
  async checkIncrementalSupport(settings) {
    let client;
    try {
      this.assertConfigured(settings);
      client = new MongoClient(settings.mongoUrl);
      await client.connect();
      const admin = client.db().admin();
      const serverInfo = await admin.serverStatus();
      const isReplicaSet = !!(serverInfo.repl && serverInfo.repl.setName);
      const setName = serverInfo.repl?.setName || null;
      await client.close();
      return {
        supported: isReplicaSet,
        setName,
        label: 'Replica Set',
        message: isReplicaSet
          ? `Connected to replica set: ${setName}`
          : 'MongoDB is not configured as a replica set. Oplog-based incremental backups may not work correctly.'
      };
    } catch (error) {
      if (client) await client.close().catch(() => {});
      return { supported: false, label: 'Replica Set', error: error.message };
    }
  }

  /**
   * Run a full backup via mongodump
   */
  fullBackup(settings, outputPath) {
    this.assertConfigured(settings);
    return new Promise((resolve, reject) => {
      const args = [
        `--uri=${settings.mongoUrl}`,
        `--archive=${outputPath}`,
        '--gzip'
      ];

      console.log('[Command] mongodump', args.join(' '));

      const proc = spawn('mongodump', args);
      let stderr = '';

      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({});
        } else {
          reject(new Error(`mongodump failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to spawn mongodump: ${error.message}. Make sure MongoDB tools are installed.`));
      });
    });
  }

  /**
   * Create an incremental backup by dumping an oplog slice
   * (entries newer than the last backup's timestamp).
   */
  async incrementalBackup(settings, outputPath, lastBackup) {
    this.assertConfigured(settings);

    // Convert JS timestamp to Mongo Timestamp format (approximate).
    // mongodump --query requires Extended JSON v2.
    const lastTimeSec = Math.floor(lastBackup.timestamp / 1000);
    const query = `{ "ts": { "$gt": { "$timestamp": { "t": ${lastTimeSec}, "i": 0 } } } }`;

    console.log(`[MongoEngine] Incremental (oplog) backup. Query: ${query}`);
    await this.runOplogDump(settings.mongoUrl, outputPath, query);
    return {};
  }

  /**
   * Run mongodump specifically for oplog slicing
   */
  runOplogDump(mongoUrl, outputPath, query) {
    return new Promise((resolve, reject) => {
      let safeUrl = mongoUrl;
      if (!safeUrl.includes('authSource=')) {
        safeUrl += (safeUrl.includes('?') ? '&' : '?') + 'authSource=admin';
      }

      const args = [
        `--uri=${safeUrl}`,
        '--db=local',
        '--collection=oplog.rs',
        `--query=${query}`,
        `--archive=${outputPath}`,
        '--gzip'
      ];

      console.log('[Command] mongodump', args.join(' '));

      const proc = spawn('mongodump', args);
      let stderr = '';

      proc.stderr.on('data', d => stderr += d.toString());

      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`mongodump (oplog) failed: ${stderr}`));
      });

      proc.on('error', reject);
    });
  }

  /**
   * Restore a full backup archive via mongorestore
   */
  async restoreFull(settings, filePath) {
    this.assertConfigured(settings);
    await LogService.log('info', 'Running mongorestore...');
    return new Promise((resolve, reject) => {
      const args = [
        `--uri=${settings.mongoUrl}`,
        `--archive=${filePath}`,
        '--gzip',
        '--drop' // Overwrites existing data
      ];

      const restore = spawn('mongorestore', args);
      let stderr = '';
      restore.stderr.on('data', d => stderr += d.toString());

      restore.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`mongorestore failed: ${stderr}`));
      });

      restore.on('error', reject);
    });
  }

  /**
   * Apply an incremental backup (oplog slice)
   *
   * Strategy:
   * 1. Restore the oplog archive to a temporary database (contains local.oplog.rs)
   * 2. Read oplog entries and apply operations to the real database
   * 3. Clean up the temp database
   */
  async applyIncremental(settings, filePath) {
    this.assertConfigured(settings);
    const mongoUrl = settings.mongoUrl;
    await LogService.log('info', 'Applying incremental oplog slice...');

    const tempDbName = `_oplog_restore_temp_${Date.now()}`;
    let client = null;

    try {
      await LogService.log('info', 'Restoring oplog to temporary database...');
      await this.restoreOplogToTempDb(mongoUrl, filePath, tempDbName);

      await LogService.log('info', 'Connecting to MongoDB to apply oplog entries...');
      client = new MongoClient(mongoUrl);
      await client.connect();

      const tempDb = client.db(tempDbName);
      const collections = await tempDb.listCollections().toArray();
      console.log('[MongoEngine] Temp DB collections:', collections.map(c => c.name));

      let oplogCollectionName = null;
      for (const col of collections) {
        if (col.name.includes('oplog')) {
          oplogCollectionName = col.name;
          break;
        }
      }

      if (!oplogCollectionName) {
        await LogService.log('warning', 'No oplog collection found in temp database. Skipping incremental restore.');
        return;
      }

      const oplogCollection = tempDb.collection(oplogCollectionName);
      const oplogCount = await oplogCollection.countDocuments();

      await LogService.log('info', `Found ${oplogCount} oplog entries to apply`);

      if (oplogCount === 0) {
        await LogService.log('warning', 'Oplog is empty. No changes to apply.');
        return;
      }

      let appliedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      const cursor = oplogCollection.find().sort({ ts: 1 }); // Apply in order

      while (await cursor.hasNext()) {
        const op = await cursor.next();
        try {
          const applied = await this.applyOplogEntry(client, op);
          if (applied) {
            appliedCount++;
          } else {
            skippedCount++;
          }
        } catch (err) {
          console.error('[MongoEngine] Error applying oplog entry:', err.message);
          errorCount++;
        }
      }

      await LogService.log('success', `Incremental restore completed: ${appliedCount} applied, ${skippedCount} skipped, ${errorCount} errors`);

      await tempDb.dropDatabase();
      await LogService.log('info', 'Cleaned up temporary database');
    } catch (error) {
      await LogService.log('error', `Incremental restore failed: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        try {
          await client.db(tempDbName).dropDatabase();
        } catch (e) {}
        await client.close();
      }
    }
  }

  /**
   * Restore oplog archive to a temporary database
   */
  restoreOplogToTempDb(mongoUrl, archivePath, tempDbName) {
    return new Promise((resolve, reject) => {
      const args = [
        `--uri=${mongoUrl}`,
        `--archive=${archivePath}`,
        '--gzip',
        '--nsFrom=local.oplog.rs',
        `--nsTo=${tempDbName}.oplog`
      ];

      console.log('[Command] mongorestore (oplog to temp)', args.join(' '));

      const proc = spawn('mongorestore', args);
      let stderr = '';

      proc.stderr.on('data', d => {
        stderr += d.toString();
        console.log('[mongorestore]', d.toString());
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          console.log('[MongoEngine] mongorestore exit code:', code, 'stderr:', stderr);
          resolve(); // Continue anyway and check for data
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Apply a single oplog entry to the database
   */
  async applyOplogEntry(client, op) {
    const { op: opType, ns, o, o2 } = op;

    console.log(`[Oplog] Processing: op=${opType}, ns=${ns}, o=${JSON.stringify(o).substring(0, 100)}`);

    if (opType === 'n') {
      console.log('[Oplog] Skipping noop');
      return false;
    }

    if (!ns) {
      console.log('[Oplog] Skipping: no namespace');
      return false;
    }

    // Handle applyOps commands specially - these contain nested operations!
    if (opType === 'c' && o && o.applyOps && Array.isArray(o.applyOps)) {
      console.log(`[Oplog] Found applyOps with ${o.applyOps.length} nested operations`);
      let appliedCount = 0;
      for (const nestedOp of o.applyOps) {
        const nestedApplied = await this.applyNestedOp(client, nestedOp);
        if (nestedApplied) appliedCount++;
      }
      console.log(`[Oplog] Applied ${appliedCount}/${o.applyOps.length} nested operations`);
      return appliedCount > 0;
    }

    if (ns.startsWith('config.') || ns.startsWith('local.')) {
      console.log(`[Oplog] Skipping system namespace: ${ns}`);
      return false;
    }

    if (ns.startsWith('admin.')) {
      console.log(`[Oplog] Skipping admin namespace: ${ns}`);
      return false;
    }

    // Handle commands (like createCollection, createIndexes, drop, etc.)
    if (opType === 'c') {
      console.log(`[Oplog] Command operation: ${JSON.stringify(o)}`);
      const dbName = ns.split('.')[0];

      try {
        if (o.create) {
          console.log(`[Oplog] Creating collection: ${dbName}.${o.create}`);
          await client.db(dbName).createCollection(o.create);
          return true;
        } else if (o.drop) {
          console.log(`[Oplog] SKIPPING DROP command (would delete ${dbName}.${o.drop})`);
          return false;
        } else if (o.dropDatabase) {
          console.log(`[Oplog] SKIPPING dropDatabase command for ${dbName}`);
          return false;
        } else if (o.createIndexes) {
          console.log('[Oplog] Skipping createIndexes command');
          return false;
        } else {
          console.log(`[Oplog] Unknown command, skipping: ${JSON.stringify(o)}`);
          return false;
        }
      } catch (err) {
        console.log(`[Oplog] Command error (likely already exists): ${err.message}`);
        return false;
      }
    }

    const [dbName, ...collParts] = ns.split('.');
    const collName = collParts.join('.');

    if (!dbName || !collName || collName === '$cmd') {
      console.log(`[Oplog] Skipping invalid namespace: ${ns}`);
      return false;
    }

    const collection = client.db(dbName).collection(collName);

    try {
      switch (opType) {
        case 'i': // Insert
          console.log(`[Oplog] Inserting into ${ns}`);
          await collection.insertOne(o);
          return true;

        case 'u': // Update
          if (o2 && o2._id) {
            console.log(`[Oplog] Updating in ${ns}, _id=${o2._id}`);
            const hasOperators = Object.keys(o).some(k => k.startsWith('$'));
            if (hasOperators) {
              await collection.updateOne({ _id: o2._id }, o);
            } else {
              if (o.diff) {
                console.log('[Oplog] Update with diff format, attempting replaceOne');
                return false;
              }
              await collection.replaceOne({ _id: o2._id }, o, { upsert: true });
            }
            return true;
          }
          console.log('[Oplog] Update missing o2._id');
          return false;

        case 'd': // Delete
          if (o && o._id) {
            console.log(`[Oplog] Deleting from ${ns}, _id=${o._id}`);
            await collection.deleteOne({ _id: o._id });
            return true;
          }
          console.log('[Oplog] Delete missing o._id');
          return false;

        default:
          console.log(`[Oplog] Unknown operation type: ${opType}`);
          return false;
      }
    } catch (err) {
      if (err.code === 11000) {
        console.log(`[Oplog] Duplicate key in ${ns}, document already exists`);
        return false;
      }
      console.error(`[Oplog] Error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Apply a nested operation from inside an applyOps command
   */
  async applyNestedOp(client, nestedOp) {
    const { op: opType, ns, o, o2 } = nestedOp;

    if (!ns || ns.startsWith('admin.') || ns.startsWith('config.') || ns.startsWith('local.')) {
      return false;
    }

    const [dbName, ...collParts] = ns.split('.');
    const collName = collParts.join('.');

    if (!dbName || !collName) {
      return false;
    }

    const collection = client.db(dbName).collection(collName);

    try {
      switch (opType) {
        case 'i': // Insert
          console.log(`[Oplog/Nested] Inserting into ${ns}`);
          await collection.insertOne(o);
          return true;

        case 'u': // Update
          if (o2 && o2._id) {
            console.log(`[Oplog/Nested] Updating in ${ns}`);
            const hasOperators = Object.keys(o).some(k => k.startsWith('$'));
            if (hasOperators) {
              await collection.updateOne({ _id: o2._id }, o);
            } else {
              await collection.replaceOne({ _id: o2._id }, o, { upsert: true });
            }
            return true;
          }
          return false;

        case 'd': // Delete - skip during restore
          console.log(`[Oplog/Nested] SKIPPING delete in ${ns}`);
          return false;

        default:
          return false;
      }
    } catch (err) {
      if (err.code === 11000) {
        console.log(`[Oplog/Nested] Duplicate key in ${ns}, skipping`);
        return false;
      }
      console.error(`[Oplog/Nested] Error: ${err.message}`);
      return false;
    }
  }

  /**
   * Inspect a backup archive using mongorestore --dryRun
   * and parse the namespace list from its output.
   */
  inspect(settings, filePath) {
    this.assertConfigured(settings);
    const args = [
      `--uri=${settings.mongoUrl}`,
      `--archive=${filePath}`,
      '--gzip',
      '--dryRun',
      '--verbose' // verbose is needed to see the namespaces
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn('mongorestore', args);
      let output = '';

      proc.stderr.on('data', d => output += d.toString());
      proc.stdout.on('data', d => output += d.toString());

      proc.on('close', () => {
        // Strip ANSI codes
        // eslint-disable-next-line no-control-regex
        const cleanOutput = output.replace(/\[[0-9;]*m/g, '');

        const structure = {};
        const lines = cleanOutput.split('\n');

        for (const line of lines) {
          let match = line.match(/restoring\s+([^\s\.]+)\.([^\s]+)\s+from/);

          if (!match) {
            match = line.match(/restoring\s+["']?([^"'\s\.]+)["']?\.["']?([^"'\s]+)["']?\s+from/);
          }

          if (!match) {
            match = line.match(/archive prelude ([^\s\.]+)\.([^\s]+)/);
          }

          if (!match) {
            match = line.match(/found collection metadata from ([^\s\.]+)\.([^\s]+) to restore to/);
          }

          if (!match && (line.toLowerCase().includes('restoring') || line.toLowerCase().includes('reading'))) {
            const potentialMatches = line.matchAll(/\b([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\b/g);
            for (const m of potentialMatches) {
              const db = m[1];
              const col = m[2];
              if (col === 'gz' || col === 'json' || col === 'bson' || db === 'from' || db === 'archive') continue;

              if (!structure[db]) structure[db] = [];
              if (!structure[db].includes(col)) structure[db].push(col);
            }
            continue;
          }

          if (match) {
            const dbName = match[1];
            const colName = match[2];

            if (!structure[dbName]) structure[dbName] = [];
            if (!structure[dbName].includes(colName)) structure[dbName].push(colName);
          }
        }

        // Fallback: If structure is empty, look for "creating collection <db>.<collection>"
        if (Object.keys(structure).length === 0) {
          for (const line of lines) {
            const match = line.match(/(?:reading|creating)\s+(?:metadata for )?["']?([^"'\s\.]+)["']?\.["']?([^"'\s]+)["']?/);
            if (match) {
              if (line.includes('index')) continue;
              const dbName = match[1];
              const colName = match[2];

              if (!structure[dbName]) structure[dbName] = [];
              if (!structure[dbName].includes(colName)) structure[dbName].push(colName);
            }
          }
        }

        for (const db in structure) {
          if (structure[db].length === 0) delete structure[db];
        }

        resolve({
          structure,
          rawOutput: cleanOutput.length > 5000 ? cleanOutput.substring(0, 5000) + '...' : cleanOutput
        });
      });

      proc.on('error', reject);
    });
  }
}

module.exports = new MongoEngine();
