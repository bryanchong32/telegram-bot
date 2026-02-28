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
        Project: {
          select: { name: meta.project },
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

/**
 * Queries the Notion database to find the highest REQ-XXX number
 * for a specific project, then returns the next sequential ID.
 *
 * @param {string} notionDatabaseId — target Notion database ID
 * @param {string} project — project name to filter by
 * @returns {Promise<string>} — next request ID like "REQ-002"
 */
async function getNextRequestId(notionDatabaseId, project) {
  let highest = 0;
  let hasMore = true;
  let startCursor;

  /* @notionhq/client v5.x removed databases.query — use REST API directly */
  while (hasMore) {
    const body = {
      page_size: 100,
      filter: {
        property: 'Project',
        select: { equals: project },
      },
    };
    if (startCursor) body.start_cursor = startCursor;

    const response = await withRetry(async () => {
      const res = await fetch(`https://api.notion.com/v1/databases/${notionDatabaseId}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = new Error(`Notion query failed: ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    });

    for (const page of response.results) {
      const richText = page.properties['Request ID']?.rich_text;
      if (!richText || richText.length === 0) continue;

      const value = richText[0].plain_text;
      const match = value.match(/^REQ-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > highest) highest = num;
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  const next = highest + 1;
  return `REQ-${String(next).padStart(3, '0')}`;
}

/**
 * Creates a minimal Notion database page for an unscoped quick request.
 * Unlike createRequestEntry, this has no GitHub URLs and no Effort field.
 *
 * @param {Object} params
 * @param {string} params.title — request title
 * @param {string} params.requestId — e.g. "REQ-006"
 * @param {string} params.project — project name
 * @param {string} params.type — request type
 * @param {string} params.priority — priority level
 * @param {string} params.notionDatabaseId — target Notion database ID
 * @returns {Promise<{pageId: string, pageUrl: string}>}
 */
async function createQuickEntry({ title, requestId, project, type, priority, notionDatabaseId }) {
  logger.info('Creating quick Notion entry', { requestId });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });

  const page = await withRetry(() =>
    notion.pages.create({
      parent: { database_id: notionDatabaseId },
      properties: {
        'Request Title': {
          title: [{ text: { content: title } }],
        },
        'Request ID': {
          rich_text: [{ text: { content: requestId } }],
        },
        Type: {
          select: { name: type },
        },
        Priority: {
          select: { name: priority },
        },
        Status: {
          select: { name: 'Unscoped' },
        },
        Source: {
          select: { name: 'Quick Request' },
        },
        Project: {
          select: { name: project },
        },
        'Date Logged': {
          date: { start: today },
        },
      },
    })
  );

  logger.info('Quick Notion entry created', { pageId: page.id });

  return {
    pageId: page.id,
    pageUrl: page.url,
  };
}

module.exports = { createRequestEntry, getNextRequestId, createQuickEntry };
