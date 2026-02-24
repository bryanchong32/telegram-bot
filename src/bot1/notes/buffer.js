/**
 * Draft Buffer — state machine for Quick Notes.
 *
 * Core design principle: ZERO API calls during buffering.
 * All messages are accumulated in SQLite. Claude is only called once at save time
 * to generate title, type, and stream from the full concatenated content.
 *
 * State machine:
 *   IDLE → (first message) → BUFFERING
 *   BUFFERING:
 *     - New message within 5s → append, reset timer, stay BUFFERING
 *     - 5s silence → send preview with Save/Discard buttons → PREVIEWING
 *   PREVIEWING:
 *     - New message → intent shift check (Haiku)
 *       - continues_draft → append, back to BUFFERING
 *       - new intent → auto-save → release to intent engine
 *     - Save tapped → generate title/type/stream (Sonnet) → Notion → IDLE
 *     - Discard tapped → clear buffer → IDLE
 *     - 1hr timeout → ping with Save/Discard → stays PREVIEWING
 *
 * SQLite persistence: Every message is written to draft_buffer immediately
 * so drafts survive a VPS restart. In-memory timers are rebuilt on recovery.
 */

const { InlineKeyboard } = require('grammy');
const { db } = require('../../shared/db');
const { chat } = require('../../utils/anthropic');
const { todayMYT } = require('../../utils/dates');
const { inferStream } = require('../streamRouter');
const logger = require('../../utils/logger');

/* ─── In-memory state ─── */

/* Track 5s silence timers per chat_id — cleared on new message or resolution */
const silenceTimers = new Map();

/* Track 1hr timeout timers per chat_id — cleared on any resolution */
const timeoutTimers = new Map();

/* Track whether the draft preview has been shown (PREVIEWING state).
   If true, next message triggers intent shift detection instead of simple append. */
const previewShown = new Map();

/* Track the last saved note per chat_id for "promote" context */
const lastSavedNote = new Map();

/* ─── SQLite operations ─── */

/**
 * Gets the open draft for a chat, if any.
 * At most one draft per chat_id at any time.
 *
 * @param {number} chatId
 * @returns {Object|null} — { id, chat_id, messages, source, opened_at, last_updated } or null
 */
function getDraft(chatId) {
  const row = db.prepare('SELECT * FROM draft_buffer WHERE chat_id = ?').get(chatId);
  if (!row) return null;

  return {
    ...row,
    messages: JSON.parse(row.messages),
  };
}

/**
 * Opens a new draft buffer for a chat. Deletes any existing draft first.
 *
 * @param {number} chatId
 * @param {string} message — the first message text
 * @param {string} source — 'Text' or 'Voice'
 */
function openDraft(chatId, message, source = 'Text') {
  /* Ensure only one draft per chat — clean up any stale one */
  db.prepare('DELETE FROM draft_buffer WHERE chat_id = ?').run(chatId);

  const messages = JSON.stringify([message]);
  db.prepare(
    'INSERT INTO draft_buffer (chat_id, messages, source) VALUES (?, ?, ?)'
  ).run(chatId, messages, source);

  /* Reset in-memory state for this chat */
  previewShown.set(chatId, false);

  logger.info('Draft buffer opened', { chatId });
}

/**
 * Appends a message to an existing draft buffer.
 *
 * @param {number} chatId
 * @param {string} message — the message text to append
 */
function appendToDraft(chatId, message) {
  const draft = getDraft(chatId);
  if (!draft) return;

  draft.messages.push(message);
  const messagesJson = JSON.stringify(draft.messages);

  db.prepare(
    'UPDATE draft_buffer SET messages = ?, last_updated = CURRENT_TIMESTAMP WHERE chat_id = ?'
  ).run(messagesJson, chatId);

  logger.info('Message appended to draft', { chatId, messageCount: draft.messages.length });
}

/**
 * Deletes the draft buffer for a chat (on save or discard).
 *
 * @param {number} chatId
 */
function deleteDraft(chatId) {
  db.prepare('DELETE FROM draft_buffer WHERE chat_id = ?').run(chatId);
  clearAllTimers(chatId);
  previewShown.delete(chatId);
  logger.info('Draft buffer deleted', { chatId });
}

/**
 * Gets the full concatenated content of a draft.
 * Joins all buffered messages with newlines.
 *
 * @param {number} chatId
 * @returns {string} — concatenated content, or empty string if no draft
 */
function getDraftContent(chatId) {
  const draft = getDraft(chatId);
  if (!draft) return '';
  return draft.messages.join('\n');
}

/* ─── Timer management ─── */

/**
 * Starts the 5-second silence timer. When it fires, sends the draft preview
 * with Save/Discard inline buttons. No API call — purely static.
 *
 * @param {number} chatId
 * @param {Object} bot — the grammY bot instance (to send messages)
 */
