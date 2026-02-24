/**
 * Bot 2 — Receipt Tracker message router.
 *
 * Phase 1: Only handles /start, /health, and acknowledges photos/docs.
 * Phase 6: Will route photos to Claude Vision → Sheets → Drive pipeline.
 */

const logger = require('../utils/logger');

/**
 * Registers all command and message handlers on the bot instance.
 */
function registerRouter(bot) {
  /* /start — welcome message */
  bot.command('start', async (ctx) => {
    logger.info('Bot 2 /start command', { chatId: ctx.chat.id });
    await ctx.reply(
      'Hey Bryan! I\'m your Receipt & Expense Tracker bot.\n\n' +
      'Send me a receipt photo or PDF and I\'ll extract the details, ' +
      'log to Google Sheets, and store the original in Google Drive.\n\n' +
      'Commands:\n' +
      '/health — Check system status\n\n' +
      'Receipt processing coming in Phase 6.'
    );
  });

  /* Photo/document handler — Phase 1: acknowledge. Phase 6: Claude Vision pipeline. */
  bot.on(['message:photo', 'message:document'], async (ctx) => {
    logger.info('Bot 2 file received', { chatId: ctx.chat.id });
    await ctx.reply('Receipt received. Vision processing coming in Phase 6.');
  });

  /* Text handler — Phase 1: echo. Phase 6: expense queries. */
  bot.on('message:text', async (ctx) => {
    logger.info('Bot 2 text message received', { chatId: ctx.chat.id });
    await ctx.reply('Expense queries coming in Phase 6. For now, send me a receipt photo.');
  });
}

module.exports = { registerRouter };
