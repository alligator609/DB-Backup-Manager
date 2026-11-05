/**
 * Mask credentials inside command-line arguments before they are logged.
 * Handles mongodb:// and mongodb+srv:// URIs with user:pass@ embedded,
 * plus common -p/--password style flags.
 */
function sanitizeArgs(args) {
  return args.map(a =>
    String(a)
      // mongodb://user:pass@host  and  mongodb+srv://user:pass@host
      .replace(/(mongodb\+srv:\/\/|mongodb:\/\/)([^:/@\s]+):([^@\s]+)@/gi, '$1$2:***@')
      // mysql://user:pass@host
      .replace(/(mysql:\/\/)([^:/@\s]+):([^@\s]+)@/gi, '$1$2:***@')
      // -pSecret or --password=Secret
      .replace(/(--password=)(\S+)/i, '$1***')
  );
}

module.exports = { sanitizeArgs };

/**
 * Parse a comma-separated database list into a trimmed, non-empty array.
 * Empty/blank input -> [] meaning "all databases".
 */
function parseDbList(str) {
  return String(str || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

module.exports = { sanitizeArgs, parseDbList };
