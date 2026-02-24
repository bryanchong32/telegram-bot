/**
 * Notion Master Tasks DB — read/write operations.
 *
 * All Notion interactions for the Todo module go through this file.
 * Uses withRetry() for automatic exponential backoff on failures.
 *
 * IMPORTANT: Notion API replaces rich_text on PATCH — always GET first,
 * append new content, then PATCH. This applies to Notes and File Links fields.
 */

const { notion, withRetry, queryDatabase } = require('../../utils/notion');
const config = require('../../shared/config');
const { todayMYT } = require('../../utils/dates');
const logger = require('../../utils/logger');

const TASKS_DB_ID = config.NOTION_TASKS_DB_ID;

/**
 * Creates a new task in the Master Tasks database.
 *
 * @param {Object} task
 * @param {string} task.title — task name (Title property)
 * @param {string} task.status — Inbox/Todo/In Progress/Waiting/Done (default: Inbox)
 * @param {string} task.urgency — Urgent/Less Urg/No Urgency
 * @param {string} task.stream — Minionions/KLN/Overdrive/Personal/Property
 * @param {string|null} task.dueDate — YYYY-MM-DD or null
 * @param {string} task.energy — High/Low
 * @param {string|null} task.notes — additional context
 * @returns {Promise<Object>} — created Notion page object
 */
async function createTask(task) {
  /* Build the properties object for Notion */
  const properties = {
    Task: { title: [{ text: { content: task.title } }] },
    Status: { select: { name: task.status || 'Inbox' } },
    Urgency: { select: { name: task.urgency || 'No Urgency' } },
    Stream: { select: { name: task.stream || 'Personal' } },
    Energy: { select: { name: task.energy || 'Low' } },
  };

  /* Only set Due Date if provided */
  if (task.dueDate) {
    properties['Due Date'] = { date: { start: task.dueDate } };
  }

  /* Only set Notes if provided */
  if (task.notes) {
    properties.Notes = {
      rich_text: [{ text: { content: task.notes } }],
    };
  }

  const page = await withRetry(() =>
    notion.pages.create({
      parent: { database_id: TASKS_DB_ID },
      properties,
    })
  );

  logger.info('Task created in Notion', { pageId: page.id });
  return page;
}

/**
 * Queries tasks from the Master Tasks database with optional filters.
 *
 * @param {string} filter — 'today' | 'inbox' | 'waiting' | 'upcoming' | 'all'
 * @returns {Promise<Object[]>} — array of Notion page objects
 */
async function queryTasks(filter = 'today') {
  const today = todayMYT();

  /* Build the Notion filter based on the requested view */
  let notionFilter;

  switch (filter) {
    case 'today':
      /* Due today OR Status = In Progress (matches the spec's Today Tasks view) */
      notionFilter = {
        or: [
          { property: 'Due Date', date: { equals: today } },
          { property: 'Status', select: { equals: 'In Progress' } },
        ],
      };
      break;

    case 'inbox':
      notionFilter = {
        property: 'Status',
        select: { equals: 'Inbox' },
      };
      break;

    case 'waiting':
      notionFilter = {
        property: 'Status',
        select: { equals: 'Waiting' },
      };
      break;

    case 'upcoming':
      /* Due in next 7 days, Status != Done */
      notionFilter = {
        and: [
          { property: 'Due Date', date: { next_week: {} } },
          {
            property: 'Status',
            select: { does_not_equal: 'Done' },
          },
        ],
      };
      break;

    case 'all':
      /* All non-Done tasks */
      notionFilter = {
        property: 'Status',
        select: { does_not_equal: 'Done' },
      };
      break;

    default:
      notionFilter = undefined;
  }

  /* Build the sorts — urgency first, then due date */
  const sorts = [
    { property: 'Urgency', direction: 'ascending' },
    { property: 'Due Date', direction: 'ascending' },
  ];

  /* Use raw queryDatabase — @notionhq/client v5.x removed databases.query() */
  const response = await withRetry(() =>
    queryDatabase({
      database_id: TASKS_DB_ID,
      filter: notionFilter,
      sorts,
    })
  );

  logger.info('Tasks queried from Notion', { filter, count: response.results.length });
  return response.results;
}

/**
 * Searches for tasks matching a search term (for COMPLETE_TODO and UPDATE_TODO).
 * Queries non-Done tasks and does fuzzy matching on the title.
 *
 * @param {string} searchTerm — keywords to match against task titles
 * @returns {Promise<Object[]>} — matching tasks, sorted by relevance
 */
