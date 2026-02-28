/**
 * Notes Module — Intent Handlers.
 *
 * Handles ADD_NOTE, SET_REMINDER, LIST_NOTES, PROMOTE_TO_TASK intents,
 * plus draft:save and draft:discard callback queries.
 *
 * Each handler receives the grammY context (ctx) and the parsed intent object
 * from the intent engine, then interacts with Notion via the notes/notion module.
 */

const { InlineKeyboard } = require('grammy');
const {
  createNote,
  queryNotes,
  searchNotes,
  markNotePromoted,
  getNoteTitle,
  getNoteContent,
  getNoteSelect,
  getNoteDate,
} = require('./notion');
const { createTask } = require('../todo/notion');
const {
  getDraft,
  openDraft,
  deleteDraft,
  getDraftContent,
  generateNoteMetadata,
  getLastSavedNote,
  setLastSavedNote,
  clearAllTimers,
  startSilenceTimer,
} = require('./buffer');
const { db } = require('../../shared/db');
const { nowMYT } = require('../../utils/dates');
const logger = require('../../utils/logger');

/**
 * Handles ADD_NOTE intent — opens a new draft buffer for the note.
 * The first message goes into the buffer. Subsequent messages are handled
 * by the router's draft buffer check (not this handler).
 *
 * @param {Object} ctx — grammY context
 * @param {Object} intent — parsed intent from intent engine
 * @param {Object} bot — the grammY bot instance (for timer callbacks)
 */
async function handleAddNote(ctx, intent, bot) {
  const chatId = ctx.chat.id;
  const content = intent.content || ctx.message.text;

  /* Open a new draft buffer with the first message */
  openDraft(chatId, content, 'Text');

  /* Start the 5s silence timer — sends preview after 5s of no new messages */
  startSilenceTimer(chatId, bot);

  logger.info('ADD_NOTE: draft buffer opened', { chatId });
}

/**
 * Handles SET_REMINDER intent — creates a minimal note + scheduler entry.
 * No draft buffer involved — immediate save.
 *
 * @param {Object} ctx — grammY context
 * @param {Object} intent — parsed intent with message and remind_at
 */
async function handleSetReminder(ctx, intent) {
  const chatId = ctx.chat.id;

  try {
    /* Create a minimal note in Quick Notes DB */
    const page = await createNote({
      title: intent.message || 'Reminder',
      content: intent.message || '',
      type: 'Idea',
      stream: null,
      remindAt: intent.remind_at || null,
      source: 'Text',
    });

    /* Schedule the reminder in the unified scheduler */
    if (intent.remind_at) {
      db.prepare(
        'INSERT INTO scheduled_jobs (type, payload, next_run_at, chat_id) VALUES (?, ?, ?, ?)'
      ).run(
        'reminder',
        JSON.stringify({
          message: intent.message,
          note_id: page.id,
        }),
        intent.remind_at,
        chatId
      );

      await ctx.reply(
        `Reminder set: "${intent.message}"\n` +
        `When: ${intent.remind_at}\n` +
        `Saved to Quick Notes.`
      );
    } else {
      await ctx.reply(
        `Note saved: "${intent.message}"\n` +
        `(No reminder time specified — saved as a note only)`
      );
    }

    logger.info('SET_REMINDER completed', { chatId, hasRemindAt: !!intent.remind_at });
  } catch (err) {
    logger.error('SET_REMINDER failed', { error: err.message });
    queuePendingSync('create_note', intent);
    await ctx.reply('Notion is unreachable. Reminder queued locally and will sync when restored.');
  }
}

/**
 * Handles LIST_NOTES intent — queries Quick Notes DB and formats results.
 *
 * @param {Object} ctx — grammY context
 * @param {Object} intent — parsed intent with filter and optional search_term
 */
