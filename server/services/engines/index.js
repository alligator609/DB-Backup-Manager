const MongoEngine = require('./MongoEngine');
const MysqlEngine = require('./MysqlEngine');

const engines = {
  mongodb: MongoEngine,
  mysql: MysqlEngine
};

/**
 * Resolve the configured engine name from settings.
 * Defaults to 'mongodb' for backward compatibility.
 */
function getEngineName(settings) {
  return settings && settings.dbEngine === 'mysql' ? 'mysql' : 'mongodb';
}

/**
 * Get the engine implementation for the current settings.
 */
function getEngine(settings) {
  return engines[getEngineName(settings)];
}

/**
 * Get the engine implementation responsible for a given backup record.
 * Falls back to the currently configured engine when the backup predates
 * engine tracking (engine column is NULL).
 */
function getEngineForBackup(backup, settings) {
  const name = (backup && backup.engine) || getEngineName(settings);
  return engines[name] || engines.mongodb;
}

module.exports = { engines, getEngineName, getEngine, getEngineForBackup };
