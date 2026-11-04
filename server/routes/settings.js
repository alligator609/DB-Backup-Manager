const express = require('express');
const router = express.Router();
const SettingsService = require('../services/SettingsService');
const { settingsValidation } = require('../middleware/validate');

/**
 * GET /api/settings
 * Get all settings (sensitive fields masked)
 */
router.get('/', async (req, res) => {
  try {
    const settings = await SettingsService.getAllSafe();
    
    return res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get settings'
    });
  }
});

/**
 * POST /api/settings
 * Update settings
 */
router.post('/', settingsValidation, async (req, res) => {
  try {
    const updates = req.body;
    
    // Get current settings
    const currentSettings = await SettingsService.getAll();
    
    // Merge with updates
    const newSettings = { ...currentSettings, ...updates };
    
    // Save
    const success = await SettingsService.saveAll(newSettings);
    
    if (success) {
      return res.json({
        success: true,
        message: 'Settings updated successfully'
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to save settings'
      });
    }
  } catch (error) {
    console.error('Update settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
});

/**
 * POST /api/settings/test-ftp
 * Test FTP connection
 */
router.post('/test-ftp', async (req, res) => {
  try {
    const FtpService = require('../services/FtpService');
    const result = await FtpService.testConnection(req.body);

    return res.json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('Test FTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to test FTP connection'
    });
  }
});

/**
 * POST /api/settings/test-db
 * Test the configured database engine connection
 */
router.post('/test-db', async (req, res) => {
  try {
    const Engines = require('../services/engines');

    // Merge saved settings with overrides from the request body,
    // restoring real credentials where the UI sent the '***' mask
    const saved = await SettingsService.getAll();
    const merged = { ...saved, ...req.body };
    for (const key of ['mongoUrl', 'mysqlPassword', 'ftpPassword']) {
      if (merged[key] === '***') merged[key] = saved[key];
    }

    const engine = Engines.getEngineByName(req.body.engine) || Engines.getEngine(merged);
    const result = await engine.testConnection(merged);

    return res.json({
      success: result.success,
      message: result.message,
      details: result.details
    });
  } catch (error) {
    console.error('Test DB error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to test database connection'
    });
  }
});

module.exports = router;

/**
 * POST /api/settings/reset
 * Reset settings to defaults
 */
router.post('/reset', async (req, res) => {
  try {
    const success = await SettingsService.resetToDefaults();
    
    if (success) {
      return res.json({
        success: true,
        message: 'Settings reset to defaults'
      });
    } else {
      throw new Error('Reset failed');
    }
  } catch (error) {
    console.error('Reset settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset settings'
    });
  }
});