async function handleListNotes(ctx, intent) {
  try {
    const filter = intent.filter || 'all';
    const searchTerm = intent.search_term || null;

    const notes = await queryNotes(filter, searchTerm);

    if (notes.length === 0) {
      const labels = {
        all: 'No notes found.',
        ideas: 'No idea notes found.',
        meetings: 'No meeting notes found.',
        voice: 'No voice notes found.',
        reminders: 'No active reminders found.',
      };
      await ctx.reply(labels[filter] || 'No notes found.');
      return;
    }

    /* Build the header based on filter type */
    const header = {
      all: 'Your Notes',
      ideas: 'Your Ideas',
      meetings: 'Meeting Notes',
      voice: 'Voice Notes',
      reminders: 'Active Reminders',
    };

    let message = `${header[filter] || 'Notes'} (${notes.length})\n\n`;

    /* Format each note as a numbered list */
    notes.forEach((page, i) => {
      const title = getNoteTitle(page);
      const type = getNoteSelect(page, 'Type') || '';
      const stream = getNoteSelect(page, 'Stream') || '';
      const remindAt = getNoteDate(page, 'Remind At');
      const createdTime = page.created_time;

      /* Calculate relative time from created_time */
      const relativeTime = formatRelativeTime(createdTime);

      let line = `${i + 1}. ${title}`;
      const meta = [];
      if (type) meta.push(type);
      if (stream) meta.push(stream);
      if (remindAt) meta.push(`remind: ${remindAt}`);
      meta.push(relativeTime);

      if (meta.length > 0) line += ` — ${meta.join(', ')}`;
      message += line + '\n';
    });

    message += '\nReply "promote [note name]" to convert to task.';

    await ctx.reply(message.trim());

    logger.info('LIST_NOTES completed', { filter, count: notes.length });
  } catch (err) {
    logger.error('LIST_NOTES failed', { error: err.message });
    await ctx.reply('Failed to fetch notes from Notion. Please try again.');
  }
}

/**
 * Handles PROMOTE_TO_TASK intent — converts a Quick Note into a Master Task.
 * Searches for the note, creates a task in Master Tasks, marks note as Promoted.
 *
 * @param {Object} ctx — grammY context
 * @param {Object} intent — parsed intent with note_title
 */
async function handlePromoteToTask(ctx, intent) {
  const chatId = ctx.chat.id;

  try {
    let notePageId = null;
    let noteTitle = null;
    let noteContent = '';
    let noteStream = null;

    /* Check if user just said "promote" — use the last saved note */
    if (!intent.note_title || intent.note_title.toLowerCase() === 'promote') {
      const lastNote = getLastSavedNote(chatId);
      if (lastNote) {
        notePageId = lastNote.pageId;
        noteTitle = lastNote.title;
        /* Fetch the full note to get content and stream */
        const notes = await searchNotes(noteTitle);
        if (notes.length > 0) {
          noteContent = getNoteContent(notes[0]);
          noteStream = getNoteSelect(notes[0], 'Stream');
        }
      } else {
        await ctx.reply('No recent note to promote. Specify a note title: "promote [note name]"');
        return;
      }
    } else {
      /* Search for the note by title */
      const matches = await searchNotes(intent.note_title);
      if (matches.length === 0) {
        await ctx.reply(`No notes found matching "${intent.note_title}". Try different keywords.`);
        return;
      }
      const topMatch = matches[0];
      notePageId = topMatch.id;
      noteTitle = getNoteTitle(topMatch);
      noteContent = getNoteContent(topMatch);
      noteStream = getNoteSelect(topMatch, 'Stream');
    }

    /* Create a task in Master Tasks from the note */
    await createTask({
      title: noteTitle,
      status: 'Inbox',
      urgency: 'No Urgency',
      stream: noteStream || intent.stream || 'Personal',
      dueDate: null,
      energy: 'Low',
      notes: noteContent || null,
    });

    /* Mark the note as Promoted in Quick Notes */
    await markNotePromoted(notePageId);

    const stream = noteStream || intent.stream || 'Personal';
    await ctx.reply(`Promoted to task: ${noteTitle} [Inbox · ${stream}]`);

    logger.info('PROMOTE_TO_TASK completed', { notePageId, noteTitle });
  } catch (err) {
    logger.error('PROMOTE_TO_TASK failed', { error: err.message });
    await ctx.reply('Failed to promote note to task. Please try again.');
  }
}

/* ─── Draft callback handlers ─── */

/**
 * Handles draft:save callback — generates metadata via Claude, saves to Notion.
 * This is where the ONE Claude API call per note happens.
 *
 * @param {Object} ctx — grammY context (callback_query)
 * @param {Object} bot — the grammY bot instance
 */
