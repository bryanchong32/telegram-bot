/**
 * Pending sync retry worker.
 * Retries failed Notion/Drive writes every 5 minutes.
 *
 * Phase 1: Placeholder — just starts the cron loop and logs.
 * Phase 2+: Will retry queued actions and notify Bryan on 5th failure.
 */

const cron = require('node-cron');
const { db } = require('./db');
const logger = require('../utils/logger');

let task = null;

/**
 * Starts the pending sync retry worker.
 * Runs every 5 minutes, retries failed writes from the pending_sync table.
 */
function startPendingSyncWorker() {
  logger.info('Pending sync worker starting (5min interval)');

  task = cron.schedule('*/5 * * * *', () => {
    try {
      const pending = db.prepare(
        'SELECT * FROM pending_sync WHERE retry_count < 5 ORDER BY created_at ASC'
      ).all();

      if (pending.length > 0) {
        logger.info('Pending sync: items to retry', { count: pending.length });
        /* Phase 2+: Attempt each action, increment retry_count on failure */
      }
    } catch (err) {
      logger.error('Pending sync worker error', { error: err.message });
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });
}

/** Stops the pending sync worker gracefully */
function stopPendingSyncWorker() {
  if (task) {
    task.stop();
    logger.info('Pending sync worker stopped');
  }
}

module.exports = { startPendingSyncWorker, stopPendingSyncWorker };
