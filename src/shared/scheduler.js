/**
 * Unified scheduler worker.
 * Checks scheduled_jobs table every 60 seconds for due jobs.
 *
 * Job types:
 *   - 'briefing'  → compose and send the daily morning briefing (08:00 MYT)
 *   - 'review'    → compose and send the weekly Sunday review (20:00 MYT)
 *   - 'reminder'  → fire a one-shot reminder with Done/Snooze buttons
 *   - 'recurring' → create a Notion task with pre-filled fields
 *
 * On startup: checkMissedTriggers() re-runs any jobs that should have fired
 * in the last 24 hours but were missed (e.g. VPS restart).
 */

const cron = require('node-cron');
const { InlineKeyboard } = require('grammy');
const { db } = require('./db');
const { composeDailyBriefing } = require('../bot1/briefing/daily');
const { composeWeeklyReview } = require('../bot1/briefing/weekly');
const { createTask } = require('../bot1/todo/notion');
const { nextCronRun, nowMYT } = require('../utils/dates');
const logger = require('../utils/logger');

let cronTask = null;
let botRef = null;

/**
 * Starts the scheduler worker.
 * Must be called with a bot reference so we can send Telegram messages.
 *
 * @param {Object} bot — grammY bot instance (Bot 1)
 */
function startScheduler(bot) {
  botRef = bot;
  logger.info('Scheduler worker starting (60s interval)');

  cronTask = cron.schedule('* * * * *', async () => {
    try {
      await processDueJobs();
    } catch (err) {
      logger.error('Scheduler worker error', { error: err.message });
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });
}

/**
 * Finds and executes all due jobs from the scheduled_jobs table.
 * Each job is processed sequentially to avoid race conditions.
 */
async function processDueJobs() {
  const now = new Date().toISOString();
  const dueJobs = db.prepare(
    'SELECT * FROM scheduled_jobs WHERE next_run_at <= ? AND active = 1'
  ).all(now);

  if (dueJobs.length === 0) return;

  logger.info('Scheduler: processing due jobs', { count: dueJobs.length });

  for (const job of dueJobs) {
    try {
      await executeJob(job);
    } catch (err) {
      logger.error('Scheduler: job execution failed', {
        jobId: job.id,
        type: job.type,
        error: err.message,
      });
    }
  }
}

/**
 * Executes a single scheduled job based on its type.
 * After execution: recurring jobs get rescheduled, one-shot jobs get deactivated.
 *
 * @param {Object} job — row from scheduled_jobs table
 */
async function executeJob(job) {
  const payload = JSON.parse(job.payload || '{}');
  let executionFailed = false;

  try {
    switch (job.type) {
      case 'briefing':
        await executeBriefing(job);
        break;

      case 'review':
        await executeReview(job);
        break;

      case 'reminder':
        await executeReminder(job, payload);
        break;

      case 'recurring':
        await executeRecurring(job, payload);
        break;

      default:
        logger.warn('Scheduler: unknown job type', { type: job.type, jobId: job.id });
        return;
    }
  } catch (err) {
    /* Log the error but ALWAYS reschedule below to prevent retry loops.
       Without this, a failed recurring job's next_run_at stays in the past
       and it fires every 60 seconds until the external service recovers. */
    executionFailed = true;
    logger.error('Scheduler: job execution error', {
      jobId: job.id,
      type: job.type,
      error: err.message,
    });
  }

  /* ALWAYS update last_triggered and reschedule/deactivate — even on failure.
     This prevents a failed job from firing every 60s in a retry loop. */
  const nowISO = new Date().toISOString();

  if (job.cron_expr) {
    /* Recurring job — calculate next run time from the cron expression */
    const nextRun = nextCronRun(job.cron_expr);
    db.prepare(
      'UPDATE scheduled_jobs SET last_triggered = ?, next_run_at = ? WHERE id = ?'
    ).run(nowISO, nextRun, job.id);
    const status = executionFailed ? 'rescheduled (after failure)' : 'rescheduled';
    logger.info(`Scheduler: job ${status}`, { jobId: job.id, type: job.type, nextRun });
  } else {
    /* One-shot job (reminder) — deactivate after firing (even if delivery failed,
       we don't want reminders firing repeatedly on transient errors) */
    db.prepare(
      'UPDATE scheduled_jobs SET last_triggered = ?, active = 0 WHERE id = ?'
    ).run(nowISO, job.id);
    logger.info('Scheduler: one-shot job deactivated', { jobId: job.id, type: job.type });
  }
}

/* ─── Job type executors ─── */

/**
 * Sends the daily morning briefing to Bryan.
 */
async function executeBriefing(job) {
  if (!botRef) {
    logger.error('Scheduler: no bot reference — cannot send briefing');
    return;
  }

  const message = await composeDailyBriefing();
  await botRef.api.sendMessage(job.chat_id, message);
  logger.info('Daily briefing sent', { chatId: job.chat_id });
}

/**
 * Sends the weekly Sunday review to Bryan.
 */
async function executeReview(job) {
  if (!botRef) {
    logger.error('Scheduler: no bot reference — cannot send review');
    return;
  }

  const message = await composeWeeklyReview();
  await botRef.api.sendMessage(job.chat_id, message);
  logger.info('Weekly review sent', { chatId: job.chat_id });
}

/**
 * Fires a one-shot reminder with Done/Snooze inline buttons.
 * The Done button marks the reminder as complete.
 * The Snooze button reschedules it for 1 hour later.
 */
async function executeReminder(job, payload) {
  if (!botRef) {
    logger.error('Scheduler: no bot reference — cannot send reminder');
    return;
  }

  const message = payload.message || 'Reminder';

  /* Build inline keyboard with Done and Snooze buttons */
  const keyboard = new InlineKeyboard()
    .text('✅ Done', `reminder:done:${job.id}`)
    .text('⏩ Snooze 1hr', `reminder:snooze:${job.id}`);

  await botRef.api.sendMessage(
    job.chat_id,
    `⏰ Reminder: ${message}`,
    { reply_markup: keyboard }
  );

  logger.info('Reminder fired', { jobId: job.id, chatId: job.chat_id });
}

/**
 * Creates a recurring task in Notion Master Tasks with pre-filled fields.
 * Also notifies Bryan via Telegram that the task was created.
 */
async function executeRecurring(job, payload) {
  if (!botRef) {
    logger.error('Scheduler: no bot reference — cannot notify for recurring task');
    return;
  }

  /* Create the task in Notion */
  await createTask({
    title: payload.task_name || 'Recurring task',
    status: 'Todo',
    urgency: payload.urgency || 'No Urgency',
    stream: payload.stream || 'Personal',
    dueDate: null,
    energy: payload.energy || 'Low',
    notes: payload.notes || null,
  });

  /* Notify Bryan */
  await botRef.api.sendMessage(
    job.chat_id,
    `📋 Recurring task created: ${payload.task_name || 'Recurring task'}`
  );

  logger.info('Recurring task created', { jobId: job.id, taskName: payload.task_name });
}

/* ─── Missed trigger detection ─── */

/**
 * Checks for jobs that should have fired in the last 24 hours but were missed.
 * Called on startup to handle VPS restarts. Re-executes missed jobs.
 *
 * @param {Object} bot — grammY bot instance
 */
async function checkMissedTriggers(bot) {
  botRef = bot;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  /* Find active jobs whose next_run_at is in the past (should have fired)
     and either never triggered or last triggered before the missed window */
  const missedJobs = db.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE active = 1
      AND next_run_at <= ?
      AND next_run_at >= ?
  `).all(now, twentyFourHoursAgo);

  if (missedJobs.length === 0) {
    logger.info('Scheduler: no missed triggers found');
    return;
  }

  logger.info('Scheduler: found missed triggers', { count: missedJobs.length });

  for (const job of missedJobs) {
    try {
      logger.info('Scheduler: re-running missed job', { jobId: job.id, type: job.type });
      await executeJob(job);
    } catch (err) {
      logger.error('Scheduler: failed to re-run missed job', {
        jobId: job.id,
        error: err.message,
      });
    }
  }
}

/* ─── Job management helpers ─── */

/**
 * Handles the "reminder:done" callback — deactivates the reminder.
 *
 * @param {number} jobId — the scheduled_jobs row ID
 */
function markReminderDone(jobId) {
  db.prepare('UPDATE scheduled_jobs SET active = 0 WHERE id = ?').run(jobId);
  logger.info('Reminder marked done', { jobId });
}

/**
 * Handles the "reminder:snooze" callback — reschedules 1 hour from now.
 *
 * @param {number} jobId — the scheduled_jobs row ID
 */
function snoozeReminder(jobId) {
  const oneHourLater = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare(
    'UPDATE scheduled_jobs SET next_run_at = ?, active = 1 WHERE id = ?'
  ).run(oneHourLater, jobId);
  logger.info('Reminder snoozed', { jobId, nextRun: oneHourLater });
}

/** Stops the scheduler worker gracefully */
function stopScheduler() {
  if (cronTask) {
    cronTask.stop();
    logger.info('Scheduler worker stopped');
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  checkMissedTriggers,
  markReminderDone,
  snoozeReminder,
};
