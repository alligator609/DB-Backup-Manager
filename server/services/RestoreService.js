const fs = require('fs').promises;
const { existsSync } = require('fs');
const path = require('path');
const BackupService = require('./BackupService'); // To get metadata
const EncryptionService = require('./EncryptionService');
const FtpService = require('./FtpService');
const LogService = require('./LogService');
const SettingsService = require('./SettingsService');
const Engines = require('./engines');

class RestoreService {
  constructor() {
    this.restoreDir = path.join(process.cwd(), 'data', 'restore_temp');
    this.currentRestore = null;
  }

  async init() {
     await fs.mkdir(this.restoreDir, { recursive: true });
  }

  /**
   * Restore a specific backup by ID
   * Auto-resolves dependencies (e.g. Full backup + 3 Incrementals)
   */
  async restoreBackup(backupId) {
    const targetBackup = BackupService.getBackupById(backupId);
    if (!targetBackup) {
      throw new Error('Backup not found');
    }

    await LogService.log('info', `Starting restore for backup: ${backupId}`, { type: targetBackup.type });

    // Identify chain
    let chain = [];
    
    if (targetBackup.type === 'full') {
      chain.push(targetBackup);
    } else {
      // It's incremental. Find the base full backup.
      const fullBackup = BackupService.db.prepare(
        'SELECT * FROM backups WHERE type = ? AND timestamp < ? AND status = ? ORDER BY timestamp DESC LIMIT 1'
      ).get('full', targetBackup.timestamp, 'completed');

      if (!fullBackup) {
         throw new Error('No base full backup found for this incremental backup');
      }

      chain.push(fullBackup);

      // Find intermediate incrementals
      const incrementals = BackupService.db.prepare(
        'SELECT * FROM backups WHERE type = ? AND timestamp > ? AND timestamp <= ? AND status = ? ORDER BY timestamp ASC'
      ).all('incremental', fullBackup.timestamp, targetBackup.timestamp, 'completed');
      
      chain = chain.concat(incrementals);
    }

    await LogService.log('info', `Restore chain identified with ${chain.length} backups`, { 
        chain: chain.map(b => b.id) 
    });

    this.currentRestore = { 
      targetBackupId: backupId, 
      chainLength: chain.length, 
      currentStep: 0,
      status: 'in_progress'
    };

    // Execute chain
    for (let i = 0; i < chain.length; i++) {
      this.currentRestore.currentStep = i + 1;
      await this.restoreSingleBackup(chain[i]);
    }

    this.currentRestore = null;
    await LogService.log('success', 'Restore completed successfully');
    return { success: true, filesRestored: chain.length };
  }

  /**
   * Restore to a specific point in time (PITR)
   * Automatically calculates and applies the backup chain
   */
  async restoreToPointInTime(targetTimestamp) {
    const targetTs = typeof targetTimestamp === 'string' 
      ? new Date(targetTimestamp).getTime() 
      : targetTimestamp;

    if (isNaN(targetTs)) {
      throw new Error('Invalid target timestamp');
    }

    await LogService.log('info', `Starting Point-in-Time restore to: ${new Date(targetTs).toISOString()}`);

    // Get the backup chain for this point in time (current engine only)
    const settings = await SettingsService.getAll();
    const engineName = Engines.getEngineName(settings);
    const chainInfo = BackupService.getBackupChain(targetTs, engineName);
    
    await LogService.log('info', `PITR chain: 1 full backup + ${chainInfo.incrementalCount} incremental backups`, {
      fullBackup: chainInfo.fullBackup.id,
      incrementalCount: chainInfo.incrementalCount
    });

    this.currentRestore = { 
      targetTimestamp: targetTs, 
      chainLength: chainInfo.chain.length, 
      currentStep: 0,
      status: 'in_progress',
      type: 'pitr'
    };

    // Execute each backup in the chain
    for (let i = 0; i < chainInfo.chain.length; i++) {
      const backupInfo = chainInfo.chain[i];
      const backup = BackupService.getBackupById(backupInfo.id);
      
      if (!backup) {
        throw new Error(`Backup not found in chain: ${backupInfo.id}`);
      }

      this.currentRestore.currentStep = i + 1;
      await LogService.log('info', `Restoring backup ${i + 1}/${chainInfo.chain.length}: ${backup.type}`);
      await this.restoreSingleBackup(backup);
    }

    this.currentRestore = null;
    await LogService.log('success', `Point-in-Time restore completed to ${new Date(targetTs).toISOString()}`);
    
    return { 
      success: true, 
      targetTime: new Date(targetTs).toISOString(),
      filesRestored: chainInfo.chain.length,
      fullBackupId: chainInfo.fullBackup.id,
      incrementalCount: chainInfo.incrementalCount
    };
  }

  /**
   * Get current restore status
   */
  getCurrentStatus() {
    return this.currentRestore;
  }

  /**
   * Preview restore chain for a point in time (without executing)
   */
  async previewRestore(targetTimestamp) {
    const settings = await SettingsService.getAll();
    const engineName = Engines.getEngineName(settings);
    return BackupService.getBackupChain(targetTimestamp, engineName);
  }

  /**
   * Restore a single backup file
   */
  async restoreSingleBackup(backup) {
     const settings = await SettingsService.getAll();
     const engine = Engines.getEngineForBackup(backup, settings);
     engine.assertConfigured(settings);

     let localPath = backup.local_path;
     let tempFtpPath = null;
     
     // If file is missing locally, try to download from FTP
     if (!localPath || !existsSync(localPath)) {
        if (backup.ftp_path) {
          await LogService.log('info', `Local file missing for ${backup.id}, downloading from FTP...`);
          tempFtpPath = path.join(this.restoreDir, `ftp_${backup.id}_${Date.now()}.gz`);
          
          const ftpResult = await FtpService.download(backup.ftp_path, tempFtpPath);
          if (!ftpResult.success) {
            throw new Error(`Failed to download backup from FTP: ${ftpResult.message}`);
          }
          
          localPath = tempFtpPath;
          await LogService.log('success', `Downloaded backup from FTP: ${backup.ftp_path}`);
        } else {
          throw new Error(`Backup file not found locally and no FTP path available: ${backup.filename}`);
        }
     }

     // Prepare file for restore (Decryption if needed)
     let processedPath = localPath;
     let tempDecryptedPath = null;

     if (backup.encrypted) {
        tempDecryptedPath = path.join(this.restoreDir, `decrypted_${backup.id}`);
        // Add extension based on type
        if (backup.type === 'full') tempDecryptedPath += engine.fullFileExtension;
        else tempDecryptedPath += engine.incrementalFileExtension;

        await LogService.log('info', `Decrypting ${backup.id}...`);
        await EncryptionService.decryptFile(localPath, tempDecryptedPath);
        processedPath = tempDecryptedPath;
     }

     try {
       if (backup.type === 'full') {
          await engine.restoreFull(settings, processedPath);
       } else {
          await engine.applyIncremental(settings, processedPath);
       }
     } finally {
        // Cleanup temp files
        if (tempDecryptedPath) {
            await fs.unlink(tempDecryptedPath).catch(() => {});
        }
        if (tempFtpPath) {
            await fs.unlink(tempFtpPath).catch(() => {});
        }
     }
  }

  async fileExists(filePath) {
      try {
          await fs.stat(filePath);
          return true;
      } catch {
          return false;
      }
  }
}

module.exports = new RestoreService();



