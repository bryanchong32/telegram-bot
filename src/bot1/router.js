/**
 * Bot 1 — Master message router.
 * Flow: auth (already applied) → /command check → type check → buffer/intent.
 *
 * Phase 2: Routes text messages through the intent engine to todo handlers.
 * Phase 3+: Will add draft buffer check before intent engine for notes.
 */

const { classifyIntent } = require('./intentEngine');
const {
  handleAddTodo,
  handleCompleteTodo,
  handleCompleteCallback,
  handleListTodos,
  handleUpdateTodo,
} = require('./todo/handlers');
const { chat } = require('../utils/anthropic');
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
      '/today — Show today\'s tasks\n' +
      '/inbox — Show inbox tasks\n' +
      '/health — Check system status\n\n' +
      'Or just send me a message and I\'ll figure out what to do with it.'
    );
  });

  /* /today — shortcut for LIST_TODOS with today filter (bypasses Claude) */
  bot.command('today', async (ctx) => {
    logger.info('Bot 1 /today command', { chatId: ctx.chat.id });
    await handleListTodos(ctx, { intent: 'LIST_TODOS', filter: 'today' });
  });

  /* /inbox — shortcut for LIST_TODOS with inbox filter (bypasses Claude) */
  bot.command('inbox', async (ctx) => {
    logger.info('Bot 1 /inbox command', { chatId: ctx.chat.id });
    await handleListTodos(ctx, { intent: 'LIST_TODOS', filter: 'inbox' });
  });

  /* /health — system health check (handler registered in index.js via healthCommand) */
  /* Registered separately so health module can access db + Notion status */

  /**
   * Text message handler — routes through intent engine to the correct handler.
   *
   * Flow:
   * 1. (Phase 3) Check if draft buffer is open → intent shift detection
   * 2. Classify intent via Claude Haiku
   * 3. Route to the appropriate handler
   */
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    logger.info('Bot 1 text message received', { chatId: ctx.chat.id });

    try {
      /* Step 1: Classify the intent */
      const intent = await classifyIntent(text);

      /* Step 2: Route to the correct handler */
      switch (intent.intent) {
        case 'ADD_TODO':
          await handleAddTodo(ctx, intent);
          break;

        case 'COMPLETE_TODO':
          await handleCompleteTodo(ctx, intent);
          break;

        case 'LIST_TODOS':
          await handleListTodos(ctx, intent);
          break;

        case 'UPDATE_TODO':
          await handleUpdateTodo(ctx, intent);
          break;

        case 'UNKNOWN':
        default:
          /* Conversational fallback — use Sonnet for a helpful reply */
          await handleUnknown(ctx, text);
          break;
      }
    } catch (err) {
      logger.error('Router error', { error: err.message, stack: err.stack });
      await ctx.reply('Something went wrong processing your message. Please try again.');
    }
  });

  /**
   * Callback query handler — routes inline button taps to the correct handler.
   * Supports: complete:* (COMPLETE_TODO confirmation), draft:* (Phase 3)
   */
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    logger.info('Bot 1 callback query', { chatId: ctx.chat.id });

    if (data.startsWith('complete:')) {
      await handleCompleteCallback(ctx);
      return;
    }

    /* Phase 3: draft:save, draft:discard */
    /* Phase 4: reminder:done, reminder:snooze */
    await ctx.answerCallbackQuery({ text: 'Not yet implemented' });
  });

  /**
   * File/photo/document handler — Phase 5: will route to ATTACH_FILE handler.
   */
  bot.on(['message:photo', 'message:document'], async (ctx) => {
    logger.info('Bot 1 file received', { chatId: ctx.chat.id });
    await ctx.reply('File received. File handling coming in Phase 5.');
  });
}

/**
 * Handles UNKNOWN intent — conversational reply using Claude Sonnet.
 * Gives a helpful response for messages that don't match any task intent.
 */
async function handleUnknown(ctx, text) {
  try {
    const response = await chat({
      system:
        'You are Bryan\'s personal assistant Telegram bot. You help manage tasks, notes, and reminders. ' +
        'If the user\'s message seems like they want to do something task-related but you\'re not sure, ' +
        'suggest what they might mean. Keep replies short and helpful (1-3 sentences max). ' +
        'You can suggest commands like /today, /inbox, or tell them to phrase task requests naturally.',
      userMessage: text,
      model: 'haiku',
      maxTokens: 256,
    });
    await ctx.reply(response);
  } catch (err) {
    logger.error('UNKNOWN handler failed', { error: err.message });
    await ctx.reply(
      'I\'m not sure what to do with that. Try:\n' +
      '- "add todo: ..." to create a task\n' +
      '- "done with ..." to complete a task\n' +
      '- /today to see today\'s tasks\n' +
      '- /inbox to see unprocessed tasks'
    );
  }
}

module.exports = { registerRouter };
