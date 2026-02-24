/**
 * SQLite database setup via better-sqlite3.
 * Creates 3 tables on first run: draft_buffer, scheduled_jobs, pending_sync.
 * Synchronous API — no async race conditions on draft buffer writes.
 */

const path = require('path');
const Database = require('better-sqlite3');
const logger = require('../utils/logger');

/* Resolve absolute path to data/bot.db from project root */
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'bot.db');

/** Open (or create) the SQLite database with WAL mode for better concurrency */
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialise all tables if they don't exist.
 * Called once at startup.
 */
function initTables() {
  logger.info('Initialising SQLite tables');

  /* draft_buffer — holds in-progress note drafts for crash safety */
  db.exec(`
    CREATE TABLE IF NOT EXISTS draft_buffer (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id       INTEGER NOT NULL,
      messages      TEXT    NOT NULL DEFAULT '[]',
      source        TEXT    NOT NULL DEFAULT 'Text',
      opened_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_updated  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* scheduled_jobs — unified scheduler for recurring tasks, reminders, briefings */
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      type            TEXT    NOT NULL,
      payload         TEXT    NOT NULL DEFAULT '{}',
      cron_expr       TEXT,
      next_run_at     DATETIME NOT NULL,
      chat_id         INTEGER NOT NULL,
      last_triggered  DATETIME,
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* pending_sync — fallback queue when Notion/Drive is unreachable */
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_sync (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      action        TEXT    NOT NULL,
      payload       TEXT    NOT NULL DEFAULT '{}',
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      last_retry_at DATETIME
    )
  `);

  logger.info('SQLite tables ready');
}

module.exports = { db, initTables };