function startSilenceTimer(chatId, bot) {
  clearSilenceTimer(chatId);

  const timer = setTimeout(async () => {
    try {
      const content = getDraftContent(chatId);
      if (!content) return;

      /* Truncate preview if very long */
      const preview = content.length > 300
        ? content.slice(0, 300) + '...'
        : content;

      const keyboard = new InlineKeyboard()
        .text('Save', 'draft:save')
        .text('Discard', 'draft:discard');

      await bot.api.sendMessage(chatId, `Draft so far:\n"${preview}"\n\nAnything to add? Or tap below:`, {
        reply_markup: keyboard,
      });

      /* Mark that the preview has been shown — next message triggers intent shift check */
      previewShown.set(chatId, true);

      /* Start the 1-hour timeout timer */
      startTimeoutTimer(chatId, bot);

    } catch (err) {
      logger.error('Silence timer send failed', { chatId, error: err.message });
    }
  }, 5000);

  silenceTimers.set(chatId, timer);
}

/**
 * Clears the 5-second silence timer for a chat.
 */
function clearSilenceTimer(chatId) {
  const timer = silenceTimers.get(chatId);
  if (timer) {
    clearTimeout(timer);
    silenceTimers.delete(chatId);
  }
}

/**
 * Starts the 1-hour timeout timer. When it fires, sends a reminder ping
 * with Save/Discard buttons. Fires once — draft stays open until resolved.
 *
 * @param {number} chatId
 * @param {Object} bot — the grammY bot instance
 */
function startTimeoutTimer(chatId, bot) {
  clearTimeoutTimer(chatId);

  const ONE_HOUR = 60 * 60 * 1000;

  const timer = setTimeout(async () => {
    try {
      const content = getDraftContent(chatId);
      if (!content) return;

      const preview = content.length > 200
        ? content.slice(0, 200) + '...'
        : content;

      const keyboard = new InlineKeyboard()
        .text('Save', 'draft:save')
        .text('Discard', 'draft:discard');

      await bot.api.sendMessage(chatId,
        `You have an unsaved note draft:\n\n"${preview}"\n\nTap to resolve:`,
        { reply_markup: keyboard }
      );

    } catch (err) {
      logger.error('Timeout timer send failed', { chatId, error: err.message });
    }
  }, ONE_HOUR);

  timeoutTimers.set(chatId, timer);
}

/**
 * Clears the 1-hour timeout timer for a chat.
 */
function clearTimeoutTimer(chatId) {
  const timer = timeoutTimers.get(chatId);
  if (timer) {
    clearTimeout(timer);
    timeoutTimers.delete(chatId);
  }
}

/**
 * Clears all timers for a chat (on save, discard, or shutdown).
 */
function clearAllTimers(chatId) {
  clearSilenceTimer(chatId);
  clearTimeoutTimer(chatId);
}

/* ─── Intent shift detection ─── */

/**
 * Checks if a new message continues an open draft or is a different intent.
 * Uses Claude Haiku for classification — only called after the 5s preview
 * has been shown (PREVIEWING state), not during rapid-fire typing.
 *
 * @param {string} draftContent — the existing draft content
 * @param {string} newMessage — the new message to check
 * @returns {Promise<{ continues_draft: boolean, reason: string }>}
 */
async function checkIntentShift(draftContent, newMessage) {
  try {
    const response = await chat({
      system:
        `You have an open note draft: "${draftContent}"\n` +
        `New message received: "${newMessage}"\n\n` +
        'Does the new message continue the same note, or is it a completely different topic/intent?\n' +
        'Respond with JSON only:\n' +
        '{\n' +
        '  "continues_draft": true/false,\n' +
        '  "reason": "brief explanation"\n' +
        '}',
      userMessage: newMessage,
      model: 'haiku',
      maxTokens: 128,
    });

    /* Parse the response */
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned);
    logger.info('Intent shift check', { continues: parsed.continues_draft });
    return {
      continues_draft: parsed.continues_draft === true,
      reason: parsed.reason || '',
    };
  } catch (err) {
    /* Safe fallback: assume it continues the draft — never lose content */
    logger.error('Intent shift check failed, defaulting to continues_draft', {
      error: err.message,
    });
    return { continues_draft: true, reason: 'classification failed — safe fallback' };
  }
}

/* ─── Title/type/stream generation ─── */

/**
 * Calls Claude Sonnet to generate a title, type, and stream from the full
 * note content. This is the ONE API call per note save.
 *
 * @param {string} content — the full concatenated note content
 * @returns {Promise<{ title: string, type: string, stream: string|null }>}
 */
