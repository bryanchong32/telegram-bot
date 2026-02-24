/**
 * Date/time helpers.
 * All dates use Asia/Kuala_Lumpur timezone (UTC+8).
 */

const { CronExpressionParser } = require('cron-parser');

const TZ = 'Asia/Kuala_Lumpur';

/** Returns current time as an ISO string in MYT */
function nowMYT() {
  return new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T');
}

/** Returns today's date in YYYY-MM-DD format (MYT) */
function todayMYT() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** Formats a Date object to a readable MYT string, e.g. "24 Feb 2026, 08:00" */
function formatMYT(date) {
  return new Date(date).toLocaleString('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Calculates the next run time from a cron expression, in MYT timezone.
 * Returns an ISO string suitable for storing in scheduled_jobs.next_run_at.
 *
 * @param {string} cronExpr — standard 5-field cron expression (e.g. '0 8 * * *')
 * @param {Date} [fromDate] — calculate next occurrence after this date (default: now)
 * @returns {string} — ISO datetime string of the next occurrence
 */
function nextCronRun(cronExpr, fromDate) {
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: fromDate || new Date(),
    tz: TZ,
  });
  return interval.next().toISOString();
}

/**
 * Returns the start-of-day (00:00:00) in MYT as an ISO string.
 * Useful for querying "completed this week" etc.
 *
 * @param {number} daysAgo — number of days to subtract from today (default 0)
 * @returns {string} — ISO datetime string
 */
function startOfDayMYT(daysAgo = 0) {
  const now = new Date();
  /* Get the current MYT date string, then construct a Date from it */
  const mytDate = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  mytDate.setHours(0, 0, 0, 0);
  mytDate.setDate(mytDate.getDate() - daysAgo);
  /* Convert back: MYT is UTC+8, so subtract 8 hours to get UTC */
  return new Date(mytDate.getTime() - 8 * 60 * 60 * 1000).toISOString();
}

module.exports = { nowMYT, todayMYT, formatMYT, nextCronRun, startOfDayMYT, TZ };
