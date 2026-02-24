/**
 * Unified scheduler worker.
 * Checks scheduled_jobs table every 60 seconds for due jobs.
 *
 * Phase 1: Placeholder — just starts the cron loop and logs.
 * Phase 4: Will execute payloads (create Notion tasks, send reminders, compose briefings).
 */

const cron = require('node-cron');
const { db } = require('./db');
const logger = require('../utils/logger');

let task = null;

/**
 * Starts the scheduler worker.
 * Runs every 60 seconds, checks for jobs where next_run_at <= now.
 */
function startScheduler() {
  logger.info('Scheduler worker starting (60s interval)');

  task = cron.schedule('* * * * *', () => {
    try {
      const now = new Date().toISOString();
      const dueJobs = db.prepare(
        'SELECT * FROM scheduled_jobs WHERE next_run_at <= ? AND active = 1'
      ).all(now);

      if (dueJobs.length > 0) {
        logger.info('Scheduler: found due jobs', { count: dueJobs.length });
        /* Phase 4: Execute each job based on type */
      }
    } catch (err) {
      logger.error('Scheduler worker error', { error: err.message });
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });
}

/** Stops the scheduler worker gracefully */
function stopScheduler() {
  if (task) {
    task.stop();
    logger.info('Scheduler worker stopped');
  }
}

module.exports = { startScheduler, stopScheduler };
