/**
 * Telegram user ID whitelist.
 * Silently ignores all messages from non-whitelisted users.
 * Used as grammY middleware — drops the update before any handler runs.
 */

const config = require('./config');
const logger = require('../utils/logger');

/**
 * grammY middleware: checks if the message sender matches
 * the allowed Telegram user ID. If not, silently drops the update.
 */
function authMiddleware(ctx, next) {
  const userId = ctx.from?.id;

  /* No sender info (e.g. channel posts) — ignore */
  if (!userId) return;

  /* Not the allowed user — silently ignore, log for awareness */
  if (userId !== config.ALLOWED_TELEGRAM_USER_ID) {
    logger.warn('Unauthorised access attempt', { userId });
    return;
  }

  /* Authorised — continue to next middleware / handler */
  return next();
}

module.exports = { authMiddleware };
