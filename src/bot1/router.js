/**
 * Bot 1 — Master message router.
 * Flow: auth (already applied) → /command check → type check → buffer/intent.
 *
 * Phase 1: Only handles /start, /health, and echoes text messages.
 * Phase 2+: Will route to intent engine → todo/notes/files modules.
 */

const logger = require('../utils/logger');

/**
 * Registers all command and message handlers on the bot instance.
 * Called once during bot setup.
 */
function registerRouter(bot) {
  /* /start — welcome message */
  bot.command('start', async (ctx) => {
    logger.info('Bot 1 /start command', { chatId: ctx.chat.id });
    await ctx.reply(
      'Hey Bryan! I\'m your Personal Assistant bot.\n\n' +
      'I can manage todos, quick notes, reminders, and send daily briefings.\n\n' +
      'Commands:\n' +
      '/health — Check system status\n\n' +
      'Or just send me a message and I\'ll figure out what to do with it.'
    );
  });

  /* /health — system health check (handler registered in index.js via healthCommand) */
  /* Registered separately so health module can access db + Notion status */

  /**
   * Text message handler — Phase 1: echo back to confirm receipt.
   * Phase 2+: will route to draft buffer check → intent engine.
   */
  bot.on('message:text', async (ctx) => {
    logger.info('Bot 1 text message received', { chatId: ctx.chat.id });

    /* Phase 1: Echo the message back to confirm the bot is working */
    await ctx.reply(`Got it: "${ctx.message.text}"\n\n(Intent engine coming in Phase 2)`);
  });

  /* Callback query handler — for inline button taps (Save/Discard in Phase 3) */
  bot.on('callback_query:data', async (ctx) => {
    logger.info('Bot 1 callback query', { chatId: ctx.chat.id, data: ctx.callbackQuery.data });
    await ctx.answerCallbackQuery({ text: 'Coming in Phase 3' });
  });

  /**
   * File/photo/document handler — Phase 1: acknowledge receipt.
   * Phase 5: will route to ATTACH_FILE handler.
   */
  bot.on(['message:photo', 'message:document'], async (ctx) => {
    logger.info('Bot 1 file received', { chatId: ctx.chat.id });
    await ctx.reply('File received. File handling coming in Phase 5.');
  });
}

module.exports = { registerRouter };