async function generateNoteMetadata(content) {
  try {
    const today = todayMYT();

    const response = await chat({
      system:
        `You are analysing a note written by Bryan, a business owner managing multiple ventures. Today is ${today}.\n\n` +
        'Given the note content, generate:\n' +
        '1. title: A concise, descriptive title (max 80 chars). Never use the raw first line — summarise the essence.\n' +
        '2. type: One of "Idea", "Meeting", or "Voice" based on the content.\n' +
        '   - Idea: thoughts, concepts, brainstorming, plans, strategies\n' +
        '   - Meeting: meeting notes, discussion summaries, client conversations\n' +
        '   - Voice: (only if explicitly from voice transcription)\n' +
        '3. stream: One of "Minionions", "KLN", "Overdrive", "Personal", "Property" — or null if ambiguous.\n' +
        '   Keywords: Minionions (SVO, supplement, Wellous, ECOMWAVE, ads, inventory), KLN (consultant, client, report, north),\n' +
        '   Overdrive (event, pickleball, freelance), Property (Solasta, renovation, contractor, rental, lease, tenant, VP).\n' +
        '   If no clear keyword match, return null. Do NOT guess.\n\n' +
        'Respond with JSON only — no wrapping, no explanation:\n' +
        '{ "title": "...", "type": "...", "stream": "..." or null }',
      userMessage: content,
      model: 'sonnet',
      maxTokens: 256,
    });

    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned);

    /* Validate type */
    const validTypes = ['Idea', 'Meeting', 'Voice'];
    if (!validTypes.includes(parsed.type)) {
      parsed.type = 'Idea';
    }

    /* Validate stream */
    const validStreams = ['Minionions', 'KLN', 'Overdrive', 'Personal', 'Property'];
    if (parsed.stream && !validStreams.includes(parsed.stream)) {
      parsed.stream = null;
    }

    return {
      title: parsed.title || content.slice(0, 50),
      type: parsed.type,
      stream: parsed.stream || null,
    };
  } catch (err) {
    /* Fallback: use first 50 chars of content as title — silent, no interruption */
    logger.error('Note metadata generation failed, using fallback', { error: err.message });

    /* Try keyword-based stream inference as fallback */
    const routed = inferStream(content);

    return {
      title: content.slice(0, 50).trim() + (content.length > 50 ? '...' : ''),
      type: 'Idea',
      stream: routed.confidence === 'high' ? routed.stream : null,
    };
  }
}

/* ─── Draft recovery on startup ─── */

/**
 * Checks for open drafts in SQLite and re-sends the buffer prompt.
 * Called once on bot startup for VPS restart safety.
 *
 * @param {Object} bot — the grammY bot instance
 */
async function restoreOpenDrafts(bot) {
  const drafts = db.prepare('SELECT * FROM draft_buffer').all();

  if (drafts.length === 0) return;

  logger.info('Restoring open drafts after restart', { count: drafts.length });

  for (const draft of drafts) {
    try {
      const messages = JSON.parse(draft.messages);
      const content = messages.join('\n');
      const preview = content.length > 300 ? content.slice(0, 300) + '...' : content;

      const keyboard = new InlineKeyboard()
        .text('Save', 'draft:save')
        .text('Discard', 'draft:discard');

      await bot.api.sendMessage(draft.chat_id,
        `Recovered unsaved draft:\n\n"${preview}"\n\nTap to resolve:`,
        { reply_markup: keyboard }
      );

      /* Mark as PREVIEWING so next message triggers intent shift check */
      previewShown.set(draft.chat_id, true);

      /* Start timeout timer for recovered drafts */
      startTimeoutTimer(draft.chat_id, bot);

    } catch (err) {
      logger.error('Failed to restore draft', { chatId: draft.chat_id, error: err.message });
    }
  }
}

/* ─── Exported state accessors ─── */

/**
 * Checks if a draft is in PREVIEWING state (preview has been shown).
 * When true, the next message should trigger intent shift detection.
 */
function isPreviewShown(chatId) {
  return previewShown.get(chatId) === true;
}

/**
 * Gets the last saved note info for a chat (for "promote" context).
 * @returns {{ pageId: string, title: string }|null}
 */
function getLastSavedNote(chatId) {
  return lastSavedNote.get(chatId) || null;
}

/**
 * Sets the last saved note info for a chat.
 */
function setLastSavedNote(chatId, pageId, title) {
  lastSavedNote.set(chatId, { pageId, title });
}

/**
 * Clears all in-memory state on shutdown.
 */
function clearAllState() {
  for (const chatId of silenceTimers.keys()) clearSilenceTimer(chatId);
  for (const chatId of timeoutTimers.keys()) clearTimeoutTimer(chatId);
  silenceTimers.clear();
  timeoutTimers.clear();
  previewShown.clear();
  lastSavedNote.clear();
}

module.exports = {
  /* SQLite operations */
  getDraft,
  openDraft,
  appendToDraft,
  deleteDraft,
  getDraftContent,

  /* Timer management */
  startSilenceTimer,
  clearSilenceTimer,
  clearAllTimers,

  /* Intent shift */
  checkIntentShift,
  isPreviewShown,

  /* Title/type/stream generation */
  generateNoteMetadata,

  /* Draft recovery */
  restoreOpenDrafts,

  /* Last saved note tracking */
  getLastSavedNote,
  setLastSavedNote,

  /* Cleanup */
  clearAllState,
};
