/**
 * Structured logger for Bot 4 (Order Entry).
 * Same pattern as bot3/logger.js but tagged for bot4.
 */

const config = require('./config');
const isDev = config.NODE_ENV !== 'production';

function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    bot: 'bot4-order',
    message,
    ...meta,
  };
  const output = isDev ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
