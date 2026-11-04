const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { createWriteStream, createReadStream, existsSync } = require('fs');
const tar = require('tar');
const { MongoClient } = require('mongodb');
const Database = require('better-sqlite3');
const LogService = require('./LogService');
const FtpService = require('./FtpService');
const SettingsService = require('./SettingsService');
const EncryptionService = require('./EncryptionService');

class BackupService {
  constructor() {
    this.backupDir = path.join(process.cwd(), 'data', 'backups');
    this.dbPath = path.join(process.cwd(), 'data', 'backups.db');
    this.db = null;
    this.currentBackup = null;
  }

  async init() {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });
      
      // Initialize backup metadata database
      this.db = new Database(this.dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS backups (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          type TEXT NOT NULL,
          size INTEGER,
          status TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          ftp_path TEXT,
          local_path TEXT,
          error TEXT,
          completed_at INTEGER,
          encrypted INTEGER DEFAULT 0,
          base_backup_id TEXT,
          oplog_start_ts INTEGER,
          oplog_end_ts INTEGER
        )
      `);
      
      // Migration: Add columns if they don't exist (for existing databases)
      const migrations = [
        'ALTER TABLE backups ADD COLUMN encrypted INTEGER DEFAULT 0',
        'ALTER TABLE backups ADD COLUMN base_backup_id TEXT',
        'ALTER TABLE backups ADD COLUMN oplog_start_ts INTEGER',
        'ALTER TABLE backups ADD COLUMN oplog_end_ts INTEGER'
      ];
      
      for (const migration of migrations) {
        try {
          this.db.prepare(migration).run();
        } catch (e) {
          // Column likely already exists
        }
      }
      
      console.log('Backup service initialized with PITR support');
    } catch (error) {
      console.error('Failed to initialize backup service:', error);
      throw error;
    }
  }

  /**
   * Generate unique backup ID
   */
  generateBackupId() {
    return `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a full MongoDB backup
   */
  async createFullBackup() {
    const backupId = this.generateBackupId();
    const timestamp = Date.now();
    const filename = `full_${new Date(timestamp).toISOString().replace(/:/g, '-').split('.')[0]}.gz`;
    const localPath = path.join(this.backupDir, filename);
    
    try {
      await LogService.log('info', 'Starting full backup', {
        backup_id: backupId,
        type: 'full',
        status: 'started'
      });
      
      // Save initial metadata
      this.saveBackupMetadata({
        id: backupId,
        filename,
        type: 'full',
        size: 0,
        status: 'in_progress',
        timestamp,
        local_path: localPath
      });
      
      this.currentBackup = { id: backupId, type: 'full' };
      
      // Get settings
      const settings = await SettingsService.getAll();
      const mongoUrl = settings.mongoUrl;
      const enableEncryption = settings.enableEncryption; // Assuming this setting exists now
      
      if (!mongoUrl) {
        throw new Error('MongoDB URL not configured');
      }
      
      let dumpPath = localPath;
      let tempPath = null;
      
      if (enableEncryption) {
          // If encryption enabled, dump to temp file first
          tempPath = localPath + '.temp';
          dumpPath = tempPath;
      }
      
      // Use mongodump to create backup
      await this.runMongodump(mongoUrl, dumpPath);
      
      // Encrypt if enabled
      if (enableEncryption) {
          await LogService.log('info', 'Encrypting backup...', { backup_id: backupId });
          await EncryptionService.encryptFile(dumpPath, localPath);
          // Remove temp file
          await fs.unlink(dumpPath);
      }
      
      // Get file size
      const stats = await fs.stat(localPath);
      const size = stats.size;
      
      await LogService.log('success', 'Backup created successfully', {
        backup_id: backupId,
        type: 'full',
        status: 'completed',
        details: { size, filename, encrypted: !!enableEncryption }
      });
      
      // Upload to FTP
      const ftpResult = await this.uploadToFtp(backupId, localPath, filename);
      
      // Update metadata
      this.updateBackupMetadata(backupId, {
        size,
        status: ftpResult.success ? 'completed' : 'ftp_failed',
        ftp_path: ftpResult.remotePath,
        completed_at: Date.now(),
        encrypted: !!enableEncryption ? 1 : 0 // Add encrypted flag
      });
      
      // Clean up local file if configured
      await this.cleanupLocalBackup(backupId, localPath);
      
      // Apply retention policy
      await this.applyRetentionPolicy();
      
      this.currentBackup = null;
      
      return {
        success: true,
        backupId,
        filename,
        size,
        ftpPath: ftpResult.remotePath
      };
      
    } catch (error) {
      await LogService.log('error', `Full backup failed: ${error.message}`, {
        backup_id: backupId,
        type: 'full',
        status: 'failed',
        details: { error: error.message }
      });
      
      this.updateBackupMetadata(backupId, {
        status: 'failed',
        error: error.message,
        completed_at: Date.now()
      });
      
      this.currentBackup = null;
      
      throw error;
    }
  }

  /**
   * Create an incremental MongoDB backup
   * Uses change streams if available (replica set), otherwise falls back to timestamp-based
   */
  /**
   * Create an incremental MongoDB backup (Oplog Slice)
   * PBM Style: Dumps 'local.oplog.rs' entries newer than the last backup.
   */
  async createIncrementalBackup() {
    const backupId = this.generateBackupId();
    const timestamp = Date.now();
    // Filename format: incremental_START_END.oplog.gz
    const lastBackup = this.getLastCompletedBackup();
    
    // If no full backup exists, enforce full backup
    if (!lastBackup) {
        throw new Error('No full backup found. Please create a full backup first.');
    }

    // Get last timestamp (Timestamp type in Mongo, but we store as number/ISO in DB)
    // In a real PBM setup, we'd store the specific BSON Timestamp (high/low bits).
    // For this implementation, we'll try to rely on wall clock time -> BSON Timestamp conversion 
    // OR just use the text-based query if possible. 
    // better: use last backup's timestamp.
    
    // Note: This relies on the system clocks being somewhat synced or having a margin of safety.
    // MongoDB Timestamps are seconds + increment.
    
    // We will use mongodump with --query to dump oplog entries > last backup time.
    
    // Convert JS timestamp to Mongo Timestamp format (approximate)
    // approximate: { $gt: new Timestamp(lastBackup.timestamp / 1000, 0) }
    // mongodump --query requires JSON. Extended JSON v2: { "ts": { "$gt": { "$timestamp": { "t": <sec>, "i": 0 } } } }
    
    const lastTimeSec = Math.floor(lastBackup.timestamp / 1000);
    const query = `{ "ts": { "$gt": { "$timestamp": { "t": ${lastTimeSec}, "i": 0 } } } }`;

    const filename = `incremental_${lastBackup.timestamp}_${timestamp}.oplog.gz`;
    const localPath = path.join(this.backupDir, filename);
    const tempPath = localPath + '.temp'; // For encryption flow

    console.log(`[Backup] Starting Incremental (Oplog) Backup ${backupId}. Query: ${query}`);

    try {
      await LogService.log('info', 'Starting incremental (oplog) backup', {
        backup_id: backupId,
        type: 'incremental',
        status: 'started',
        details: { base_backup: lastBackup.id, query }
      });
      
      this.saveBackupMetadata({
        id: backupId,
        filename,
        type: 'incremental',
        size: 0,
        status: 'in_progress',
        timestamp,
        local_path: localPath
      });
      
      this.currentBackup = { id: backupId, type: 'incremental' };
      
      const settings = await SettingsService.getAll();
      const mongoUrl = settings.mongoUrl;
      const enableEncryption = settings.enableEncryption;

      // 1. Dump Oplog Slice
      // We dump directly to file (or temp file if encryption is on)
      const dumpTarget = enableEncryption ? tempPath : localPath;
      
      // We are dumping ONLY the oplog.rs collection from local db
      await this.runOplogDump(mongoUrl, dumpTarget, query);

      // 2. Encrypt if enabled
      if (enableEncryption) {
          await LogService.log('info', 'Encrypting oplog slice...', { backup_id: backupId });
          await EncryptionService.encryptFile(dumpTarget, localPath);
          await fs.unlink(dumpTarget);
      }

      // 3. Stats & Metadata
      let size = 0;
      if (existsSync(localPath)) {
          const stats = await fs.stat(localPath);
          size = stats.size;
      } else {
          // If file doesn't exist but mongodump succeeded, it implies no data was dumped (empty query result)
          // We can mark this as "completed" but with 0 size, or "skipped"?
          // Better to mark as completed (empty incremental is valid state: nothing changed)
          // BUT: if we want to support restore, we usually need a file. 
          // If mongodump didn't create a file, we can't upload anything.
          
          // Let's create an empty placeholder file so flow continues, OR just abort and say "No changes"
          // If we abort, we should delete the 'failed' entry or mark it 'skipped'.
          
          await LogService.log('info', 'No changes found since last backup (oplog slice empty).', { backup_id: backupId });
          
          this.updateBackupMetadata(backupId, {
              status: 'skipped', // or completed?
              completed_at: Date.now(),
              error: 'No changes detected'
          });
          this.currentBackup = null;
          return; 
      }

      // Upload to FTP
      const ftpResult = await this.uploadToFtp(backupId, localPath, filename);

      this.updateBackupMetadata(backupId, {
        size,
        status: ftpResult.success ? 'completed' : 'ftp_failed',
        ftp_path: ftpResult.remotePath,
        completed_at: Date.now(),
        encrypted: !!enableEncryption ? 1 : 0
      });

      await this.cleanupLocalBackup(backupId, localPath);
      await this.applyRetentionPolicy();

      this.currentBackup = null;

      await LogService.log('success', 'Incremental backup (oplog slice) completed', {
        backup_id: backupId,
        size
      });

      return {
          success: true,
      backupId,
          size
      };

    } catch (error) {
       await LogService.log('error', `Incremental backup failed: ${error.message}`, {
        backup_id: backupId
      });
      
      // Cleanup: Delete the failed entry and files so user doesn't see "failed" garbage
      try {
          // We can reuse deleteBackup method if it exists, or manually clean up
          await this.deleteBackup(backupId);
          await LogService.log('info', `Cleaned up failed backup artifact: ${backupId}`);
      } catch (cleanupError) {
          console.error('Failed to cleanup failed backup:', cleanupError);
      }
      
      this.updateBackupMetadata(backupId, {
        status: 'failed',
        error: error.message,
        completed_at: Date.now()
      });
      
      // Cleanup temp
      if (existsSync && await fs.stat(tempPath).catch(()=>false)) await fs.unlink(tempPath);
      
      this.currentBackup = null;
      throw error;
    }
  }

  /**
   * Run mongodump specifically for oplog slicing
   */
  runOplogDump(mongoUrl, outputPath, query) {
      return new Promise((resolve, reject) => {
          // We need to parse mongoUrl to insert /local or just pass --db=local
          // mongodump args:
          // --db=local --collection=oplog.rs --query='...' --archive=... --gzip
          
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
   * Run mongodump command
   */
  runMongodump(mongoUrl, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        `--uri=${mongoUrl}`,
        `--archive=${outputPath}`,
        '--gzip'
      ];
      
      console.log('[Command] mongodump', args.join(' '));
      
      const mongodump = spawn('mongodump', args);
      
      let stderr = '';
      
      mongodump.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      mongodump.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`mongodump failed with code ${code}: ${stderr}`));
        }
      });
      
      mongodump.on('error', (error) => {
        reject(new Error(`Failed to spawn mongodump: ${error.message}. Make sure MongoDB tools are installed.`));
      });
    });
  }

  /**
   * Check if change streams are supported (requires replica set)
   */
  async checkChangeStreamSupport(mongoUrl) {
    let client;
    try {
      client = new MongoClient(mongoUrl);
      await client.connect();
      
      const admin = client.db().admin();
      const serverInfo = await admin.serverStatus();
      
      // Check if running as replica set
      const isReplicaSet = serverInfo.repl && serverInfo.repl.setName;
      
      await client.close();
      
      return isReplicaSet;
    } catch (error) {
      if (client) {
        await client.close();
      }
      return false;
    }
  }

  /**
   * Incremental backup using change streams (requires replica set)
   * Note: This is a simplified implementation. In production, you'd want to:
   * 1. Store resume tokens to track where you left off
   * 2. Handle very large change sets
   * 3. Consider using oplog directly for better performance
   */
  async incrementalWithChangeStreams(mongoUrl, outputDir, backupId) {
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      
      // Get last backup timestamp
      const lastBackup = this.getLastCompletedBackup();
      const resumeTime = lastBackup ? new Date(lastBackup.timestamp) : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
      
      const db = client.db();
      const collections = await db.listCollections().toArray();
      
      let totalChanges = 0;
      
      // For each collection, export changed documents
      for (const collInfo of collections) {
        const collName = collInfo.name;
        
        // Skip system collections
        if (collName.startsWith('system.')) continue;
        
        const collection = db.collection(collName);
        
        // Since we can't easily replay change streams from the past,
        // we'll use a timestamp-based approach instead
        // In a real implementation, you'd need to continuously monitor change streams
        // and store changes incrementally
        
        const query = {
          $or: [
            { updatedAt: { $gte: resumeTime } },
            { createdAt: { $gte: resumeTime } },
            { _id: { $gte: resumeTime } } // For collections without timestamp fields
          ]
        };
        
        const docs = await collection.find(query).toArray();
        
        if (docs.length > 0) {
          const outputFile = path.join(outputDir, `${collName}.json`);
          await fs.writeFile(outputFile, JSON.stringify(docs, null, 2));
          totalChanges += docs.length;
        }
      }
      
      // Save metadata file
      const metadataFile = path.join(outputDir, 'backup_metadata.json');
      await fs.writeFile(metadataFile, JSON.stringify({
        backupId,
        type: 'incremental',
        method: 'change_streams_fallback',
        timestamp: Date.now(),
        resumeTime: resumeTime.toISOString(),
        totalChanges
      }, null, 2));
      
      await client.close();
      
      return totalChanges;
    } catch (error) {
      if (client) {
        await client.close();
      }
      throw error;
    }
  }

  /**
   * Incremental backup using timestamp-based approach (fallback)
   */
  async incrementalWithTimestamp(mongoUrl, outputDir, backupId) {
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      
      // Get last backup timestamp
      const lastBackup = this.getLastCompletedBackup();
      const lastTime = lastBackup ? new Date(lastBackup.timestamp) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const db = client.db();
      const collections = await db.listCollections().toArray();
      
      let totalChanges = 0;
      
      for (const collInfo of collections) {
        const collName = collInfo.name;
        
        // Skip system collections
        if (collName.startsWith('system.')) continue;
        
        const collection = db.collection(collName);
        
        // Try multiple timestamp field names
        const query = {
          $or: [
            { updatedAt: { $gte: lastTime } },
            { updated_at: { $gte: lastTime } },
            { createdAt: { $gte: lastTime } },
            { created_at: { $gte: lastTime } },
            { timestamp: { $gte: lastTime } }
          ]
        };
        
        const docs = await collection.find(query).toArray();
        
        if (docs.length > 0) {
          const outputFile = path.join(outputDir, `${collName}.json`);
          await fs.writeFile(outputFile, JSON.stringify(docs, null, 2));
          totalChanges += docs.length;
        }
      }
      
      // Save metadata file
      const metadataFile = path.join(outputDir, 'backup_metadata.json');
      await fs.writeFile(metadataFile, JSON.stringify({
        backupId,
        type: 'incremental',
        method: 'timestamp_based',
        timestamp: Date.now(),
        lastBackupTime: lastTime.toISOString(),
        totalChanges
      }, null, 2));
      
      await client.close();
      
      return totalChanges;
    } catch (error) {
      if (client) {
        await client.close();
      }
      throw error;
    }
  }

  /**
   * Compress directory to tar.gz
   */
  async compressDirectory(sourceDir, outputFile) {
    return tar.create(
      {
        gzip: true,
        file: outputFile,
        cwd: sourceDir
      },
      await fs.readdir(sourceDir)
    );
  }

  /**
   * Upload backup to FTP
   */
  async uploadToFtp(backupId, localPath, filename) {
    try {
      const settings = await SettingsService.getAll();
      if (!settings.ftpHost) {
        return { success: true, skipped: true, message: 'FTP not configured, upload skipped' };
      }

      const remotePath = path.posix.join(
        new Date().toISOString().split('T')[0], // YYYY-MM-DD
        filename
      );
      
      const result = await FtpService.upload(localPath, remotePath);
      
      return result;
    } catch (error) {
      await LogService.log('error', `FTP upload failed for backup ${backupId}`, {
        backup_id: backupId,
        details: { error: error.message }
      });
      
      return { success: false, message: error.message };
    }
  }

  /**
   * Clean up local backup file if configured
   */
  async cleanupLocalBackup(backupId, localPath) {
    try {
      const settings = await SettingsService.getAll();
      
      if (!settings.keepLocalBackups) {
        await fs.unlink(localPath);
        await LogService.log('info', `Local backup file deleted: ${localPath}`, {
          backup_id: backupId
        });
      }
    } catch (error) {
      await LogService.log('warning', `Failed to delete local backup: ${error.message}`, {
        backup_id: backupId
      });
    }
  }

  /**
   * Apply retention policy - Smart version that protects backup chains
   * 
   * Key behaviors:
   * 1. Always keeps at least one full backup (required for PITR)
   * 2. Applies retention separately for full and incremental backups
   * 3. Never deletes a full backup if incremental backups depend on it
   * 4. Deletes orphaned incrementals (those without a valid full backup base)
   */
  async applyRetentionPolicy() {
    try {
      const settings = await SettingsService.getAll();
      const { keepLastNBackups, retentionDays } = settings;
      
      // Get all backups ordered by timestamp (newest first)
      const allBackups = this.db.prepare(
        'SELECT * FROM backups WHERE status = ? ORDER BY timestamp DESC'
      ).all('completed');
      
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      // Separate full and incremental backups
      const fullBackups = allBackups.filter(b => b.type === 'full');
      const incrementalBackups = allBackups.filter(b => b.type === 'incremental');
      
      // Always keep at least 1 full backup for PITR functionality
      const minFullBackupsToKeep = 1;
      
      // Calculate how many of each type to keep
      // Use intelligent split: prioritize keeping full backups
      const fullBackupsToKeep = Math.max(minFullBackupsToKeep, Math.min(fullBackups.length, Math.ceil(keepLastNBackups * 0.1))); // Keep ~10% of limit as full backups
      const incrementalBackupsToKeep = Math.max(0, keepLastNBackups - fullBackupsToKeep);
      
      const toDelete = [];
      
      // Find which full backups have dependent incrementals
      const getLatestFullBackupBefore = (timestamp) => {
        return fullBackups.find(f => f.timestamp < timestamp);
      };
      
      const fullBackupsWithDependents = new Set();
      incrementalBackups.forEach(inc => {
        const baseFull = getLatestFullBackupBefore(inc.timestamp);
        if (baseFull) {
          fullBackupsWithDependents.add(baseFull.id);
        }
      });
      
      // Process full backups - apply retention but protect those with dependents
      fullBackups.forEach((backup, index) => {
        // Always keep the latest full backup (index 0)
        if (index === 0) {
          return;
        }
        
        // Check if this full backup should be deleted
        const shouldDeleteByCount = index >= fullBackupsToKeep;
        const shouldDeleteByAge = backup.timestamp < cutoffTime;
        
        if (shouldDeleteByCount || shouldDeleteByAge) {
          // Only delete if no incrementals depend on this full backup
          if (!fullBackupsWithDependents.has(backup.id)) {
            toDelete.push(backup);
          }
        }
      });
      
      // Process incremental backups - apply retention
      incrementalBackups.forEach((backup, index) => {
        // Check if this incremental should be deleted
        const shouldDeleteByCount = index >= incrementalBackupsToKeep;
        const shouldDeleteByAge = backup.timestamp < cutoffTime;
        
        if (shouldDeleteByCount || shouldDeleteByAge) {
          toDelete.push(backup);
          
          // After marking for deletion, check if we should also delete its parent full backup
          // (only if this was the last dependent incremental)
          const baseFull = getLatestFullBackupBefore(backup.timestamp);
          if (baseFull) {
            const remainingDependents = incrementalBackups.filter(
              inc => !toDelete.includes(inc) && getLatestFullBackupBefore(inc.timestamp)?.id === baseFull.id
            );
            
            if (remainingDependents.length === 0) {
              fullBackupsWithDependents.delete(baseFull.id);
            }
          }
        }
      });
      
      // Delete orphaned incrementals (those whose base full backup no longer exists)
      const fullBackupIds = new Set(fullBackups.map(f => f.id));
      incrementalBackups.forEach(inc => {
        const baseFull = getLatestFullBackupBefore(inc.timestamp);
        if (!baseFull || !fullBackupIds.has(baseFull.id)) {
          if (!toDelete.includes(inc)) {
            toDelete.push(inc);
          }
        }
      });
      
      // Execute deletions
      for (const backup of toDelete) {
        await this.deleteBackup(backup.id);
      }
      
      if (toDelete.length > 0) {
        await LogService.log('info', `Retention policy applied: deleted ${toDelete.length} old backups`);
      }
    } catch (error) {
      await LogService.log('error', `Failed to apply retention policy: ${error.message}`);
    }
  }


  /**
   * Delete a backup (local and FTP)
   */
  async deleteBackup(backupId) {
    try {
      const backup = this.getBackupById(backupId);
      
      if (!backup) {
        return { success: false, message: 'Backup not found' };
      }
      
      // Delete local file
      if (backup.local_path) {
        try {
          await fs.unlink(backup.local_path);
        } catch (error) {
          // File might not exist
        }
      }
      
      // Delete from FTP
      if (backup.ftp_path) {
        await FtpService.delete(backup.ftp_path);
      }
      
      // Delete from database
      this.db.prepare('DELETE FROM backups WHERE id = ?').run(backupId);
      
      await LogService.log('info', `Backup deleted: ${backupId}`, {
        backup_id: backupId
      });
      
      return { success: true };
    } catch (error) {
      await LogService.log('error', `Failed to delete backup ${backupId}: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get all backups
   */
  getAllBackups() {
    return this.db.prepare('SELECT * FROM backups ORDER BY timestamp DESC').all();
  }

  /**
   * Inspect a backup to list its contents (Databases & Collections)
   * Uses mongorestore --dryRun to peek inside the archive.
   */
  async inspectBackup(backupId) {
    const backup = this.getBackupById(backupId);
    if (!backup) throw new Error('Backup not found');

    // Handle skipped or empty backups immediately
    if (backup.status === 'skipped' || (backup.size === 0 && !backup.ftp_path && !backup.local_path)) {
        return {
            backupId,
            structure: {},
            rawOutput: "This backup is empty or was skipped because no changes were detected."
        };
    }

    let localPath = backup.local_path;
    let tempFtpPath = null;
    let inspectPath = null;
    let tempDecryptedPath = null;

    try {
        // 1. Check if local file exists, if not try to download from FTP
        if (!existsSync(localPath)) {
            if (backup.ftp_path) {
                console.log(`[Inspect] Local file missing, downloading from FTP: ${backup.ftp_path}`);
                tempFtpPath = path.join(this.backupDir, `temp_inspect_${backupId}_${Date.now()}.gz`);
                
                // We need to require FtpService here or ensure it's available
                // It is required at the top of the file as 'FtpService'
                const result = await FtpService.download(backup.ftp_path, tempFtpPath);
                
                if (!result.success) {
                    throw new Error(`Failed to download backup for inspection: ${result.message}`);
                }
                
                localPath = tempFtpPath; // Use the downloaded file as localPath
            } else {
                throw new Error('Local backup file not found and no FTP path available');
            }
        }

        inspectPath = localPath;

        // 2. Decrypt if needed
        if (backup.encrypted) {
            tempDecryptedPath = localPath + '.inspect_temp';
            await EncryptionService.decryptFile(localPath, tempDecryptedPath);
            inspectPath = tempDecryptedPath;
        }

        // 3. Run mongorestore --dryRun
        // We use --dryRun --verbose to see what it WOULD restore
        // NOTE: mongorestore --dryRun still needs a MongoDB connection to validate the restore
        const settings = await SettingsService.getAll();
        const mongoUrl = settings.mongoUrl;
        
        if (!mongoUrl) {
            throw new Error('MongoDB URL not configured. Please configure MongoDB settings first.');
        }
        
        const args = [
            `--uri=${mongoUrl}`,
            `--archive=${inspectPath}`,
            '--gzip',
            '--dryRun',
            '--verbose' // verbose is needed to see the namespaces
        ];

        return new Promise((resolve, reject) => {
             const proc = spawn('mongorestore', args);
             let output = '';
             
             // mongorestore logs to stderr usually
             proc.stderr.on('data', d => output += d.toString());
             proc.stdout.on('data', d => output += d.toString());

             proc.on('close', async (code) => {
                 // Cleanup temps
                 if (tempDecryptedPath) await fs.unlink(tempDecryptedPath).catch(()=>{});
                 if (tempFtpPath) await fs.unlink(tempFtpPath).catch(()=>{});

                 if (code !== 0 && code !== 1) { 
                     // Proceeding anyway to parse what we got
                 }

                 // 4. Parse Output
                 // Strip ANSI codes
                 // eslint-disable-next-line no-control-regex
                 const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '');
                 
                 const structure = {};
                 const lines = cleanOutput.split('\n');
                 
                 for (const line of lines) {
                     // Strategy 1: Standard "restoring db.coll from"
                     let match = line.match(/restoring\s+([^\s\.]+)\.([^\s]+)\s+from/);
                     
                     // Strategy 2: Quoted "restoring 'db'.'coll' from"
                     if (!match) {
                        match = line.match(/restoring\s+["']?([^"'\s\.]+)["']?\.["']?([^"'\s]+)["']?\s+from/);
                     }

                     // Strategy 3: "archive prelude db.coll" (Seen in logs)
                     if (!match) {
                        match = line.match(/archive prelude ([^\s\.]+)\.([^\s]+)/);
                     }

                     // Strategy 4: "found collection metadata from db.coll to restore to" (Seen in logs)
                     if (!match) {
                        match = line.match(/found collection metadata from ([^\s\.]+)\.([^\s]+) to restore to/);
                     }
                     
                     // Strategy 5: Loose check for "restoring" and then "db.coll" anywhere
                     if (!match && (line.toLowerCase().includes('restoring') || line.toLowerCase().includes('reading'))) {
                         // Find anything that looks like db.coll (word.word)
                         // Exclude common keywords or extensions like .gz
                         const potentialMatches = line.matchAll(/\b([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\b/g);
                         for (const m of potentialMatches) {
                             const db = m[1];
                             const col = m[2];
                             // Filter out likely noise
                             if (col === 'gz' || col === 'json' || col === 'bson' || db === 'from' || db === 'archive') continue;
                             
                             if (!structure[db]) structure[db] = [];
                             if (!structure[db].includes(col)) structure[db].push(col);
                         }
                         continue; // If we found looser matches, skip regex assignment below
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
                 
                 // Final cleanup: remove empty dbs (from loose matching)
                 for (const db in structure) {
                     if (structure[db].length === 0) delete structure[db];
                 }
                 
                 resolve({
                     backupId,
                     structure,
                     rawOutput: cleanOutput.length > 5000 ? cleanOutput.substring(0, 5000) + '...' : cleanOutput
                 });
             });
             
             proc.on('error', async (err) => {
                 if (tempDecryptedPath) await fs.unlink(tempDecryptedPath).catch(()=>{});
                 if (tempFtpPath) await fs.unlink(tempFtpPath).catch(()=>{});
                 reject(err);
             });
        });

    } catch (error) {
        if (tempDecryptedPath && existsSync(tempDecryptedPath)) {
            await fs.unlink(tempDecryptedPath).catch(()=>{});
        }
        if (tempFtpPath && existsSync(tempFtpPath)) {
            await fs.unlink(tempFtpPath).catch(()=>{});
        }
        throw error;
    }
  }

  /**
   * Get backup by ID
   */
  getBackupById(id) {
    return this.db.prepare('SELECT * FROM backups WHERE id = ?').get(id);
  }

  /**
   * Get last completed backup
   */
  getLastCompletedBackup() {
    return this.db.prepare(
      'SELECT * FROM backups WHERE status = ? ORDER BY timestamp DESC LIMIT 1'
    ).get('completed');
  }

  /**
   * Save backup metadata
   */
  saveBackupMetadata(metadata) {
    const stmt = this.db.prepare(`
      INSERT INTO backups (id, filename, type, size, status, timestamp, ftp_path, local_path, error, completed_at, encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      metadata.id,
      metadata.filename,
      metadata.type,
      metadata.size || 0,
      metadata.status,
      metadata.timestamp,
      metadata.ftp_path || null,
      metadata.local_path || null,
      metadata.error || null,
      metadata.completed_at || null,
      metadata.encrypted || 0
    );
  }

  /**
   * Update backup metadata
   */
  updateBackupMetadata(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    
    if (fields.length > 0) {
      values.push(id);
      const sql = `UPDATE backups SET ${fields.join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...values);
    }
  }

  /**
   * Get current backup status
   */
  getCurrentStatus() {
    const lastBackup = this.getLastCompletedBackup();
    
    return {
      currentBackup: this.currentBackup,
      lastBackup: lastBackup ? {
        id: lastBackup.id,
        type: lastBackup.type,
        timestamp: lastBackup.timestamp,
        size: lastBackup.size,
        status: lastBackup.status
      } : null
    };
  }

  /**
   * Check if MongoDB is configured as a replica set (required for oplog-based PITR)
   */
  async checkReplicaSetStatus() {
    let client;
    try {
      const settings = await SettingsService.getAll();
      const mongoUrl = settings.mongoUrl;
      
      if (!mongoUrl) {
        return { isReplicaSet: false, error: 'MongoDB URL not configured' };
      }
      
      client = new MongoClient(mongoUrl);
      await client.connect();
      
      const admin = client.db().admin();
      const serverInfo = await admin.serverStatus();
      
      const isReplicaSet = !!(serverInfo.repl && serverInfo.repl.setName);
      const setName = serverInfo.repl?.setName || null;
      
      await client.close();
      
      return { 
        isReplicaSet, 
        setName,
        message: isReplicaSet 
          ? `Connected to replica set: ${setName}` 
          : 'MongoDB is not configured as a replica set. Oplog-based incremental backups may not work correctly.'
      };
    } catch (error) {
      if (client) await client.close();
      return { isReplicaSet: false, error: error.message };
    }
  }

  /**
   * Get the last completed full backup
   */
  getLastFullBackup() {
    return this.db.prepare(
      'SELECT * FROM backups WHERE type = ? AND status = ? ORDER BY timestamp DESC LIMIT 1'
    ).get('full', 'completed');
  }

  /**
   * Get PITR (Point-in-Time Recovery) status and available ranges
   */
  getPITRStatus() {
    // Get the last full backup as the base
    const lastFull = this.getLastFullBackup();
    
    if (!lastFull) {
      return {
        enabled: false,
        message: 'No full backup available. Create a full backup first.',
        ranges: [],
        lastFullBackup: null,
        lastIncrementalBackup: null
      };
    }

    // Get all incremental backups since the last full backup
    const incrementals = this.db.prepare(
      'SELECT * FROM backups WHERE type = ? AND timestamp > ? AND status = ? ORDER BY timestamp ASC'
    ).all('incremental', lastFull.timestamp, 'completed');

    // Get the last incremental backup
    const lastIncremental = incrementals.length > 0 ? incrementals[incrementals.length - 1] : null;

    // Calculate PITR ranges
    const ranges = this.getPITRRanges(lastFull, incrementals);

    return {
      enabled: true,
      message: `PITR available from ${new Date(lastFull.timestamp).toISOString()}`,
      ranges,
      lastFullBackup: {
        id: lastFull.id,
        timestamp: lastFull.timestamp,
        filename: lastFull.filename
      },
      lastIncrementalBackup: lastIncremental ? {
        id: lastIncremental.id,
        timestamp: lastIncremental.timestamp,
        filename: lastIncremental.filename
      } : null,
      coverage: {
        start: lastFull.timestamp,
        end: lastIncremental ? lastIncremental.timestamp : lastFull.timestamp
      }
    };
  }

  /**
   * Get available PITR time ranges
   */
  getPITRRanges(fullBackup, incrementals) {
    if (!fullBackup) return [];

    const ranges = [];
    let rangeStart = fullBackup.timestamp;

    // Each incremental extends the range
    for (const inc of incrementals) {
      ranges.push({
        start: rangeStart,
        end: inc.timestamp,
        backupId: inc.id,
        type: 'incremental'
      });
      rangeStart = inc.timestamp;
    }

    // If no incrementals, the range is just the full backup point
    if (incrementals.length === 0) {
      ranges.push({
        start: fullBackup.timestamp,
        end: fullBackup.timestamp,
        backupId: fullBackup.id,
        type: 'full'
      });
    }

    return ranges;
  }

  /**
   * Get the backup chain required to restore to a specific point in time
   * Returns an ordered array of backups to apply (full backup first, then incrementals)
   */
  getBackupChain(targetTimestamp) {
    // Validate target timestamp
    const targetTs = typeof targetTimestamp === 'string' 
      ? new Date(targetTimestamp).getTime() 
      : targetTimestamp;

    if (isNaN(targetTs)) {
      throw new Error('Invalid target timestamp');
    }

    // Find the most recent full backup BEFORE or AT the target time
    const fullBackup = this.db.prepare(
      'SELECT * FROM backups WHERE type = ? AND timestamp <= ? AND status = ? ORDER BY timestamp DESC LIMIT 1'
    ).get('full', targetTs, 'completed');

    if (!fullBackup) {
      throw new Error('No full backup available before the target time');
    }

    // Find all incremental backups between the full backup and target time
    const incrementals = this.db.prepare(
      'SELECT * FROM backups WHERE type = ? AND timestamp > ? AND timestamp <= ? AND status = ? ORDER BY timestamp ASC'
    ).all('incremental', fullBackup.timestamp, targetTs, 'completed');

    const chain = [fullBackup, ...incrementals];

    return {
      targetTimestamp: targetTs,
      targetTimeISO: new Date(targetTs).toISOString(),
      fullBackup: {
        id: fullBackup.id,
        timestamp: fullBackup.timestamp,
        filename: fullBackup.filename
      },
      incrementalCount: incrementals.length,
      chain: chain.map(b => ({
        id: b.id,
        type: b.type,
        timestamp: b.timestamp,
        filename: b.filename
      })),
      estimatedRestoreSize: chain.reduce((sum, b) => sum + (b.size || 0), 0)
    };
  }

  /**
   * Get all backup statistics for dashboard
   */
  getBackupStats() {
    const allBackups = this.getAllBackups();
    const fullBackups = allBackups.filter(b => b.type === 'full' && b.status === 'completed');
    const incrementalBackups = allBackups.filter(b => b.type === 'incremental' && b.status === 'completed');
    
    const totalSize = allBackups.reduce((sum, b) => sum + (b.size || 0), 0);
    
    return {
      totalBackups: allBackups.length,
      fullBackups: fullBackups.length,
      incrementalBackups: incrementalBackups.length,
      totalSize,
      lastFullBackup: fullBackups[0] || null,
      lastIncrementalBackup: incrementalBackups[0] || null
    };
  }
}

module.exports = new BackupService();
