/**
 * Bot 4 — Order Entry Bot.
 * Sets up the grammY bot instance with group-only middleware
 * and registers the message router.
 */

const { Bot } = require('grammy');
const config = require('./config');
const logger = require('./logger');
const { registerRouter } = require('./router');

const bot4 = new Bot(config.TELEGRAM_BOT4_TOKEN);

/* Group-only middleware — silently ignore messages from other chats */
bot4.use((ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId !== config.TELEGRAM_ORDER_GROUP_ID) {
    logger.warn('Message from unauthorized chat', { chatId });
    return;
  }
  return next();
});

/* Register all command + message handlers */
registerRouter(bot4);

/* Set bot commands menu (visible in Telegram) */
bot4.api.setMyCommands([
  { command: 'start', description: '啟動 Order Bot' },
  { command: 'help', description: '使用說明' },
  { command: 'promo', description: '管理優惠 (admin only)' },
  { command: 'health', description: 'Bot 健康狀態' },
]).catch((err) => logger.warn('Failed to set commands', { error: err.message }));

/* Error handler — log and notify user of unexpected failures */
bot4.catch((err) => {
  logger.error('Unhandled bot error', { error: err.message, stack: err.stack });
  try {
    err.ctx?.reply('⚠️ 系統錯誤，請稍後再試。').catch(() => {});
  } catch (_) {
    /* Silently ignore */
  }
});

module.exports = { bot4 };
