/**
 * Bot 3 — Request Agent.
 * Sets up the grammY bot instance with auth middleware and
 * registers the message router.
 */

const { Bot } = require('grammy');
const config = require('./config');
const { registerRouter } = require('./router');
const logger = require('./logger');

/* Create bot instance with Request Agent token */
const bot3 = new Bot(config.REQUEST_AGENT_BOT_TOKEN);

/* Auth middleware — silently drops messages from non-whitelisted users.
   Inlined here (instead of importing shared/auth) because shared/config
   would require Bot 1/2 env vars that this process doesn't have. */
bot3.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (userId !== config.ALLOWED_TELEGRAM_USER_ID) {
    logger.warn('Unauthorised access attempt', { userId });
    return;
  }

  return next();
});

/* Register all command + message handlers */
registerRouter(bot3);

/* Set bot commands menu (visible in Telegram) */
bot3.api.setMyCommands([
  { command: 'start', description: 'What this bot does' },
  { command: 'help', description: 'Usage instructions' },
  { command: 'health', description: 'System status' },
]).catch((err) => logger.warn('setMyCommands failed (Bot 3)', { error: err.message }));

/* Error handler — log and notify user of unexpected failures */
bot3.catch((err) => {
  logger.error('Bot 3 unhandled error', {
    error: err.message,
    stack: err.stack,
  });

  try {
    err.ctx?.reply('Something went wrong. Please try again.').catch(() => {});
  } catch (_) {
    /* Silently ignore */
  }
});

module.exports = { bot3 };
