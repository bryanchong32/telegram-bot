/**
 * Health check module.
 * Checks reachability of all external services and local database.
 * Used by both the HTTP /health endpoint and the Telegram /health command.
 *
 * Checks: SQLite, Notion API, Gemini API, Cloud Vision API, Google Drive,
 * Google Sheets, pending sync queue, scheduler status.
 */

const { Client } = require('@notionhq/client');
const config = require('../shared/config');
const { db } = require('../shared/db');
const logger = require('./logger');

/**
 * Runs all health checks and returns a status object.
 * Each check is independent — one failure doesn't block others.
 */
async function runHealthChecks() {
  const results = {
    status: 'ok',
    timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }),
    checks: {},
  };

  /* SQLite — verify database is readable */
  try {
    db.prepare('SELECT 1 AS ok').get();
    results.checks.sqlite = { status: 'ok' };
  } catch (err) {
    results.checks.sqlite = { status: 'error', message: err.message };
    results.status = 'degraded';
  }

  /* Notion API — verify token is valid by listing users (lightweight call) */
  try {
    const notion = new Client({ auth: config.NOTION_TOKEN });
    await notion.users.me({});
    results.checks.notion = { status: 'ok' };
  } catch (err) {
    results.checks.notion = { status: 'error', message: err.message };
    results.status = 'degraded';
  }

  /* Gemini — verify API key with a minimal request */
  try {
    const { chat } = require('./gemini');
    await chat({ systemInstruction: 'Reply with OK.', userMessage: 'ping', maxTokens: 4 });
    results.checks.gemini = { status: 'ok' };
  } catch (err) {
    results.checks.gemini = { status: 'error', message: err.message };
    results.status = 'degraded';
  }

  /* Cloud Vision — verify API key with a minimal request */
  if (config.GOOGLE_CLOUD_API_KEY) {
    try {
      const url = `https://vision.googleapis.com/v1/images:annotate?key=${config.GOOGLE_CLOUD_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [] }),
      });
      if (response.ok || response.status === 400) {
        /* 400 is expected for empty requests — means the key is valid */
        results.checks.cloudVision = { status: 'ok' };
      } else {
        results.checks.cloudVision = { status: 'error', message: `HTTP ${response.status}` };
        results.status = 'degraded';
      }
    } catch (err) {
      results.checks.cloudVision = { status: 'error', message: err.message };
      results.status = 'degraded';
    }
  } else {
    results.checks.cloudVision = { status: 'skipped', message: 'API key not configured' };
  }

  /* Google Drive — verify OAuth token by listing files in root (1 result max).
     Only checked if Google credentials are configured. */
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_REFRESH_TOKEN) {
    try {
      const { drive } = require('./google');
      await drive.files.list({ pageSize: 1, fields: 'files(id)' });
      results.checks.googleDrive = { status: 'ok' };
    } catch (err) {
      results.checks.googleDrive = { status: 'error', message: err.message };
      results.status = 'degraded';
    }
  } else {
    results.checks.googleDrive = { status: 'skipped', message: 'credentials not configured' };
  }

  /* Google Sheets — verify by reading 1 row from the Expense Log.
     Only checked if Sheets ID is configured. */
  if (config.GSHEETS_EXPENSE_LOG_ID && config.GOOGLE_CLIENT_ID) {
    try {
      const { sheets } = require('./google');
      await sheets.spreadsheets.values.get({
        spreadsheetId: config.GSHEETS_EXPENSE_LOG_ID,
        range: 'Expenses!A1:A1',
      });
      results.checks.googleSheets = { status: 'ok' };
    } catch (err) {
      results.checks.googleSheets = { status: 'error', message: err.message };
      results.status = 'degraded';
    }
  } else {
    results.checks.googleSheets = { status: 'skipped', message: 'credentials not configured' };
  }

  /* Pending sync queue — count items waiting for retry */
  try {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM pending_sync WHERE retry_count < 5').get();
    const { dead } = db.prepare('SELECT COUNT(*) as dead FROM pending_sync WHERE retry_count >= 5').get();
    results.checks.pendingSync = { status: count > 0 || dead > 0 ? 'warning' : 'ok', queued: count, failed: dead };
    if (dead > 0) results.status = 'degraded';
  } catch (err) {
    results.checks.pendingSync = { status: 'error', message: err.message };
  }

  /* Scheduler — count active jobs and next trigger time */
  try {
    const { active } = db.prepare('SELECT COUNT(*) as active FROM scheduled_jobs WHERE active = 1').get();
    const nextJob = db.prepare('SELECT next_run_at FROM scheduled_jobs WHERE active = 1 ORDER BY next_run_at ASC LIMIT 1').get();
    results.checks.scheduler = {
      status: 'ok',
      activeJobs: active,
      nextTrigger: nextJob?.next_run_at || 'none',
    };
  } catch (err) {
    results.checks.scheduler = { status: 'error', message: err.message };
  }

  return results;
}

/**
 * Formats health check results as a Telegram-friendly message.
 */
function formatHealthMessage(results) {
  const icon = results.status === 'ok' ? '✅' : '⚠️';
  let msg = `${icon} System Health — ${results.timestamp}\n\n`;

  for (const [name, check] of Object.entries(results.checks)) {
    const checkIcon = check.status === 'ok' ? '✅'
      : check.status === 'skipped' ? '⏭️'
      : check.status === 'warning' ? '⚠️'
      : '❌';

    msg += `${checkIcon} ${name}`;

    /* Show relevant metadata inline */
    if (check.queued !== undefined) msg += ` (${check.queued} queued, ${check.failed} failed)`;
    if (check.activeJobs !== undefined) msg += ` (${check.activeJobs} jobs)`;
    if (check.status === 'skipped') msg += ` — ${check.message}`;
    if (check.status === 'error' && check.message) msg += ` — ${check.message}`;

    msg += '\n';
  }

  return msg;
}

module.exports = { runHealthChecks, formatHealthMessage };
