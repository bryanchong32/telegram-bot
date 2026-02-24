/**
 * Central configuration loader.
 * Reads all environment variables once at startup and exports them
 * as typed constants. Every module imports from here — never reads
 * process.env directly.
 */

require('dotenv').config();

/** Helper: throws immediately if a required env var is missing */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Helper: returns value or fallback for optional env vars */
function optional(name, fallback) {
  return process.env[name] || fallback;
}

module.exports = {
  // Telegram
  TELEGRAM_BOT1_TOKEN: required('TELEGRAM_BOT1_TOKEN'),
  TELEGRAM_BOT2_TOKEN: required('TELEGRAM_BOT2_TOKEN'),
  ALLOWED_TELEGRAM_USER_ID: Number(required('ALLOWED_TELEGRAM_USER_ID')),

  // Notion
  NOTION_TOKEN: required('NOTION_TOKEN'),
  NOTION_TASKS_DB_ID: optional('NOTION_TASKS_DB_ID', ''),
  NOTION_QUICKNOTES_DB_ID: optional('NOTION_QUICKNOTES_DB_ID', ''),

  // Anthropic
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),

  // Google (Phase 5/6 — optional for now)
  GOOGLE_CLIENT_ID: optional('GOOGLE_CLIENT_ID', ''),
  GOOGLE_CLIENT_SECRET: optional('GOOGLE_CLIENT_SECRET', ''),
  GOOGLE_REFRESH_TOKEN: optional('GOOGLE_REFRESH_TOKEN', ''),
  GDRIVE_TASK_REFS_FOLDER_ID: optional('GDRIVE_TASK_REFS_FOLDER_ID', ''),
  GDRIVE_RECEIPTS_FOLDER_ID: optional('GDRIVE_RECEIPTS_FOLDER_ID', ''),
  GSHEETS_EXPENSE_LOG_ID: optional('GSHEETS_EXPENSE_LOG_ID', ''),

  // App
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: Number(optional('PORT', '3003')),
  TZ: optional('TZ', 'Asia/Kuala_Lumpur'),
};