async function searchTasks(searchTerm) {
  /* Query all non-Done tasks — Notion doesn't support full-text search on title
     within database.query, so we fetch and filter client-side */
  /* Use raw queryDatabase — @notionhq/client v5.x removed databases.query() */
  const response = await withRetry(() =>
    queryDatabase({
      database_id: TASKS_DB_ID,
      filter: {
        property: 'Status',
        select: { does_not_equal: 'Done' },
      },
    })
  );

  const lowerSearch = searchTerm.toLowerCase();
  const searchWords = lowerSearch.split(/\s+/);

  /* Score each task by how many search words appear in the title */
  const scored = response.results
    .map((page) => {
      const title = getPageTitle(page).toLowerCase();
      const matchCount = searchWords.filter((word) => title.includes(word)).length;
      const exactMatch = title.includes(lowerSearch);
      return {
        page,
        score: exactMatch ? searchWords.length + 1 : matchCount,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  logger.info('Task search completed', { searchTerm, matchCount: scored.length });
  return scored.map((item) => item.page);
}

/**
 * Updates a task's properties in Notion.
 * For Notes field: GET existing content first, then append (never overwrite).
 *
 * @param {string} pageId — Notion page ID
 * @param {Object} updates — fields to update
 * @param {string|null} updates.status
 * @param {string|null} updates.urgency
 * @param {string|null} updates.stream
 * @param {string|null} updates.dueDate
 * @param {string|null} updates.energy
 * @param {string|null} updates.notes — text to APPEND to existing notes
 * @returns {Promise<Object>} — updated Notion page object
 */
async function updateTask(pageId, updates) {
  const properties = {};

  if (updates.status) {
    properties.Status = { select: { name: updates.status } };
  }
  if (updates.urgency) {
    properties.Urgency = { select: { name: updates.urgency } };
  }
  if (updates.stream) {
    properties.Stream = { select: { name: updates.stream } };
  }
  if (updates.energy) {
    properties.Energy = { select: { name: updates.energy } };
  }
  if (updates.dueDate) {
    properties['Due Date'] = { date: { start: updates.dueDate } };
  }

  /* Notes field: must GET existing content first, then append */
  if (updates.notes) {
    const existingPage = await withRetry(() => notion.pages.retrieve({ page_id: pageId }));
    const existingNotes = getPageRichText(existingPage, 'Notes');
    const separator = existingNotes ? '\n---\n' : '';
    const newContent = existingNotes + separator + updates.notes;

    properties.Notes = {
      rich_text: [{ text: { content: truncateText(newContent, 2000) } }],
    };
  }

  const page = await withRetry(() =>
    notion.pages.update({
      page_id: pageId,
      properties,
    })
  );

  logger.info('Task updated in Notion', { pageId });
  return page;
}

/**
 * Marks a task as Done.
 *
 * @param {string} pageId — Notion page ID
 * @returns {Promise<Object>} — updated Notion page object
 */
async function completeTask(pageId) {
  return updateTask(pageId, { status: 'Done' });
}

/* ─── Helper functions ─── */

/**
 * Extracts the plain-text title from a Notion page object.
 */
function getPageTitle(page) {
  const titleProp = page.properties?.Task?.title;
  if (!titleProp || titleProp.length === 0) return '(untitled)';
  return titleProp.map((t) => t.plain_text).join('');
}

/**
 * Extracts plain text from a Notion rich_text property.
 */
function getPageRichText(page, propertyName) {
  const prop = page.properties?.[propertyName]?.rich_text;
  if (!prop || prop.length === 0) return '';
  return prop.map((t) => t.plain_text).join('');
}

/**
 * Extracts the select value from a Notion page property.
 */
function getPageSelect(page, propertyName) {
  return page.properties?.[propertyName]?.select?.name || null;
}

/**
 * Extracts the date value from a Notion page property.
 */
function getPageDate(page, propertyName) {
  return page.properties?.[propertyName]?.date?.start || null;
}

/**
 * Truncates text to a max length, adding "..." if truncated.
 * Notion rich_text has a 2000-char limit per block.
 */
function truncateText(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

module.exports = {
  createTask,
  queryTasks,
  searchTasks,
  updateTask,
  completeTask,
  getPageTitle,
  getPageRichText,
  getPageSelect,
  getPageDate,
};
