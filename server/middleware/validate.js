const { body, param, query, validationResult } = require('express-validator');

/**
 * Validate request and return errors if any
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  
  next();
}

/**
 * Validation rules for login
 */
const loginValidation = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username is required')
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 3 })
    .withMessage('Password must be at least 3 characters'),
  validate
];

/**
 * Validation rules for backup run
 */
const backupRunValidation = [
  body('type')
    .isIn(['full', 'incremental'])
    .withMessage('Type must be "full" or "incremental"'),
  body('engine')
    .optional()
    .isIn(['all', 'mongodb', 'mysql'])
    .withMessage('Engine must be "all", "mongodb" or "mysql"'),
  validate
];

/**
 * Validation rules for schedule
 */
const scheduleValidation = [
  body('cron')
    .optional()
    .custom((value) => {
      if (value) {
        // Basic cron validation (5 or 6 fields separated by spaces)
        const parts = value.trim().split(/\s+/);
        if (parts.length < 5 || parts.length > 6) {
          throw new Error('Invalid cron expression format');
        }
      }
      return true;
    }),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('Enabled must be a boolean'),
  validate
];

/**
 * Validation rules for settings update
 */
const settingsValidation = [
  body('dbEngine')
    .optional()
    .isIn(['mongodb', 'mysql'])
    .withMessage('Database engine must be "mongodb" or "mysql"'),
  body('mongoEnabled')
    .optional()
    .isBoolean()
    .withMessage('mongoEnabled must be a boolean'),
  body('mysqlEnabled')
    .optional()
    .isBoolean()
    .withMessage('mysqlEnabled must be a boolean'),
  body('mongoUrl')
    .optional()
    .isString()
    .withMessage('MongoDB URL must be a string'),
  body('mysqlHost')
    .optional()
    .isString()
    .withMessage('MySQL host must be a string'),
  body('mysqlPort')
    .optional()
    .isInt({ min: 1, max: 65535 })
    .withMessage('MySQL port must be between 1 and 65535'),
  body('mysqlUser')
    .optional()
    .isString()
    .withMessage('MySQL user must be a string'),
  body('mysqlPassword')
    .optional()
    .isString()
    .withMessage('MySQL password must be a string'),
  body('mysqlDatabase')
    .optional()
    .isString()
    .withMessage('MySQL database must be a string'),
  body('ftpHost')
    .optional()
    .isString()
    .withMessage('FTP host must be a string'),
  body('ftpPort')
    .optional()
    .isInt({ min: 1, max: 65535 })
    .withMessage('FTP port must be between 1 and 65535'),
  body('ftpUser')
    .optional()
    .isString()
    .withMessage('FTP user must be a string'),
  body('ftpPassword')
    .optional()
    .isString()
    .withMessage('FTP password must be a string'),
  body('ftpBasePath')
    .optional()
    .isString()
    .withMessage('FTP base path must be a string'),
  body('keepLocalBackups')
    .optional()
    .isBoolean()
    .withMessage('Keep local backups must be a boolean'),
  body('keepLastNBackups')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Keep last N backups must be a positive integer'),
  body('retentionDays')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Retention days must be a positive integer'),
  validate
];

/**
 * Validation rules for backup ID param
 */
const backupIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Backup ID is required')
    .isString()
    .withMessage('Backup ID must be a string'),
  validate
];

/**
 * Validation rules for logs query
 */
const logsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('level')
    .optional()
    .isIn(['info', 'warning', 'error', 'success'])
    .withMessage('Level must be info, warning, error, or success'),
  validate
];

module.exports = {
  validate,
  loginValidation,
  backupRunValidation,
  scheduleValidation,
  settingsValidation,
  backupIdValidation,
  logsValidation
};
