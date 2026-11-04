const { spawn, spawnSync } = require('child_process');
const fs = require('fs').promises;
const { createWriteStream, createReadStream } = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const mysql = require('mysql2/promise');
const LogService = require('../LogService');

// How many bytes of tool banner/header output an "empty" binlog slice can have.
const EMPTY_BINLOG_THRESHOLD = 1024;

/**
 * MySQL engine implementation.
 * Full backups stream mysqldump through gzip.
 * Incremental backups dump a binlog slice via mysqlbinlog --read-from-remote-server.
 * PITR restores pipe dump/binlog SQL into the mysql client.
 *
 * Compatible with Oracle MySQL and MariaDB client tools
 * (mysqldump/mariadb-dump, mysql/mariadb, mysqlbinlog/mariadb-binlog).
 */
class MysqlEngine {
  constructor() {
    this.name = 'mysql';
    this.label = 'MySQL';
    this.fullFileExtension = '.sql.gz';
    this.incrementalFileExtension = '.binlog.sql.gz';
    this.changeLogName = 'binlog';
    this._toolCache = {};
  }

  /**
   * Resolve the first available binary from a list of candidate names.
   * Prefers MariaDB tools (what Alpine ships) then falls back to Oracle names.
   */
  resolveTool(candidates) {
    const key = candidates.join(',');
    if (this._toolCache[key]) return this._toolCache[key];

    for (const name of candidates) {
      const probe = spawnSync(name, ['--version'], { stdio: 'ignore' });
      if (!probe.error) {
        this._toolCache[key] = name;
        return name;
      }
    }

    throw new Error(`None of these tools are installed: ${candidates.join(', ')}`);
  }

  dumpTool() { return this.resolveTool(['mariadb-dump', 'mysqldump']); }
  clientTool() { return this.resolveTool(['mariadb', 'mysql']); }
  binlogTool() { return this.resolveTool(['mariadb-binlog', 'mysqlbinlog']); }

  isConfigured(settings) {
    return !!(settings.mysqlHost && settings.mysqlUser);
  }

  /**
   * Name of the database being backed up (empty setting = all databases)
   */
  getTargetName(settings) {
    return settings.mysqlDatabase || 'all databases';
  }

  assertConfigured(settings) {
    if (!settings.mysqlHost || !settings.mysqlUser) {
      throw new Error('MySQL connection not configured (host and user are required)');
    }
  }

  /**
   * Shared connection args for the CLI tools. Password is passed via
   * MYSQL_PWD so it never appears in the process list or logs.
   */
  connArgs(settings) {
    return [
      '--protocol=tcp',
      `--host=${settings.mysqlHost}`,
      `--port=${settings.mysqlPort || 3306}`,
      `--user=${settings.mysqlUser}`
    ];
  }

  connEnv(settings) {
    const env = { ...process.env };
    if (settings.mysqlPassword) env.MYSQL_PWD = settings.mysqlPassword;
    return env;
  }

  connOptions(settings) {
    return {
      host: settings.mysqlHost,
      port: settings.mysqlPort || 3306,
      user: settings.mysqlUser,
      password: settings.mysqlPassword || '',
      connectTimeout: 10000
    };
  }

  async connect(settings) {
    return mysql.createConnection(this.connOptions(settings));
  }

