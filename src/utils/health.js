/**
 * Health check module.
 * Checks reachability of all external services and local database.
 * Used by both the HTTP /health endpoint and the Telegram /health command.
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
    const row = db.prepare('SELECT 1 AS ok').get();
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

  /* Anthropic — verify API key by checking models endpoint */
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (response.ok) {
      results.checks.anthropic = { status: 'ok' };
    } else {
      const body = await response.text();
      results.checks.anthropic = { status: 'error', message: `HTTP ${response.status}` };
      results.status = 'degraded';
    }
  } catch (err) {
    results.checks.anthropic = { status: 'error', message: err.message };
    results.status = 'degraded';
  }

  /* Pending sync queue — count items waiting */
  try {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM pending_sync WHERE retry_count < 5').get();
    results.checks.pendingSync = { status: 'ok', queuedItems: count };
  } catch (err) {
    results.checks.pendingSync = { status: 'error', message: err.message };
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
    const checkIcon = check.status === 'ok' ? '✅' : '❌';
    msg += `${checkIcon} ${name}`;
    if (check.queuedItems !== undefined) {
      msg += ` (${check.queuedItems} queued)`;
    }
    if (check.status !== 'ok' && check.message) {
      msg += ` — ${check.message}`;
    }
    msg += '\n';
  }

  return msg;
}

module.exports = { runHealthChecks, formatHealthMessage };
