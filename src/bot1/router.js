/**
 * Bot 1 — Master message router.
 * Flow: auth (already applied) → /command check → keyboard button check →
 *       draft buffer check → intent engine.
 *
 * Phase 2: Routes text messages through the intent engine to todo handlers.
 * Phase 3: Adds draft buffer check before intent engine for notes.
 * Phase 4: Adds reminder:done and reminder:snooze callback handlers.
 * Phase 5: Adds file handling (photo/document → Drive upload + task linking).
 */

const { Keyboard } = require('grammy');
const { classifyIntent } = require('./intentEngine');
const {
  handleAddTodo,
  handleCompleteTodo,
  handleCompleteCallback,
  handleListTodos,
  handleUpdateTodo,
} = require('./todo/handlers');
const {
  handleAddNote,
  handleSetReminder,
  handleListNotes,
  handlePromoteToTask,
  handleDraftSave,
  handleDraftDiscard,
  autoSaveDraft,
} = require('./notes/handlers');
const { handleAttachFile } = require('./files/handlers');
const {
  getDraft,
  appendToDraft,
  startSilenceTimer,
  clearSilenceTimer,
  checkIntentShift,
  isPreviewShown,
  getDraftContent,
} = require('./notes/buffer');
const { markReminderDone, snoozeReminder } = require('../shared/scheduler');
const { chat } = require('../utils/anthropic');
const { runHealthChecks, formatHealthMessage } = require('../utils/health');
const logger = require('../utils/logger');

/* Store bot reference for timer callbacks (set during registerRouter) */
let botInstance = null;

/* ─── Persistent reply keyboard ─── */

/* Button labels — used for both keyboard creation and text matching in router */
const KB = {
  TODAY: '📋 Today',
  INBOX: '📥 Inbox',
  NOTES: '📝 My Notes',
  IDEAS: '💡 My Ideas',
  REMINDERS: '⏰ Reminders',
  HELP: '❓ Help',
};

/**
 * Builds the persistent reply keyboard shown at the bottom of the chat.
 * Compact (resize_keyboard), always visible (is_persistent).
 */
function buildMainKeyboard() {
  return new Keyboard()
    .text(KB.TODAY).text(KB.INBOX).row()
    .text(KB.NOTES).text(KB.IDEAS).row()
    .text(KB.REMINDERS).text(KB.HELP)
    .resized()
    .persistent();
}

/* ─── Help text ─── */

const HELP_TEXT =
  'What I Can Do\n\n' +
  'TASKS\n' +
  '• "add todo: submit KLN report by Friday"\n' +
  '• "done with invoice task"\n' +
  '• "show today\'s tasks" or /today\n' +
  '• "push Solasta deadline to March 1"\n\n' +
  'NOTES\n' +
  '• "idea: tiered pricing for Overdrive"\n' +
  '  → I\'ll buffer your messages. Tap Save when done.\n' +
  '• "meeting with client — discussed renewal"\n' +
  '• "show my ideas" or /ideas\n\n' +
  'REMINDERS\n' +
  '• "remind me Friday 9am check lease renewal"\n' +
  '• /reminders to see active reminders\n\n' +
  'FILES\n' +
  '• Send any file (photo, PDF, doc) — uploaded to Google Drive\n' +
  '• Add a caption to link it to a task: "for the KLN report"\n' +
  '• No caption → creates a new Inbox task with the filename\n' +
  '• Office docs (docx/xlsx/pptx) auto-convert to PDF\n\n' +
  'PROMOTE NOTE → TASK\n' +
  '• Save a note, then reply "promote"\n\n' +
  'TIPS\n' +
  '• Send multiple messages — I\'ll buffer them into one note\n' +
  '• Tap Save/Discard when the draft preview appears\n' +
  '• Use the buttons below for quick access';

/**
 * Registers all command and message handlers on the bot instance.
 * Called once during bot setup.
 */
