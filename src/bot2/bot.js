/**
 * Bot 2 — Receipt & Expense Tracker.
 * Sets up the grammY bot instance with auth middleware and
 * registers the message router.
 */

const { Bot } = require('grammy');
const config = require('../shared/config');
const { authMiddleware } = require('../shared/auth');
const { registerRouter } = require('./router');
const logger = require('../utils/logger');

/* Create bot instance with Bot 2 token */
const bot2 = new Bot(config.TELEGRAM_BOT2_TOKEN);

/* Auth middleware — silently drops messages from non-whitelisted users */
bot2.use(authMiddleware);

/* Register all command + message handlers */
registerRouter(bot2);

/* Error handler — log and notify user of unexpected failures */
bot2.catch((err) => {
  logger.error('Bot 2 unhandled error', {
    error: err.message,
    stack: err.stack,
  });

  try {
    err.ctx?.reply('Something went wrong. Please try again.').catch(() => {});
  } catch (_) {
    /* Silently ignore */
  }
});

module.exports = { bot2 };
