const express = require('express');
const router = express.Router();
const BackupService = require('../services/BackupService');
const ScheduleService = require('../services/ScheduleService');
const { backupRunValidation, scheduleValidation, backupIdValidation } = require('../middleware/validate');
const fs = require('fs');

/**
 * GET /api/backup/status
 * Get current backup status and last run info
 */
router.get('/status', async (req, res) => {
  try {
    const backupStatus = BackupService.getCurrentStatus();
    const scheduleStatus = await ScheduleService.getStatus();
    
    return res.json({
      success: true,
      data: {
        currentBackup: backupStatus.currentBackup,
        lastBackup: backupStatus.lastBackup,
        schedule: scheduleStatus
      }
    });
  } catch (error) {
    console.error('Get status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get status'
    });
  }
});

/**
 * GET /api/backup/pitr-status
 * Get PITR (Point-in-Time Recovery) status and available restore ranges
 */
router.get('/pitr-status', async (req, res) => {
  try {
    const SettingsService = require('../services/SettingsService');
    const Engines = require('../services/engines');
    const settings = await SettingsService.getAll();
    const engineName = Engines.getEngineName(settings);

    const pitrStatus = BackupService.getPITRStatus(engineName);
    const support = await BackupService.getIncrementalSupport();
    const stats = BackupService.getBackupStats();

    return res.json({
      success: true,
      data: {
        ...pitrStatus,
        engine: engineName,
        incrementalSupport: support,
        // Backward-compatible shape for existing UI
        replicaSet: {
          isReplicaSet: support.supported,
          setName: support.setName,
          message: support.message,
          error: support.error
        },
        stats
      }
    });
  } catch (error) {
    console.error('Get PITR status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get PITR status'
    });
  }
});

/**
 * GET /api/backup/chain/:timestamp
 * Get the backup chain required to restore to a specific point in time
 */
router.get('/chain/:timestamp', async (req, res) => {
  try {
    const { timestamp } = req.params;
    const SettingsService = require('../services/SettingsService');
    const Engines = require('../services/engines');
    const settings = await SettingsService.getAll();
    const chain = BackupService.getBackupChain(timestamp, Engines.getEngineName(settings));
    
    return res.json({
      success: true,
      data: chain
    });
  } catch (error) {
    console.error('Get backup chain error:', error);
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/backup/run
 * Trigger a manual backup
 */
router.post('/run', backupRunValidation, async (req, res) => {
  try {
    const { type } = req.body;
    
    // Run backup asynchronously
    const backupPromise = type === 'incremental'
      ? BackupService.createIncrementalBackup()
      : BackupService.createFullBackup();
    
    // Don't wait for completion, return immediately
    backupPromise.catch(error => {
      console.error('Backup failed:', error);
    });
    
    return res.json({
      success: true,
      message: `${type} backup started`,
      type
    });
  } catch (error) {
    console.error('Start backup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start backup'
    });
  }
});

/**
 * POST /api/backup/schedule
 * Start or stop backup schedule
 */
router.post('/schedule', scheduleValidation, async (req, res) => {
  try {
    const { enabled } = req.body;
    
    let result;
    
    if (enabled === false) {
      result = await ScheduleService.stopSchedule();
    } else {
      // Start schedule using settings from SettingsService
      result = await ScheduleService.startSchedule();
    }
    
    if (result.success) {
      return res.json({
        success: true,
        message: result.message,
        data: result
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Update schedule error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update schedule'
    });
  }
});

/**
 * GET /api/backups
 * List all backups
 */
router.get('/', async (req, res) => {
  try {
    const backups = BackupService.getAllBackups();
    
    return res.json({
      success: true,
      data: backups
    });
  } catch (error) {
    console.error('List backups error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to list backups'
    });
  }
});

/**
 * GET /api/backups/:id/inspect
 * Inspect a backup file contents
 */
router.get('/:id/inspect', backupIdValidation, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await BackupService.inspectBackup(id);
    
    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Inspect backup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to inspect backup', // Changed 'error' to 'message' to be consistent with other error responses
      error: error.message
    });
  }
});

/**
 * GET /api/backups/:id/download
 * Download a backup file
 */
router.get('/:id/download', backupIdValidation, async (req, res) => {
  try {
    const { id } = req.params;
    const backup = BackupService.getBackupById(id);
    
    if (!backup) {
      return res.status(404).json({
        success: false,
        message: 'Backup not found'
      });
    }
    
    // Check if local file exists
    if (backup.local_path && fs.existsSync(backup.local_path)) {
      // Stream local file
      return res.download(backup.local_path, backup.filename);
    } else if (backup.ftp_path) {
      // Download from FTP first
      const FtpService = require('../services/FtpService');
      const tempPath = `/tmp/${backup.filename}`;
      
      const result = await FtpService.download(backup.ftp_path, tempPath);
      
      if (result.success) {
        return res.download(tempPath, backup.filename, (err) => {
          // Clean up temp file after download
          if (!err) {
            fs.unlinkSync(tempPath);
          }
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Failed to download from FTP'
        });
      }
    } else {
      return res.status(404).json({
        success: false,
        message: 'Backup file not found'
      });
    }
  } catch (error) {
    console.error('Download backup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to download backup'
    });
  }
});

/**
 * DELETE /api/backups/:id
 * Delete a backup
 */
router.delete('/:id', backupIdValidation, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await BackupService.deleteBackup(id);
    
    if (result.success) {
      return res.json({
        success: true,
        message: 'Backup deleted'
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Delete backup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete backup'
    });
  }
});

/**
 * GET /api/backup/presets
 * Get cron schedule presets
 */
router.get('/presets', (req, res) => {
  const presets = ScheduleService.constructor.getPresets();
  
  return res.json({
    success: true,
    data: presets
  });
});

module.exports = router;
