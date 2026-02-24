/**
 * Bot 1 — Personal Assistant.
 * Sets up the grammY bot instance with auth middleware and
 * registers the message router + command handlers.
 */

const { Bot } = require('grammy');
const config = require('../shared/config');
const { authMiddleware } = require('../shared/auth');
const { registerRouter } = require('./router');
const logger = require('../utils/logger');

/* Create bot instance with Bot 1 token */
const bot1 = new Bot(config.TELEGRAM_BOT1_TOKEN);

/* Auth middleware — silently drops messages from non-whitelisted users */
bot1.use(authMiddleware);

/* Register all command + message handlers */
registerRouter(bot1);

/* Error handler — log and notify user of unexpected failures */
bot1.catch((err) => {
  logger.error('Bot 1 unhandled error', {
    error: err.message,
    stack: err.stack,
  });

  /* Try to notify the user — best effort, don't throw if this also fails */
  try {
    err.ctx?.reply('Something went wrong. Please try again.').catch(() => {});
  } catch (_) {
    /* Silently ignore if we can't even reply */
  }
});

module.exports = { bot1 };
