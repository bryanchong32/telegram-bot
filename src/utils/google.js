/**
 * Google API helpers.
 * Creates authenticated Google Drive and Sheets clients using OAuth2.
 * All Google API calls should go through this module for auth.
 *
 * Uses a refresh token obtained via Google OAuth Playground (single-user bot).
 * The googleapis SDK auto-refreshes the access token when it expires.
 */

const { google } = require('googleapis');
const config = require('../shared/config');
const logger = require('./logger');

/**
 * Creates an OAuth2 client configured with credentials from .env.
 * The refresh token is set so the SDK can auto-refresh access tokens.
 */
function createAuthClient() {
  const oauth2 = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET
  );

  oauth2.setCredentials({
    refresh_token: config.GOOGLE_REFRESH_TOKEN,
  });

  return oauth2;
}

/* Shared auth client — initialised once, reused across calls */
const auth = createAuthClient();

/* Authenticated Google Drive v3 client */
const drive = google.drive({ version: 'v3', auth });

/* Authenticated Google Sheets v4 client */
const sheets = google.sheets({ version: 'v4', auth });

/**
 * Retries a Google API call with exponential backoff.
 * Handles 429 (rate limit) and 5xx (server error) responses.
 *
 * @param {Function} fn — async function that makes the Google API call
 * @param {number} maxRetries — maximum number of retries (default 2)
 * @returns {Promise<any>} — the API response
 */
async function withGoogleRetry(fn, maxRetries = 2) {
  const delays = [1000, 3000]; /* 1s, 3s */

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status || err.code;
      const isRetryable = status === 429 || (status >= 500 && status < 600);

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      const delay = delays[attempt] || 3000;
      logger.warn('Google API retry', { attempt: attempt + 1, status, delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

module.exports = { auth, drive, sheets, withGoogleRetry };
