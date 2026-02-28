/**
 * Bot 3 — Request Agent configuration.
 * Separate from shared/config.js because this runs as its own PM2 process
 * and doesn't need Bot 1/2 env vars (Gemini, Google OAuth, etc.).
 */

require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  return process.env[name] || fallback;
}

module.exports = {
  REQUEST_AGENT_BOT_TOKEN: required('REQUEST_AGENT_BOT_TOKEN'),
  ALLOWED_TELEGRAM_USER_ID: Number(required('ALLOWED_TELEGRAM_USER_ID')),
  NOTION_TOKEN: required('NOTION_TOKEN'),
  GITHUB_TOKEN: required('GITHUB_TOKEN'),
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: Number(optional('PORT', '3004')),
  TZ: optional('TZ', 'Asia/Kuala_Lumpur'),
};
