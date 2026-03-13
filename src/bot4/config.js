/**
 * Bot 4 — Order Entry Bot configuration.
 * Separate from shared/config.js because this runs as its own Coolify container
 * and needs Google Sheets + Gemini env vars.
 */

require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name, fallback) {
  return process.env[name] || fallback;
}

module.exports = {
  TELEGRAM_BOT4_TOKEN: required('TELEGRAM_BOT4_TOKEN'),
  TELEGRAM_ORDER_GROUP_ID: Number(required('TELEGRAM_ORDER_GROUP_ID')),
  ADMIN_TELEGRAM_USER_ID: Number(required('ADMIN_TELEGRAM_USER_ID')),
  // Google Sheets (service account — same credentials as CRM)
  GOOGLE_SHEETS_CREDENTIALS: required('GOOGLE_SHEETS_CREDENTIALS'),
  GOOGLE_SHEETS_SPREADSHEET_ID: required('GOOGLE_SHEETS_SPREADSHEET_ID'),
  GEMINI_API_KEY: required('GEMINI_API_KEY'),
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: Number(optional('PORT', '3006')),
  DATA_DIR: optional('DATA_DIR', './data'),
  TZ: optional('TZ', 'Asia/Kuala_Lumpur'),
};
