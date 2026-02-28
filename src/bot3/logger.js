/**
 * Structured logger for Bot 3 (Request Agent).
 * Same pattern as src/utils/logger.js but uses bot3's own config.
 *
 * SECURITY: Never log file content — requests may contain
 * sensitive project details. Log IDs and metadata only.
 */

const config = require('./config');

function timestamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }).replace(' ', 'T');
}

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
    if (config.NODE_ENV === 'development') {
      log('debug', msg, meta);
    }
  },
};
