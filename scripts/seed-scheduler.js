/**
 * Seed script — inserts the default scheduled jobs into SQLite.
 *
 * Creates:
 *   1. Daily briefing — 08:00 MYT every day
 *   2. Weekly review  — Sunday 20:00 MYT
 *
 * Idempotent: skips if jobs of the same type already exist.
 *
 * Usage: node scripts/seed-scheduler.js
 * Requires: ALLOWED_TELEGRAM_USER_ID in .env (used as chat_id)
 */

require('dotenv').config();

const path = require('path');
const Database = require('better-sqlite3');
const { CronExpressionParser } = require('cron-parser');

const DB_PATH = path.join(__dirname, '..', 'data', 'bot.db');
const TZ = 'Asia/Kuala_Lumpur';

/* Bryan's chat ID — scheduler needs to know where to send messages */
const chatId = Number(process.env.ALLOWED_TELEGRAM_USER_ID);
if (!chatId) {
  console.error('ERROR: ALLOWED_TELEGRAM_USER_ID not set in .env');
  process.exit(1);
}

/* Open the database */
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

/**
 * Calculates the next run time from a cron expression in MYT.
 */
function nextRun(cronExpr) {
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: new Date(),
    tz: TZ,
  });
  return interval.next().toISOString();
}

/**
 * Seeds a job if one of the same type doesn't already exist.
 */
function seedJob({ type, payload, cronExpr }) {
  const existing = db.prepare(
    'SELECT id FROM scheduled_jobs WHERE type = ? AND active = 1'
  ).get(type);

  if (existing) {
    console.log(`  SKIP: "${type}" job already exists (id=${existing.id})`);
    return;
  }

  const nextRunAt = nextRun(cronExpr);
  db.prepare(
    'INSERT INTO scheduled_jobs (type, payload, cron_expr, next_run_at, chat_id) VALUES (?, ?, ?, ?, ?)'
  ).run(type, JSON.stringify(payload), cronExpr, nextRunAt, chatId);

  console.log(`  CREATED: "${type}" — next run: ${nextRunAt}`);
}

/* ─── Seed the jobs ─── */

console.log('Seeding scheduled jobs...\n');

/* 1. Daily briefing — 08:00 MYT every day */
seedJob({
  type: 'briefing',
  payload: { description: 'Daily morning briefing' },
  cronExpr: '0 8 * * *',
});

/* 2. Weekly review — Sunday 20:00 MYT */
seedJob({
  type: 'review',
  payload: { description: 'Sunday weekly review' },
  cronExpr: '0 20 * * 0',
});

console.log('\nDone. Current scheduled_jobs:');
const all = db.prepare('SELECT id, type, cron_expr, next_run_at, active FROM scheduled_jobs').all();
console.table(all);

db.close();