  /**
   * Test the MySQL connection
   */
  async testConnection(settings) {
    this.assertConfigured(settings);
    let conn;
    try {
      conn = await this.connect(settings);
      const [rows] = await conn.query('SELECT VERSION() AS version');
      await conn.end();
      return {
        success: true,
        message: 'Connection successful',
        details: { version: rows[0].version }
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      return { success: false, message: error.message };
    }
  }

  /**
   * Check whether binary logging is enabled (required for incremental/PITR).
   */
  async checkIncrementalSupport(settings) {
    let conn;
    try {
      this.assertConfigured(settings);
      conn = await this.connect(settings);

      const [logBin] = await conn.query("SHOW VARIABLES LIKE 'log_bin'");
      const [format] = await conn.query("SHOW VARIABLES LIKE 'binlog_format'");

      const enabled = logBin.length > 0 && String(logBin[0].Value).toUpperCase() === 'ON';
      const binlogFormat = format.length > 0 ? format[0].Value : null;
      await conn.end();

      return {
        supported: enabled,
        label: 'Binary logging',
        binlogFormat,
        message: enabled
          ? `Binary logging enabled (format: ${binlogFormat || 'unknown'})`
          : 'Binary logging is disabled (log_bin=OFF). Incremental backups and PITR require binlog enabled on the server.'
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      return { supported: false, label: 'Binary logging', error: error.message };
    }
  }

  /**
   * Current binlog coordinates: { file, pos }
   */
  async binlogStatus(conn) {
    let rows;
    try {
      [rows] = await conn.query('SHOW BINARY LOG STATUS'); // MySQL 8.4+
    } catch {
      [rows] = await conn.query('SHOW MASTER STATUS'); // MySQL < 8.4 / MariaDB
    }
    if (!rows || rows.length === 0) {
      throw new Error('Binary logging is not enabled on the MySQL server (log_bin=OFF)');
    }
    return { file: rows[0].File, pos: rows[0].Position };
  }

  /**
   * Ordered list of binlog file names on the server.
   */
  async listBinlogFiles(conn) {
    const [rows] = await conn.query('SHOW BINARY LOGS');
    if (!rows || rows.length === 0) {
      throw new Error('No binary logs found on the server');
    }
    return rows.map(r => r.Log_name);
  }

  /**
   * Spawn a tool, pipe its stdout through gzip into outputPath.
   */
  spawnToGzip(command, args, env, outputPath) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { env });
      const gzip = zlib.createGzip();
      const out = createWriteStream(outputPath);
      let stderr = '';
      let stdoutBytes = 0;

      proc.stdout.on('data', d => { stdoutBytes += d.length; });
      proc.stdout.pipe(gzip).pipe(out);
      proc.stderr.on('data', d => { stderr += d.toString(); });

      const fail = (err) => {
        out.destroy();
        reject(err);
      };

      proc.on('error', fail);
      out.on('error', fail);
      proc.on('close', (code) => {
        if (code === 0) {
          out.on('finish', () => resolve({ stdoutBytes }));
        } else {
          fail(new Error(`${command} failed with code ${code}: ${stderr}`));
        }
      });
    });
  }

  /**
   * Pipe a gzipped SQL file into the mysql client.
   */
  pipeSqlToMysql(settings, filePath, { force = false } = {}) {
    return new Promise((resolve, reject) => {
      const args = this.connArgs(settings);
      if (force) args.push('--force');

      const proc = spawn(this.clientTool(), args, { env: this.connEnv(settings) });
      const input = createReadStream(filePath).pipe(zlib.createGunzip());
      let stderr = '';

      input.pipe(proc.stdin);
      proc.stderr.on('data', d => { stderr += d.toString(); });

      const fail = (err) => {
        proc.kill();
        reject(err);
      };

      input.on('error', fail);
      proc.on('error', fail);
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`mysql client failed with code ${code}: ${stderr}`));
        }
      });
    });
  }

  /**
   * Extract MASTER_LOG_FILE / MASTER_LOG_POS written by --master-data=2
   * from the head of a gzipped dump.
   */
  async parseBinlogCoordsFromDump(filePath) {
    const rl = readline.createInterface({
      input: createReadStream(filePath).pipe(zlib.createGunzip()),
      crlfDelay: Infinity
    });

    const re = /MASTER_LOG_FILE='([^']+)'\s*,\s*MASTER_LOG_POS=(\d+)/;
    let lineCount = 0;
    try {
      for await (const line of rl) {
        lineCount++;
        const match = line.match(re);
        if (match) return { file: match[1], pos: parseInt(match[2]) };
        if (lineCount > 200) break; // coords always appear in the header
      }
    } catch {
      return null;
    } finally {
      rl.close();
    }
    return null;
  }

  /**
   * Full backup: mysqldump --single-transaction --master-data=2, gzipped.
   * Returns { logEnd } — the binlog coordinates at snapshot time, used as
   * the starting point for the next incremental backup.
   */
  async fullBackup(settings, outputPath) {
    this.assertConfigured(settings);

    const baseArgs = [
      '--single-transaction',
      '--quick',
      '--routines',
      '--triggers',
      '--events'
    ];
    if (settings.mysqlDatabase) {
      baseArgs.push('--databases', settings.mysqlDatabase);
    } else {
      baseArgs.push('--all-databases');
    }

    // --master-data=2 embeds consistent binlog coords in the dump header.
    // It needs RELOAD privilege and binary logging enabled;
    // fall back without it if the server refuses.
    let usedMasterData = true;
    try {
      await this.spawnToGzip(
        this.dumpTool(),
        [...this.connArgs(settings), '--master-data=2', ...baseArgs],
        this.connEnv(settings),
        outputPath
      );
    } catch (err) {
      if (/access denied|privilege|reload|lock tables|binlog|binary log/i.test(err.message)) {
        await LogService.log('warning', 'mysqldump --master-data failed (missing RELOAD privilege or binary logging disabled), retrying without consistent binlog coordinates');
        await fs.unlink(outputPath).catch(() => {});
        usedMasterData = false;
        await this.spawnToGzip(
          this.dumpTool(),
          [...this.connArgs(settings), ...baseArgs],
          this.connEnv(settings),
          outputPath
        );
      } else {
        throw err;
      }
    }

    // Determine the binlog position marking the end of this backup.
    let logEnd = null;
    if (usedMasterData) {
      logEnd = await this.parseBinlogCoordsFromDump(outputPath);
    }
    if (!logEnd) {
      // Fallback: current position. May overshoot the snapshot slightly;
      // overshooting means the next incremental starts a bit later.
      try {
        const conn = await this.connect(settings);
        logEnd = await this.binlogStatus(conn).catch(() => null);
        await conn.end();
      } catch {
        logEnd = null;
      }
    }

    return { logEnd };
  }

  /**
   * Incremental backup: dump the binlog range covering
   * (lastBackup.log_end) .. (current binlog position).
   */
  async incrementalBackup(settings, outputPath, lastBackup) {
    this.assertConfigured(settings);

    const conn = await this.connect(settings);
    let files, end;
    try {
      files = await this.listBinlogFiles(conn);
      end = await this.binlogStatus(conn);
    } finally {
      await conn.end();
    }

    // Starting coordinates: end position of the previous backup if recorded,
    // otherwise start from the first available binlog file.
    let start = null;
    if (lastBackup.log_end) {
      try {
        start = JSON.parse(lastBackup.log_end);
      } catch {
        start = null;
      }
    }
    if (!start || !start.file) {
      start = { file: files[0], pos: 4 }; // 4 = skip magic header
    }

    const startIdx = files.indexOf(start.file);
    const selectedFiles = startIdx >= 0 ? files.slice(startIdx) : files;

    const args = [
      ...this.connArgs(settings),
      '--read-from-remote-server',
      `--start-position=${start.pos}`
    ];

    // --stop-position applies to the LAST binlog file on the command line.
    if (end.file === selectedFiles[selectedFiles.length - 1]) {
      args.push(`--stop-position=${end.pos}`);
    }

    args.push(...selectedFiles);

    console.log(`[MysqlEngine] Binlog slice: ${start.file}:${start.pos} -> ${end.file}:${end.pos} (${selectedFiles.length} file(s))`);

    const { stdoutBytes } = await this.spawnToGzip(
      this.binlogTool(),
      args,
      this.connEnv(settings),
      outputPath
    );

    return {
      logStart: start,
      logEnd: end,
      empty: stdoutBytes < EMPTY_BINLOG_THRESHOLD
    };
  }

  /**
   * Restore a full backup: pipe the SQL dump into the mysql client.
   */
  async restoreFull(settings, filePath) {
    this.assertConfigured(settings);
    await LogService.log('info', 'Restoring MySQL dump...');
    await this.pipeSqlToMysql(settings, filePath);
  }

  /**
   * Apply an incremental backup (binlog SQL slice) by piping it into mysql.
   * --force keeps replay going past duplicate-key errors, matching the
   * error-tolerant behavior of the MongoDB oplog replay.
   */
  async applyIncremental(settings, filePath) {
    this.assertConfigured(settings);
    await LogService.log('info', 'Applying incremental binlog slice...');
    await this.pipeSqlToMysql(settings, filePath, { force: true });
  }

  /**
   * Inspect a backup file: scan the SQL text for CREATE TABLE / USE /
   * binlog "### INSERT INTO db.table" style statements.
   */
  async inspect(settings, filePath) {
    const rl = readline.createInterface({
      input: createReadStream(filePath).pipe(zlib.createGunzip()),
      crlfDelay: Infinity
    });

    const structure = {};
    let currentDb = settings.mysqlDatabase || null;
    let output = '';
    const maxLines = 200000;
    let lineCount = 0;

    const addTable = (db, table) => {
      if (!db || !table) return;
      db = db.replace(/`/g, '');
      table = table.replace(/`/g, '');
      if (!structure[db]) structure[db] = [];
      if (!structure[db].includes(table)) structure[db].push(table);
    };

    try {
      for await (const line of rl) {
        if (lineCount++ > maxLines) break;
        if (output.length < 5000) output += line + '\n';

        let m = line.match(/^USE `?([^`\s;]+)`?/i);
        if (m) { currentDb = m[1]; continue; }

        m = line.match(/^CREATE DATABASE\s+(?:IF NOT EXISTS\s+)?`?([^`\s;]+)`?/i);
        if (m) { if (!structure[m[1]]) structure[m[1]] = []; continue; }

        m = line.match(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?([^`\s;(]+)`?\.?`?([^`\s;(]+)`?/i);
        if (m) {
          // Handles both `db`.`table` and bare `table` (uses currentDb)
          if (line.indexOf('`.`') !== -1 || /\.\s*`/.test(line)) {
            addTable(m[1], m[2]);
          } else {
            addTable(currentDb, m[1]);
          }
          continue;
        }

        // mysqlbinlog output: "### INSERT INTO `db`.`table`"
        m = line.match(/^###\s+(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*`?([^`\s.]+)`?\.`?([^`\s]+)`?/i);
        if (m) {
          addTable(m[1], m[2]);
          continue;
        }
      }
    } finally {
      rl.close();
    }

    return { structure, rawOutput: output };
  }
}

module.exports = new MysqlEngine();
