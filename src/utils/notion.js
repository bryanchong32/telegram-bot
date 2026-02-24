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

/**
 * Queries a Notion database using the REST API directly.
 *
 * @notionhq/client v5.x removed databases.query() — the new dataSources.query()
 * uses a different API path that doesn't accept database IDs. This helper calls
 * the original POST /databases/{id}/query endpoint via raw fetch.
 *
 * @param {Object} params
 * @param {string} params.database_id — the Notion database ID
 * @param {Object} [params.filter] — Notion filter object
 * @param {Object[]} [params.sorts] — Notion sorts array
 * @param {number} [params.page_size] — max results per page (default 100)
 * @param {string} [params.start_cursor] — pagination cursor
 * @returns {Promise<Object>} — Notion query response { results, has_more, next_cursor }
 */
async function queryDatabase(params) {
  const { database_id, filter, sorts, page_size, start_cursor } = params;
  const url = `https://api.notion.com/v1/databases/${database_id}/query`;

  const body = {};
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  if (page_size) body.page_size = page_size;
  if (start_cursor) body.start_cursor = start_cursor;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const err = new Error(`Notion API error ${response.status}: ${errorBody}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

module.exports = { notion, withRetry, queryDatabase };
