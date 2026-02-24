/**
 * Pending sync retry worker.
 * Retries failed Notion/Drive writes every 5 minutes.
 *
 * Supported actions:
 *   - create_task  → retries createTask() to Notion Master Tasks
 *   - create_note  → retries createNote() to Notion Quick Notes
 *   - upload_file  → logs a warning (file data lost — cannot re-download from Telegram)
 *
 * Each action is retried up to 5 times. After the 5th failure, the item is
 * marked as dead (retry_count >= 5) and Bryan is notified via Telegram.
 *
 * On success: deletes the row from pending_sync.
 * On failure: increments retry_count and updates last_retry_at.
 */

const cron = require('node-cron');
const { db } = require('./db');
const { createTask } = require('../bot1/todo/notion');
const { createNote } = require('../bot1/notes/notion');
const logger = require('../utils/logger');

let task = null;
let botRef = null;
let chatId = null;

/**
 * Starts the pending sync retry worker.
 * Runs every 5 minutes, retries failed writes from the pending_sync table.
 *
 * @param {Object} [bot] — grammY bot instance (for notifying Bryan on max retries)
 * @param {number} [notifyChatId] — Bryan's chat ID for failure notifications
 */
function startPendingSyncWorker(bot, notifyChatId) {
  botRef = bot || null;
  chatId = notifyChatId || null;
  logger.info('Pending sync worker starting (5min interval)');

  task = cron.schedule('*/5 * * * *', async () => {
    try {
      await processPendingItems();
    } catch (err) {
      logger.error('Pending sync worker error', { error: err.message });
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });
}

/**
 * Processes all pending sync items that haven't exceeded max retries.
 * Each item is attempted individually — one failure doesn't block others.
 */
async function processPendingItems() {
  const pending = db.prepare(
    'SELECT * FROM pending_sync WHERE retry_count < 5 ORDER BY created_at ASC'
  ).all();

  if (pending.length === 0) return;

  logger.info('Pending sync: retrying items', { count: pending.length });

  for (const item of pending) {
    try {
      const payload = JSON.parse(item.payload || '{}');
      let success = false;

      switch (item.action) {
        case 'create_task':
          success = await retryCreateTask(payload);
          break;

        case 'create_note':
          success = await retryCreateNote(payload);
          break;

        case 'upload_file':
          /* File uploads cannot be retried — the temp file is gone and we can't
             re-download from Telegram. Log a warning and mark as resolved. */
          logger.warn('Pending sync: upload_file cannot be retried (temp file lost)', {
            fileName: payload.fileName,
          });
          success = true;
          break;

        default:
          logger.warn('Pending sync: unknown action', { action: item.action, id: item.id });
          success = true;
          break;
      }

      if (success) {
        /* Delete from pending_sync on success */
        db.prepare('DELETE FROM pending_sync WHERE id = ?').run(item.id);
        logger.info('Pending sync: item resolved', { id: item.id, action: item.action });
      } else {
        /* Increment retry count */
        db.prepare(
          'UPDATE pending_sync SET retry_count = retry_count + 1, last_retry_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(item.id);
        logger.warn('Pending sync: retry failed', {
          id: item.id,
          action: item.action,
          retryCount: item.retry_count + 1,
        });

        /* Notify Bryan on 5th (final) failure */
        if (item.retry_count + 1 >= 5) {
          await notifyMaxRetries(item);
        }
      }
    } catch (err) {
      logger.error('Pending sync: item processing error', {
        id: item.id,
        action: item.action,
        error: err.message,
      });
      db.prepare(
        'UPDATE pending_sync SET retry_count = retry_count + 1, last_retry_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(item.id);
    }
  }
}

/**
 * Retries creating a task in Notion Master Tasks.
 * @returns {boolean} — true on success, false on failure
 */
async function retryCreateTask(payload) {
  try {
    await createTask({
      title: payload.task || payload.title || 'Recovered task',
      status: payload.status || 'Inbox',
      urgency: payload.urgency || 'No Urgency',
      stream: payload.stream || 'Personal',
      dueDate: payload.due_date || payload.dueDate || null,
      energy: payload.energy || 'Low',
      notes: payload.notes || null,
    });
    return true;
  } catch (err) {
    logger.warn('Pending sync: create_task retry failed', { error: err.message });
    return false;
  }
}

/**
 * Retries creating a note in Notion Quick Notes.
 * @returns {boolean} — true on success, false on failure
 */
async function retryCreateNote(payload) {
  try {
    await createNote({
      title: payload.title || (payload.content ? payload.content.slice(0, 50) : 'Recovered note'),
      content: payload.content || payload.message || '',
      type: payload.type || 'Idea',
      stream: payload.stream || null,
      remindAt: payload.remind_at || payload.remindAt || null,
      source: payload.source || 'Text',
    });
    return true;
  } catch (err) {
    logger.warn('Pending sync: create_note retry failed', { error: err.message });
    return false;
  }
}

/**
 * Notifies Bryan via Telegram when a pending sync item hits max retries.
 * Best-effort — doesn't throw if notification fails.
 */
async function notifyMaxRetries(item) {
  if (!botRef || !chatId) return;

  try {
    const payload = JSON.parse(item.payload || '{}');
    const description = item.action === 'create_task'
      ? `Task: "${payload.task || payload.title || 'unknown'}"`
      : item.action === 'create_note'
        ? `Note: "${payload.title || payload.content?.slice(0, 40) || 'unknown'}"`
        : `File: ${payload.fileName || 'unknown'}`;

    await botRef.api.sendMessage(chatId,
      `Failed to sync after 5 retries:\n${description}\n\nAction: ${item.action}\nQueued: ${item.created_at}\n\nCheck /health for service status.`
    );
  } catch (err) {
    logger.error('Pending sync: failed to notify Bryan', { error: err.message });
  }
}

/** Stops the pending sync worker gracefully */
function stopPendingSyncWorker() {
  if (task) {
    task.stop();
    logger.info('Pending sync worker stopped');
  }
}

module.exports = { startPendingSyncWorker, stopPendingSyncWorker };
