/**
 * Notion API helpers.
 * Wraps @notionhq/client with retry logic and rate limit handling.
 * All Notion reads/writes should go through this module.
 */

const { Client } = require('@notionhq/client');
const config = require('../shared/config');
const logger = require('./logger');

/* Initialise the Notion client with the integration token */
const notion = new Client({
  auth: config.NOTION_TOKEN,
  /* @notionhq/client automatically sets Notion-Version header */
});

/**
 * Retries a Notion API call with exponential backoff.
 * Handles 429 (rate limit) and 5xx (server error) responses.
 *
 * @param {Function} fn — async function that makes the Notion API call
 * @param {number} maxRetries — maximum number of retries (default 3)
 * @returns {Promise<any>} — the API response
 */
async function withRetry(fn, maxRetries = 3) {
  const delays = [1000, 3000, 9000]; /* 1s, 3s, 9s — exponential backoff */

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.code;
      const isRetryable = status === 429 || (status >= 500 && status < 600);

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      const delay = delays[attempt] || 9000;
      logger.warn('Notion API retry', { attempt: attempt + 1, status, delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

module.exports = { notion, withRetry };
