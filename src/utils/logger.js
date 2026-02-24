/**
 * Structured logger.
 * Outputs JSON lines to stdout/stderr for easy parsing.
 *
 * SECURITY: Never log message content — messages may contain
 * personal or financial information. Log intent names, IDs,
 * and metadata only.
 */

const config = require('../shared/config');

/** Returns ISO timestamp in MYT (UTC+8) */
function timestamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }).replace(' ', 'T');
}

/** Core log function — writes a JSON line to stdout/stderr */
function log(level, message, meta = {}) {
  const entry = {
    ts: timestamp(),
    level,
    msg: message,
    ...meta,
  };

  const line = JSON.stringify(entry);

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  debug: (msg, meta) => {
    /* Only emit debug logs in development */
    if (config.NODE_ENV === 'development') {
      log('debug', msg, meta);
    }
  },
};
