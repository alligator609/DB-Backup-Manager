const cron = require('node-cron');
const LogService = require('./LogService');
const BackupService = require('./BackupService');
const SettingsService = require('./SettingsService');

class ScheduleService {
  constructor() {
    this.fullBackupJob = null;
    this.incrementalBackupJob = null;
    this.isRunning = false;
  }

  async init() {
    try {
      // Load schedule from settings and start if enabled
      const settings = await SettingsService.getAll();
      
      if (settings.scheduleEnabled) {
        await this.startSchedule();
        console.log('Schedule service initialized and started');
      } else {
        console.log('Schedule service initialized (not started)');
      }
    } catch (error) {
      console.error('Failed to initialize schedule service:', error);
    }
  }

  /**
   * Start scheduled backups using settings from SettingsService
   * Runs both full and incremental backups on their respective schedules
   */
  async startSchedule() {
    try {
      const settings = await SettingsService.getAll();
      const fullCron = settings.fullBackupCron || '0 2 * * *';
      const incrementalCron = settings.incrementalBackupCron || '*/15 * * * *';
      
      console.log(`[ScheduleService] Starting schedule with full: "${fullCron}", incremental: "${incrementalCron}"`);
      
      // Validate cron expressions
      if (!cron.validate(fullCron)) {
        throw new Error('Invalid full backup cron expression');
      }
      if (!cron.validate(incrementalCron)) {
        throw new Error('Invalid incremental backup cron expression');
      }
      
      // Stop existing jobs if running
      await this.stopSchedule(false); // Don't persist stop
      
      // Get existing backups to check if we need initial full backup
      const backups = BackupService.getAllBackups();
      const hasFullBackup = backups.some(b => b.type === 'full' && b.status === 'completed');
      
      // If no full backup exists, create one immediately
      if (!hasFullBackup) {
        await LogService.log('info', 'No full backup found. Creating initial full backup before starting schedule...');
        try {
          // Run full backup asynchronously for all enabled engines
          BackupService.runBackupsForAllEnabled('full').catch(err => {
            LogService.log('error', `Initial full backup failed: ${err.message}`);
          });
          await LogService.log('info', 'Initial full backup started');
        } catch (error) {
          await LogService.log('error', `Failed to start initial full backup: ${error.message}`);
        }
      }
      
      // Create full backup cron job with scheduled: true to auto-start
      // Note: Timezone is handled by system TZ environment variable
      this.fullBackupJob = cron.schedule(fullCron, async () => {
        console.log('[ScheduleService] Full backup cron triggered');
        await this.executeScheduledBackup('full');
      }, {
        scheduled: true
      });
      
      // Create incremental backup cron job with scheduled: true to auto-start
      this.incrementalBackupJob = cron.schedule(incrementalCron, async () => {
        console.log('[ScheduleService] Incremental backup cron triggered');
        // Only run incremental if we have at least one full backup
        const backups = BackupService.getAllBackups();
        const hasFullBackup = backups.some(b => b.type === 'full' && b.status === 'completed');
        
        if (hasFullBackup) {
          await this.executeScheduledBackup('incremental');
        } else {
          console.log('[ScheduleService] Skipping incremental - no full backup yet');
          await LogService.log('warning', 'Skipping incremental backup - no full backup exists yet');
        }
      }, {
        scheduled: true
      });
      
      // Explicitly start the jobs
      this.fullBackupJob.start();
      this.incrementalBackupJob.start();
      
      this.isRunning = true;
      
      console.log('[ScheduleService] Both cron jobs started successfully');
      
      // Save schedule to settings
      await SettingsService.set('scheduleEnabled', true);
      
      await LogService.log('success', `Backup schedule started`, {
        details: { 
          fullBackupCron: fullCron, 
          incrementalBackupCron: incrementalCron,
          hasExistingFullBackup: hasFullBackup
        }
      });
      
      return {
        success: true,
        message: 'Schedule started',
        fullBackupCron: fullCron,
        incrementalBackupCron: incrementalCron,
        nextRun: this.getNextRunTime(incrementalCron) // Show next incremental as it runs more frequently
      };
    } catch (error) {
      await LogService.log('error', `Failed to start schedule: ${error.message}`, {
        details: { error: error.message }
      });
      
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Stop scheduled backups
   * @param {boolean} persist - Whether to persist the stop to settings (default: true)
   */
  async stopSchedule(persist = true) {
    try {
      if (this.fullBackupJob) {
        this.fullBackupJob.stop();
        this.fullBackupJob = null;
      }
      
      if (this.incrementalBackupJob) {
        this.incrementalBackupJob.stop();
        this.incrementalBackupJob = null;
      }
      
      this.isRunning = false;
      
      if (persist) {
        // Update settings
        await SettingsService.set('scheduleEnabled', false);
        await LogService.log('info', 'Backup schedule stopped');
      }
      
      return {
        success: true,
        message: 'Schedule stopped'
      };
    } catch (error) {
      await LogService.log('error', `Failed to stop schedule: ${error.message}`);
      
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Execute scheduled backup
   */
  async executeScheduledBackup(backupType) {
    try {
      await LogService.log('info', `Executing scheduled ${backupType} backup`);

      // Runs for every enabled+configured engine
      await BackupService.runBackupsForAllEnabled(backupType);

      await LogService.log('success', `Scheduled ${backupType} backup completed`);
    } catch (error) {
      await LogService.log('error', `Scheduled ${backupType} backup failed: ${error.message}`, {
        details: { backupType, error: error.message }
      });
    }
  }

  /**
   * Get next run time for a cron expression
   * Returns object with ISO string and formatted times
   */
  getNextRunTime(cronExpression) {
    try {
      const { CronExpressionParser } = require('cron-parser');
      const interval = CronExpressionParser.parse(cronExpression);
      const nextDate = interval.next().toDate();
      
      return {
        iso: nextDate.toISOString(),
        utc: nextDate.toUTCString(),
        local: nextDate.toLocaleString(),
        timestamp: nextDate.getTime()
      };
    } catch {
      // Fallback: estimate next run
      const fallback = new Date(Date.now() + 60000);
      return {
        iso: fallback.toISOString(),
        utc: fallback.toUTCString(),
        local: fallback.toLocaleString(),
        timestamp: fallback.getTime()
      };
    }
  }

  /**
   * Get human-readable description of a cron schedule
   */
  getCronDescription(cronExpression) {
    const presets = {
      '* * * * *': 'Every Minute',
      '*/5 * * * *': 'Every 5 Minutes',
      '*/15 * * * *': 'Every 15 Minutes',
      '*/30 * * * *': 'Every 30 Minutes',
      '0 * * * *': 'Hourly',
      '0 0 * * *': 'Daily at Midnight',
      '0 2 * * *': 'Daily at 2:00 AM',
      '0 0 * * 0': 'Weekly (Sunday at Midnight)',
      '0 2 * * 0': 'Weekly (Sunday at 2:00 AM)'
    };
    
    return presets[cronExpression] || cronExpression;
  }

  /**
   * Get current schedule status with timezone information
   */
  async getStatus() {
    const settings = await SettingsService.getAll();
    const fullCron = settings.fullBackupCron || '0 2 * * *';
    const incrementalCron = settings.incrementalBackupCron || '*/15 * * * *';
    
    // Get server timezone
    let serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    
    // Normalize legacy timezone names to modern names
    const timezoneAliases = {
      'Asia/Calcutta': 'Asia/Kolkata',
      'Asia/Saigon': 'Asia/Ho_Chi_Minh',
      'Asia/Katmandu': 'Asia/Kathmandu',
      'Asia/Rangoon': 'Asia/Yangon',
      'Pacific/Ponape': 'Pacific/Pohnpei',
      'Pacific/Truk': 'Pacific/Chuuk',
      'America/Buenos_Aires': 'America/Argentina/Buenos_Aires'
    };
    serverTimezone = timezoneAliases[serverTimezone] || serverTimezone;
    
    // Get timezone abbreviation (e.g., IST, PST, EST)
    const timezoneAbbreviations = {
      'Asia/Kolkata': 'IST',
      'Asia/Tokyo': 'JST',
      'Asia/Shanghai': 'CST',
      'Asia/Singapore': 'SGT',
      'Asia/Dubai': 'GST',
      'Europe/London': 'GMT',
      'Europe/Paris': 'CET',
      'Europe/Berlin': 'CET',
      'America/New_York': 'EST',
      'America/Chicago': 'CST',
      'America/Denver': 'MST',
      'America/Los_Angeles': 'PST',
      'Australia/Sydney': 'AEST',
      'Pacific/Auckland': 'NZST',
      'UTC': 'UTC'
    };
    const timezoneAbbr = timezoneAbbreviations[serverTimezone] || null;
    
    const serverOffset = new Date().getTimezoneOffset(); // e.g., -330 for IST (UTC+5:30)
    // Note: getTimezoneOffset returns negative for east of UTC, positive for west
    // IST is UTC+5:30, so getTimezoneOffset returns -330
    const offsetHours = Math.floor(Math.abs(serverOffset) / 60); // Use abs BEFORE division to avoid Math.floor rounding issues
    const offsetMinutes = Math.abs(serverOffset) % 60;
    const offsetSign = serverOffset <= 0 ? '+' : '-';
    const offsetString = `UTC${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
    
    // Calculate next run times
    const nextFullRun = this.isRunning ? this.getNextRunTime(fullCron) : null;
    const nextIncrementalRun = this.isRunning ? this.getNextRunTime(incrementalCron) : null;
    
    return {
      enabled: this.isRunning,
      cronExpression: fullCron, // Legacy support
      fullBackupCron: fullCron,
      incrementalBackupCron: incrementalCron,
      fullBackupDescription: this.getCronDescription(fullCron),
      incrementalBackupDescription: this.getCronDescription(incrementalCron),
      timezone: {
        name: serverTimezone,
        abbreviation: timezoneAbbr, // e.g., 'IST' for India
        offset: offsetString,
        offsetMinutes: -serverOffset // Positive for east of UTC
      },
      nextRun: nextIncrementalRun?.iso || null, // Legacy - next incremental as it's more frequent
      nextFullBackup: nextFullRun,
      nextIncrementalBackup: nextIncrementalRun
    };
  }

  /**
   * Validate cron expression
   */
  validateCron(cronExpression) {
    return cron.validate(cronExpression);
  }

  /**
   * Get cron presets
   */
  static getPresets() {
    return {
      'every_minute': {
        cron: '* * * * *',
        label: 'Every minute (testing only)',
        description: 'Runs every minute - for testing purposes'
      },
      'every_5_minutes': {
        cron: '*/5 * * * *',
        label: 'Every 5 minutes',
        description: 'Runs every 5 minutes'
      },
      'every_15_minutes': {
        cron: '*/15 * * * *',
        label: 'Every 15 minutes',
        description: 'Runs every 15 minutes'
      },
      'hourly': {
        cron: '0 * * * *',
        label: 'Hourly',
        description: 'Runs at the start of every hour'
      },
      'daily_2am': {
        cron: '0 2 * * *',
        label: 'Daily at 2 AM',
        description: 'Runs every day at 2:00 AM'
      },
      'daily_midnight': {
        cron: '0 0 * * *',
        label: 'Daily at midnight',
        description: 'Runs every day at 12:00 AM'
      },
      'weekly': {
        cron: '0 2 * * 0',
        label: 'Weekly (Sunday 2 AM)',
        description: 'Runs every Sunday at 2:00 AM'
      }
    };
  }
}

module.exports = new ScheduleService();
