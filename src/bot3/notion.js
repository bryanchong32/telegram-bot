/**
 * Notion API integration for the Request Agent.
 * Creates database pages for request tracking.
 *
 * Reuses @notionhq/client already installed in the repo.
 * Same retry pattern as src/utils/notion.js.
 */

const { Client } = require('@notionhq/client');
const config = require('./config');
const logger = require('./logger');

const notion = new Client({ auth: config.NOTION_TOKEN });

/**
 * Retries a Notion API call with exponential backoff.
 * Handles 429 (rate limit) and 5xx (server error).
 */
async function withRetry(fn, maxRetries = 3) {
  const delays = [1000, 3000, 9000];

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
 * Creates a Notion database page for a filed request.
 *
 * @param {Object} params
 * @param {Object} params.meta — parsed frontmatter (request_id, title, type, etc.)
 * @param {Object} params.githubUrls — { prd, decisionNotes, ccInstructions } URLs
 * @param {string} params.notionDatabaseId — target Notion database ID
 * @returns {Promise<{pageId: string, pageUrl: string}>}
 */
async function createRequestEntry({ meta, githubUrls, notionDatabaseId }) {
  logger.info('Creating Notion entry', { requestId: meta.request_id });

  const page = await withRetry(() =>
    notion.pages.create({
      parent: { database_id: notionDatabaseId },
      properties: {
        'Request Title': {
          title: [{ text: { content: meta.title } }],
        },
        'Request ID': {
          rich_text: [{ text: { content: meta.request_id } }],
        },
        Type: {
          select: { name: meta.type },
        },
        Priority: {
          select: { name: meta.priority },
        },
        Effort: {
          select: { name: meta.effort },
        },
        Status: {
          select: { name: 'Scoped' },
        },
        Source: {
          select: { name: meta.source },
        },
        'Date Logged': {
          date: { start: meta.date },
        },
        'PRD Link': {
          url: githubUrls.prd,
        },
        'Decision Notes Link': {
          url: githubUrls.decisionNotes,
        },
        'CC Instructions Link': {
          url: githubUrls.ccInstructions,
        },
      },
    })
  );

  logger.info('Notion entry created', { pageId: page.id });

  return {
    pageId: page.id,
    pageUrl: page.url,
  };
}

module.exports = { createRequestEntry };
