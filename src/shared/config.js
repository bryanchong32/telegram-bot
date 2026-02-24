/**
 * Central configuration loader.
 * Reads all environment variables once at startup and exports them
 * as typed constants. Every module imports from here — never reads
 * process.env directly.
 *
 * In production: Google credentials are required (file handling + receipts).
 * In development: Google credentials are optional (bot still works for todos/notes).
 */

require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

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

/** Helper: required in production, optional in development */
function requiredInProd(name) {
  if (isProduction) return required(name);
  return optional(name, '');
}

module.exports = {
  /* Telegram — always required */
  TELEGRAM_BOT1_TOKEN: required('TELEGRAM_BOT1_TOKEN'),
  TELEGRAM_BOT2_TOKEN: required('TELEGRAM_BOT2_TOKEN'),
  ALLOWED_TELEGRAM_USER_ID: Number(required('ALLOWED_TELEGRAM_USER_ID')),

  /* Notion — always required */
  NOTION_TOKEN: required('NOTION_TOKEN'),
  NOTION_TASKS_DB_ID: required('NOTION_TASKS_DB_ID'),
  NOTION_QUICKNOTES_DB_ID: required('NOTION_QUICKNOTES_DB_ID'),

  /* Anthropic — always required */
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),

  /* Google — required in production (file handling + receipts need them).
     Optional in development so bot can still run for todo/notes testing. */
  GOOGLE_CLIENT_ID: requiredInProd('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: requiredInProd('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REFRESH_TOKEN: requiredInProd('GOOGLE_REFRESH_TOKEN'),
  GDRIVE_TASK_REFS_FOLDER_ID: requiredInProd('GDRIVE_TASK_REFS_FOLDER_ID'),
  GDRIVE_RECEIPTS_FOLDER_ID: requiredInProd('GDRIVE_RECEIPTS_FOLDER_ID'),
  GSHEETS_EXPENSE_LOG_ID: requiredInProd('GSHEETS_EXPENSE_LOG_ID'),

  /* App */
  NODE_ENV,
  PORT: Number(optional('PORT', '3003')),
  TZ: optional('TZ', 'Asia/Kuala_Lumpur'),
};