function registerRouter(bot) {
  botInstance = bot;

  /* ─── Slash commands ─── */

  /* /start — welcome message with persistent keyboard */
  bot.command('start', async (ctx) => {
    logger.info('Bot 1 /start command', { chatId: ctx.chat.id });
    await ctx.reply(
      'Hey Bryan! I\'m your Personal Assistant bot.\n\n' +
      'I can manage todos, quick notes, reminders, and send daily briefings.\n\n' +
      'Use the buttons below for quick access, or just type naturally.\n' +
      'Send /help for a full guide with examples.',
      { reply_markup: buildMainKeyboard() }
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

  /* /notes — shortcut for LIST_NOTES with all filter (bypasses Claude) */
  bot.command('notes', async (ctx) => {
    logger.info('Bot 1 /notes command', { chatId: ctx.chat.id });
    await handleListNotes(ctx, { intent: 'LIST_NOTES', filter: 'all' });
  });

  /* /ideas — shortcut for LIST_NOTES with ideas filter (bypasses Claude) */
  bot.command('ideas', async (ctx) => {
    logger.info('Bot 1 /ideas command', { chatId: ctx.chat.id });
    await handleListNotes(ctx, { intent: 'LIST_NOTES', filter: 'ideas' });
  });

  /* /reminders — shortcut for LIST_NOTES with reminders filter (bypasses Claude) */
  bot.command('reminders', async (ctx) => {
    logger.info('Bot 1 /reminders command', { chatId: ctx.chat.id });
    await handleListNotes(ctx, { intent: 'LIST_NOTES', filter: 'reminders' });
  });

  /* /help — full feature guide with examples */
  bot.command('help', async (ctx) => {
    logger.info('Bot 1 /help command', { chatId: ctx.chat.id });
    await ctx.reply(HELP_TEXT, { reply_markup: buildMainKeyboard() });
  });

  /* /health — system health check */
  bot.command('health', async (ctx) => {
    logger.info('Bot 1 /health command', { chatId: ctx.chat.id });
    await ctx.reply('Running health checks...');
    const results = await runHealthChecks();
    await ctx.reply(formatHealthMessage(results));
  });

  /**
   * Text message handler — keyboard buttons → draft buffer → intent engine.
   *
   * Flow:
   * 0. Check if text matches a keyboard button → handle directly (zero API cost)
   * 1. Check if draft buffer is open → handle buffer logic
   * 2. If no open draft, classify intent via Claude Haiku
   * 3. Route to the appropriate handler
   */
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const chatId = ctx.chat.id;
    logger.info('Bot 1 text message received', { chatId });

    try {
      /* ─── Step 0: Keyboard button shortcuts (zero API cost) ─── */
      const buttonHandled = await handleKeyboardButton(ctx, text);
      if (buttonHandled) return;

      /* ─── Step 1: Draft buffer check ─── */
      const draft = getDraft(chatId);

      if (draft) {
        /* A draft is open — decide how to handle the new message */

        if (!isPreviewShown(chatId)) {
          /* Still in BUFFERING state (within 5s, preview not shown yet).
             Just append the message and reset the silence timer. No API call. */
          appendToDraft(chatId, text);
          clearSilenceTimer(chatId);
          startSilenceTimer(chatId, botInstance);
          return;
        }

        /* In PREVIEWING state — run intent shift detection (1 Haiku call) */
        const draftContent = getDraftContent(chatId);
        const shiftResult = await checkIntentShift(draftContent, text);

        if (shiftResult.continues_draft) {
          /* Same topic — append to buffer, reset timers, go back to BUFFERING */
          appendToDraft(chatId, text);
          clearSilenceTimer(chatId);
          startSilenceTimer(chatId, botInstance);
          return;
        }

        /* Different intent — auto-save the current draft, then process new message */
        const saved = await autoSaveDraft(chatId);
        if (saved) {
          await ctx.reply(
            `Previous draft saved: "${saved.title}"\nReply "promote" to convert to task.`
          );
        } else {
          await ctx.reply('Previous draft queued for sync (Notion unreachable).');
        }

        /* Fall through to intent engine for the new message */
      }

      /* ─── Step 2: Classify the intent ─── */
      const intent = await classifyIntent(text);

      /* ─── Step 3: Route to the correct handler ─── */
      switch (intent.intent) {
        /* Todo module intents */
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

        /* File intent — text-only ATTACH_FILE (no file attached).
           Tell user to send the actual file. */
        case 'ATTACH_FILE':
          await ctx.reply(
            'It sounds like you want to attach a file. ' +
            'Send the file (photo, PDF, or document) and I\'ll upload it to Drive.'
          );
          break;

        /* Notes module intents */
        case 'ADD_NOTE':
          await handleAddNote(ctx, intent, botInstance);
          break;

        case 'SET_REMINDER':
          await handleSetReminder(ctx, intent);
          break;

        case 'LIST_NOTES':
          await handleListNotes(ctx, intent);
          break;

        case 'PROMOTE_TO_TASK':
          await handlePromoteToTask(ctx, intent);
          break;

        case 'UNKNOWN':
        default:
          /* Conversational fallback — use Haiku for a helpful reply */
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
   * Supports: complete:* (COMPLETE_TODO), draft:* (Notes Save/Discard)
   */
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    logger.info('Bot 1 callback query', { chatId: ctx.chat.id });

    try {
      if (data.startsWith('complete:')) {
        await handleCompleteCallback(ctx);
        return;
      }

      if (data === 'draft:save') {
        await handleDraftSave(ctx, botInstance);
        return;
      }

      if (data === 'draft:discard') {
        await handleDraftDiscard(ctx);
        return;
      }

      /* Reminder callbacks — Done marks complete, Snooze reschedules +1hr */
      if (data.startsWith('reminder:done:')) {
        const jobId = parseInt(data.split(':')[2], 10);
        markReminderDone(jobId);
        await ctx.answerCallbackQuery({ text: 'Reminder dismissed' });
        await ctx.editMessageText(`✅ ${ctx.callbackQuery.message.text} — done`);
        return;
      }

      if (data.startsWith('reminder:snooze:')) {
        const jobId = parseInt(data.split(':')[2], 10);
        snoozeReminder(jobId);
        await ctx.answerCallbackQuery({ text: 'Snoozed for 1 hour' });
        await ctx.editMessageText(`⏩ ${ctx.callbackQuery.message.text} — snoozed 1hr`);
        return;
      }

      /* Unknown callback — shouldn't happen but handle gracefully */
      await ctx.answerCallbackQuery({ text: 'Unknown action' });
    } catch (err) {
      logger.error('Callback query error', { error: err.message, data });
      await ctx.answerCallbackQuery({ text: 'Something went wrong' }).catch(() => {});
    }
  });

  /**
   * File/photo/document handler — routes to ATTACH_FILE handler.
   * Downloads from Telegram, converts if needed, uploads to Drive,
   * and links to a task (existing or new Inbox task).
   */
  bot.on(['message:photo', 'message:document'], async (ctx) => {
    logger.info('Bot 1 file received', { chatId: ctx.chat.id });
    try {
      await handleAttachFile(ctx);
    } catch (err) {
      logger.error('File handler error', { error: err.message, stack: err.stack });
      await ctx.reply('Something went wrong processing your file. Please try again.');
    }
  });
}

/* ─── Keyboard button handler ─── */

/**
 * Checks if the text matches a persistent keyboard button label.
 * If so, routes directly to the handler — zero API cost.
 *
 * @returns {boolean} — true if handled, false if not a button tap
 */
async function handleKeyboardButton(ctx, text) {
  switch (text) {
    case KB.TODAY:
      await handleListTodos(ctx, { intent: 'LIST_TODOS', filter: 'today' });
      return true;

    case KB.INBOX:
      await handleListTodos(ctx, { intent: 'LIST_TODOS', filter: 'inbox' });
      return true;

    case KB.NOTES:
      await handleListNotes(ctx, { intent: 'LIST_NOTES', filter: 'all' });
      return true;

    case KB.IDEAS:
      await handleListNotes(ctx, { intent: 'LIST_NOTES', filter: 'ideas' });
      return true;

    case KB.REMINDERS:
      await handleListNotes(ctx, { intent: 'LIST_NOTES', filter: 'reminders' });
      return true;

    case KB.HELP:
      await ctx.reply(HELP_TEXT, { reply_markup: buildMainKeyboard() });
      return true;

    default:
      return false;
  }
}

/* ─── UNKNOWN intent handler ─── */

/**
 * Handles UNKNOWN intent — conversational reply using Claude Haiku.
 * Gives a helpful response for messages that don't match any task or note intent.
 */
async function handleUnknown(ctx, text) {
  try {
    const response = await chat({
      system:
        'You are Bryan\'s personal assistant Telegram bot. You help manage tasks, notes, and reminders. ' +
        'If the user\'s message seems like they want to do something task-related but you\'re not sure, ' +
        'suggest what they might mean. Keep replies short and helpful (1-3 sentences max). ' +
        'You can suggest commands like /today, /inbox, /notes, or tell them to phrase requests naturally.',
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
      '- "idea: ..." to start a note\n' +
      '- "remind me ..." to set a reminder\n' +
      '- /today to see today\'s tasks\n' +
      '- /notes to see recent notes'
    );
  }
}

module.exports = { registerRouter };
