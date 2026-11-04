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
 * Get an engine implementation by name.
 */
function getEngineByName(name) {
  return engines[name] || null;
}

/**
 * Get the names of all ENABLED engines.
 * Back-compat: if the enabled flags are absent (pre-multi-engine settings),
 * derive them from the old exclusive dbEngine selector.
 */
function getEnabledEngineNames(settings) {
  if (!settings) return ['mongodb'];

  const mongoEnabled = settings.mongoEnabled !== undefined
    ? !!settings.mongoEnabled
    : settings.dbEngine !== 'mysql';
  const mysqlEnabled = settings.mysqlEnabled !== undefined
    ? !!settings.mysqlEnabled
    : settings.dbEngine === 'mysql';

  const names = [];
  if (mongoEnabled) names.push('mongodb');
  if (mysqlEnabled) names.push('mysql');
  return names;
}

/**
 * Engine names that are both enabled AND have their connection configured.
 */
function getReadyEngineNames(settings) {
  return getEnabledEngineNames(settings).filter(name => {
    const engine = engines[name];
    return engine && engine.isConfigured(settings);
  });
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

module.exports = {
  engines,
  getEngineName,
  getEngine,
  getEngineByName,
  getEnabledEngineNames,
  getReadyEngineNames,
  getEngineForBackup
};