async function handleDraftSave(ctx, bot) {
  const chatId = ctx.chat.id;
  const draft = getDraft(chatId);

  if (!draft) {
    await ctx.answerCallbackQuery({ text: 'No draft to save' });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Saving...' });

  try {
    const content = draft.messages.join('\n');
    const source = draft.source || 'Text';

    /* ONE Claude call: generate title, type, stream from the full content */
    const metadata = await generateNoteMetadata(content);

    /* Save to Notion Quick Notes DB */
    const page = await createNote({
      title: metadata.title,
      content,
      type: metadata.type,
      stream: metadata.stream,
      remindAt: null,
      source,
    });

    /* Clean up the draft buffer and timers */
    deleteDraft(chatId);

    /* Track this note for potential "promote" command */
    setLastSavedNote(chatId, page.id, metadata.title);

    /* Build confirmation message */
    const parts = [`Saved: "${metadata.title}"`];
    parts.push(`Type: ${metadata.type}`);
    if (metadata.stream) parts.push(`Stream: ${metadata.stream}`);
    parts.push('\nReply "promote" to convert to task.');

    await ctx.editMessageText(parts.join('\n'));

    logger.info('Draft saved to Notion', { chatId, pageId: page.id, title: metadata.title });
  } catch (err) {
    logger.error('Draft save failed', { chatId, error: err.message });

    /* Queue to pending_sync for retry — don't lose the note */
    const content = draft.messages.join('\n');
    queuePendingSync('create_note', {
      content,
      source: draft.source,
    });

    /* Keep the draft in SQLite in case pending_sync also fails */
    await ctx.editMessageText(
      'Notion is unreachable. Note queued locally and will sync when restored.\n' +
      'Draft preserved — you can try saving again later.'
    );
  }
}

/**
 * Handles draft:discard callback — clears the draft buffer.
 *
 * @param {Object} ctx — grammY context (callback_query)
 */
async function handleDraftDiscard(ctx) {
  const chatId = ctx.chat.id;

  const draft = getDraft(chatId);
  if (!draft) {
    await ctx.answerCallbackQuery({ text: 'No draft to discard' });
    return;
  }

  deleteDraft(chatId);

  await ctx.answerCallbackQuery({ text: 'Discarded' });
  await ctx.editMessageText('Draft discarded.');

  logger.info('Draft discarded', { chatId });
}

/**
 * Handles auto-save when intent shift is detected.
 * Saves the current draft silently and returns the saved note info.
 *
 * @param {number} chatId
 * @returns {Promise<{ title: string, pageId: string }|null>} — saved note info, or null on failure
 */
async function autoSaveDraft(chatId) {
  const draft = getDraft(chatId);
  if (!draft) return null;

  try {
    const content = draft.messages.join('\n');
    const source = draft.source || 'Text';

    /* Generate metadata */
    const metadata = await generateNoteMetadata(content);

    /* Save to Notion */
    const page = await createNote({
      title: metadata.title,
      content,
      type: metadata.type,
      stream: metadata.stream,
      remindAt: null,
      source,
    });

    /* Clean up */
    deleteDraft(chatId);
    setLastSavedNote(chatId, page.id, metadata.title);

    logger.info('Draft auto-saved (intent shift)', { chatId, pageId: page.id });
    return { title: metadata.title, pageId: page.id };
  } catch (err) {
    logger.error('Auto-save failed', { chatId, error: err.message });

    /* Queue to pending_sync and clean up draft */
    const content = draft.messages.join('\n');
    queuePendingSync('create_note', { content, source: draft.source });
    deleteDraft(chatId);

    return null;
  }
}

/* ─── Helper functions ─── */

/**
 * Queues a failed Notion operation to SQLite pending_sync table.
 * The background worker will retry every 5 minutes.
 */
function queuePendingSync(action, payload) {
  try {
    const stmt = db.prepare(
      'INSERT INTO pending_sync (action, payload) VALUES (?, ?)'
    );
    stmt.run(action, JSON.stringify(payload));
    logger.info('Queued to pending_sync', { action });
  } catch (err) {
    logger.error('Failed to queue pending_sync', { error: err.message });
  }
}

/**
 * Formats an ISO date string to a relative time string (e.g., "2 days ago").
 */
function formatRelativeTime(isoDate) {
  if (!isoDate) return '';

  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffWeeks < 5) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
}

module.exports = {
  handleAddNote,
  handleSetReminder,
  handleListNotes,
  handlePromoteToTask,
  handleDraftSave,
  handleDraftDiscard,
  autoSaveDraft,
};
