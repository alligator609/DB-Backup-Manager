const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');
const tar = require('tar');
const Database = require('better-sqlite3');
const LogService = require('./LogService');
const FtpService = require('./FtpService');
const SettingsService = require('./SettingsService');
const EncryptionService = require('./EncryptionService');
const Engines = require('./engines');

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
        'ALTER TABLE backups ADD COLUMN oplog_end_ts INTEGER',
        'ALTER TABLE backups ADD COLUMN engine TEXT',
        'ALTER TABLE backups ADD COLUMN db_name TEXT',
        'ALTER TABLE backups ADD COLUMN log_start TEXT',
        'ALTER TABLE backups ADD COLUMN log_end TEXT'
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
   * Run a backup for every enabled engine.
   * Engines that are enabled but not configured are skipped with a warning;
   * per-engine failures are logged but don't stop the others.
   */
  async runBackupsForAllEnabled(type) {
    const settings = await SettingsService.getAll();
    const enabledNames = Engines.getEnabledEngineNames(settings);
    const results = [];

    if (enabledNames.length === 0) {
      throw new Error('No database engines enabled. Enable at least one engine in Settings.');
    }

    for (const name of enabledNames) {
      const engine = Engines.getEngineByName(name);
      if (!engine.isConfigured(settings)) {
        await LogService.log('warning', `Skipping ${name} backup: enabled but not configured`);
        results.push({ engine: name, skipped: true, message: 'Not configured' });
        continue;
      }

      try {
        const result = type === 'incremental'
          ? await this.createIncrementalBackup(name)
          : await this.createFullBackup(name);
        results.push({ engine: name, ...result });
      } catch (error) {
        await LogService.log('error', `${name} ${type} backup failed: ${error.message}`);
        results.push({ engine: name, error: error.message });
      }
    }

    return results;
  }

  /**
   * Create a full database backup
   */
  async createFullBackup(engineName) {
    const backupId = this.generateBackupId();
    const timestamp = Date.now();
    const settings = await SettingsService.getAll();
    const engine = Engines.getEngineByName(engineName) || Engines.getEngine(settings);
    const filename = `full_${new Date(timestamp).toISOString().replace(/:/g, '-').split('.')[0]}${engine.fullFileExtension}`;
    const localPath = path.join(this.backupDir, filename);

    try {
      await LogService.log('info', `Starting full backup (${engine.label})`, {
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
        local_path: localPath,
        engine: engine.name,
        db_name: engine.getTargetName(settings)
      });

      this.currentBackup = { id: backupId, type: 'full', engine: engine.name };

      const enableEncryption = settings.enableEncryption;

      let dumpPath = localPath;
      let tempPath = null;

      if (enableEncryption) {
          // If encryption enabled, dump to temp file first
          tempPath = localPath + '.temp';
          dumpPath = tempPath;
      }

      // Run the engine-specific full dump
      const dumpResult = await engine.fullBackup(settings, dumpPath);
      
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
        encrypted: !!enableEncryption ? 1 : 0, // Add encrypted flag
        log_end: dumpResult && dumpResult.logEnd ? JSON.stringify(dumpResult.logEnd) : null
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
   * Create an incremental backup by dumping a change-log slice.
   * MongoDB: oplog entries newer than the last backup.
   * MySQL: binlog events between the last backup's log coordinates and now.
   */
  async createIncrementalBackup(engineName) {
    const backupId = this.generateBackupId();
    const timestamp = Date.now();
    const settings = await SettingsService.getAll();
    const engine = Engines.getEngineByName(engineName) || Engines.getEngine(settings);

    // Chain incrementals onto the last completed backup of the SAME engine
    const lastBackup = this.getLastCompletedBackup(engine.name);

    // If no full backup exists, enforce full backup
    if (!lastBackup) {
        throw new Error('No full backup found. Please create a full backup first.');
    }

    const filename = `incremental_${lastBackup.timestamp}_${timestamp}${engine.incrementalFileExtension}`;
    const localPath = path.join(this.backupDir, filename);
    const tempPath = localPath + '.temp'; // For encryption flow

    console.log(`[Backup] Starting incremental backup ${backupId} (${engine.name})`);

    try {
      await LogService.log('info', `Starting incremental (${engine.changeLogName}) backup`, {
        backup_id: backupId,
        type: 'incremental',
        status: 'started',
        details: { base_backup: lastBackup.id, engine: engine.name }
      });

      this.saveBackupMetadata({
        id: backupId,
        filename,
        type: 'incremental',
        size: 0,
        status: 'in_progress',
        timestamp,
        local_path: localPath,
        engine: engine.name,
        db_name: engine.getTargetName(settings)
      });

      this.currentBackup = { id: backupId, type: 'incremental', engine: engine.name };

      const enableEncryption = settings.enableEncryption;

      // 1. Dump change-log slice
      // We dump directly to file (or temp file if encryption is on)
      const dumpTarget = enableEncryption ? tempPath : localPath;

      const sliceResult = await engine.incrementalBackup(settings, dumpTarget, lastBackup);

      // 2. Encrypt if enabled
      if (enableEncryption) {
          await LogService.log('info', 'Encrypting change-log slice...', { backup_id: backupId });
          await EncryptionService.encryptFile(dumpTarget, localPath);
          await fs.unlink(dumpTarget);
      }

      // 3. Stats & Metadata
      let size = 0;
      if (existsSync(localPath)) {
          const stats = await fs.stat(localPath);
          size = stats.size;
      }

      if (size === 0 || (sliceResult && sliceResult.empty)) {
          // Empty change-log slice: nothing changed since last backup.
          // Valid state — mark as skipped and clean up the empty file.
          if (existsSync(localPath)) await fs.unlink(localPath).catch(() => {});

          await LogService.log('info', 'No changes found since last backup (change-log slice empty).', { backup_id: backupId });

          this.updateBackupMetadata(backupId, {
              status: 'skipped',
              completed_at: Date.now(),
              error: 'No changes detected',
              log_start: sliceResult && sliceResult.logStart ? JSON.stringify(sliceResult.logStart) : null,
              log_end: sliceResult && sliceResult.logEnd ? JSON.stringify(sliceResult.logEnd) : null
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
        encrypted: !!enableEncryption ? 1 : 0,
        log_start: sliceResult && sliceResult.logStart ? JSON.stringify(sliceResult.logStart) : null,
        log_end: sliceResult && sliceResult.logEnd ? JSON.stringify(sliceResult.logEnd) : null
      });

      await this.cleanupLocalBackup(backupId, localPath);
      await this.applyRetentionPolicy();

      this.currentBackup = null;

      await LogService.log('success', `Incremental backup (${engine.changeLogName} slice) completed`, {
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

        // 3. Run the engine-specific inspection
        const settings = await SettingsService.getAll();
        const engine = Engines.getEngineForBackup(backup, settings);
        const result = await engine.inspect(settings, inspectPath);

        if (tempDecryptedPath) await fs.unlink(tempDecryptedPath).catch(()=>{});
        if (tempFtpPath) await fs.unlink(tempFtpPath).catch(()=>{});

        return {
            backupId,
            structure: result.structure,
            rawOutput: result.rawOutput
        };


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
   * SQL fragment matching backups for a given engine.
   * engine is NULL for backups created before multi-engine support,
   * which are treated as MongoDB backups.
   */
  _engineFilterSql() {
    return `(engine = ? OR (engine IS NULL AND ? = 'mongodb'))`;
  }

  /**
   * Get last completed backup, optionally scoped to an engine
   */
  getLastCompletedBackup(engineName) {
    if (engineName) {
      return this.db.prepare(
        `SELECT * FROM backups WHERE status = ? AND ${this._engineFilterSql()} ORDER BY timestamp DESC LIMIT 1`
      ).get('completed', engineName, engineName);
    }
    return this.db.prepare(
      'SELECT * FROM backups WHERE status = ? ORDER BY timestamp DESC LIMIT 1'
    ).get('completed');
  }

  /**
   * Save backup metadata
   */
  saveBackupMetadata(metadata) {
    const stmt = this.db.prepare(`
      INSERT INTO backups (id, filename, type, size, status, timestamp, ftp_path, local_path, error, completed_at, encrypted, engine, log_start, log_end, db_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      metadata.encrypted || 0,
      metadata.engine || null,
      metadata.log_start || null,
      metadata.log_end || null,
      metadata.db_name || null
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
   * Check whether the change log required for incremental backups / PITR
   * is available on the configured engine
   * (MongoDB: replica set oplog, MySQL: binary logging).
   */
  async getIncrementalSupport(engineName) {
    try {
      const settings = await SettingsService.getAll();
      const engine = Engines.getEngineByName(engineName) || Engines.getEngine(settings);
      const support = await engine.checkIncrementalSupport(settings);
      return { ...support, engine: engine.name };
    } catch (error) {
      return { supported: false, error: error.message };
    }
  }

  /**
   * Get the last completed full backup, optionally scoped to an engine
   */
  getLastFullBackup(engineName) {
    if (engineName) {
      return this.db.prepare(
        `SELECT * FROM backups WHERE type = ? AND status = ? AND ${this._engineFilterSql()} ORDER BY timestamp DESC LIMIT 1`
      ).get('full', 'completed', engineName, engineName);
    }
    return this.db.prepare(
      'SELECT * FROM backups WHERE type = ? AND status = ? ORDER BY timestamp DESC LIMIT 1'
    ).get('full', 'completed');
  }

  /**
   * Get PITR (Point-in-Time Recovery) status and available ranges
   */
  getPITRStatus(engineName) {
    // Get the last full backup as the base
    const lastFull = this.getLastFullBackup(engineName);
    
    if (!lastFull) {
      return {
        enabled: false,
        message: 'No full backup available. Create a full backup first.',
        ranges: [],
        lastFullBackup: null,
        lastIncrementalBackup: null
      };
    }

    // Get all incremental backups since the last full backup (same engine as base)
    const incEngine = engineName || lastFull.engine || 'mongodb';
    const incrementals = this.db.prepare(
      `SELECT * FROM backups WHERE type = ? AND timestamp > ? AND status = ? AND ${this._engineFilterSql()} ORDER BY timestamp ASC`
    ).all('incremental', lastFull.timestamp, 'completed', incEngine, incEngine);

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
  getBackupChain(targetTimestamp, engineName) {
    // Validate target timestamp
    const targetTs = typeof targetTimestamp === 'string'
      ? new Date(targetTimestamp).getTime()
      : targetTimestamp;

    if (isNaN(targetTs)) {
      throw new Error('Invalid target timestamp');
    }

    const engineFilter = engineName ? `AND ${this._engineFilterSql()}` : '';
    const engineParams = engineName ? [engineName, engineName] : [];

    // Find the most recent full backup BEFORE or AT the target time
    const fullBackup = this.db.prepare(
      `SELECT * FROM backups WHERE type = ? AND timestamp <= ? AND status = ? ${engineFilter} ORDER BY timestamp DESC LIMIT 1`
    ).get('full', targetTs, 'completed', ...engineParams);

    if (!fullBackup) {
      throw new Error('No full backup available before the target time');
    }

    // Incrementals must belong to the same engine as the base full backup.
    // When no engine was specified, inherit it from the backup record itself
    // (NULL engine = pre-multi-engine rows = mongodb).
    const chainEngine = engineName || fullBackup.engine || 'mongodb';
    const incParams = engineName ? engineParams : [chainEngine, chainEngine];

    // Find all incremental backups between the full backup and target time
    const incrementals = this.db.prepare(
      `SELECT * FROM backups WHERE type = ? AND timestamp > ? AND timestamp <= ? AND status = ? AND ${this._engineFilterSql()} ORDER BY timestamp ASC`
    ).all('incremental', fullBackup.timestamp, targetTs, 'completed', ...incParams);

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
