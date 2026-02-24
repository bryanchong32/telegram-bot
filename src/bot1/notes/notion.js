/**
 * Notion Quick Notes DB — read/write operations.
 *
 * All Notion interactions for the Notes module go through this file.
 * Uses withRetry() for automatic exponential backoff on failures.
 * Mirrors the pattern established in todo/notion.js.
 *
 * Quick Notes schema:
 *   Title (title) — Claude-generated summary
 *   Content (rich_text) — full concatenated note body
 *   Type (select) — Idea / Meeting / Voice
 *   Stream (select) — Minionions / KLN / Overdrive / Personal / Property (optional)
 *   Remind At (date) — optional, with time
 *   Promoted (checkbox) — true if converted to Master Tasks
 *   Source (select) — Text / Voice
 */

const { notion, withRetry, queryDatabase } = require('../../utils/notion');
const config = require('../../shared/config');
const logger = require('../../utils/logger');

const QUICKNOTES_DB_ID = config.NOTION_QUICKNOTES_DB_ID;

/**
 * Creates a new note in the Quick Notes database.
 *
 * @param {Object} note
 * @param {string} note.title — Claude-generated summary (never raw first line)
 * @param {string} note.content — full concatenated note body
 * @param {string} note.type — Idea / Meeting / Voice
 * @param {string|null} note.stream — optional stream (null if ambiguous)
 * @param {string|null} note.remindAt — ISO datetime or null
 * @param {string} note.source — Text / Voice
 * @returns {Promise<Object>} — created Notion page object
 */
async function createNote(note) {
  /* Build the properties object for Notion */
  const properties = {
    Title: { title: [{ text: { content: note.title } }] },
    Content: { rich_text: [{ text: { content: truncateText(note.content, 2000) } }] },
    Type: { select: { name: note.type || 'Idea' } },
    Source: { select: { name: note.source || 'Text' } },
    Promoted: { checkbox: false },
  };

  /* Only set Stream if provided — leave blank when ambiguous (spec requirement) */
  if (note.stream) {
    properties.Stream = { select: { name: note.stream } };
  }

  /* Only set Remind At if provided */
  if (note.remindAt) {
    properties['Remind At'] = { date: { start: note.remindAt } };
  }

  const page = await withRetry(() =>
    notion.pages.create({
      parent: { database_id: QUICKNOTES_DB_ID },
      properties,
    })
  );

  logger.info('Note created in Notion', { pageId: page.id });
  return page;
}

/**
 * Queries notes from the Quick Notes database with optional filters.
 *
 * @param {string} filter — 'all' | 'ideas' | 'meetings' | 'voice' | 'reminders'
 * @param {string|null} searchTerm — optional text search (Notion title search)
 * @returns {Promise<Object[]>} — array of Notion page objects
 */
async function queryNotes(filter = 'all', searchTerm = null) {
  let notionFilter;

  switch (filter) {
    case 'ideas':
      notionFilter = { property: 'Type', select: { equals: 'Idea' } };
      break;

    case 'meetings':
      notionFilter = { property: 'Type', select: { equals: 'Meeting' } };
      break;

    case 'voice':
      notionFilter = { property: 'Type', select: { equals: 'Voice' } };
      break;

    case 'reminders':
      /* Remind At is not empty AND Promoted = false */
      notionFilter = {
        and: [
          { property: 'Remind At', date: { is_not_empty: true } },
          { property: 'Promoted', checkbox: { equals: false } },
        ],
      };
      break;

    case 'all':
    default:
      notionFilter = undefined;
      break;
  }

  /* Sort by Created descending — most recent first */
  const sorts = [{ timestamp: 'created_time', direction: 'descending' }];

  const response = await withRetry(() =>
    queryDatabase({
      database_id: QUICKNOTES_DB_ID,
      filter: notionFilter,
      sorts,
      page_size: 20,
    })
  );

  /* If there's a search term, filter client-side (Notion database queries
     don't support full-text search on title, so we fetch and match) */
  let results = response.results;
  if (searchTerm) {
    const lowerSearch = searchTerm.toLowerCase();
    results = results.filter((page) => {
      const title = getNoteTitle(page).toLowerCase();
      const content = getNoteContent(page).toLowerCase();
      return title.includes(lowerSearch) || content.includes(lowerSearch);
    });
  }

  logger.info('Notes queried from Notion', { filter, count: results.length });
  return results;
}

/**
 * Searches for a note by title (fuzzy matching).
 * Used by PROMOTE_TO_TASK to find a specific note.
 *
 * @param {string} searchTerm — keywords to match against note titles
 * @returns {Promise<Object[]>} — matching notes, sorted by relevance
 */
async function searchNotes(searchTerm) {
  /* Fetch recent non-promoted notes */
  const response = await withRetry(() =>
    queryDatabase({
      database_id: QUICKNOTES_DB_ID,
      filter: { property: 'Promoted', checkbox: { equals: false } },
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 50,
    })
  );

  const lowerSearch = searchTerm.toLowerCase();
  const searchWords = lowerSearch.split(/\s+/);

  /* Score each note by how many search words appear in the title */
  const scored = response.results
    .map((page) => {
      const title = getNoteTitle(page).toLowerCase();
      const matchCount = searchWords.filter((word) => title.includes(word)).length;
      const exactMatch = title.includes(lowerSearch);
      return {
        page,
        score: exactMatch ? searchWords.length + 1 : matchCount,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  logger.info('Note search completed', { searchTerm, matchCount: scored.length });
  return scored.map((item) => item.page);
}

/**
 * Marks a note as Promoted in the Quick Notes database.
 *
 * @param {string} pageId — Notion page ID
 * @returns {Promise<Object>} — updated Notion page object
 */
async function markNotePromoted(pageId) {
  const page = await withRetry(() =>
    notion.pages.update({
      page_id: pageId,
      properties: {
        Promoted: { checkbox: true },
      },
    })
  );

  logger.info('Note marked as promoted', { pageId });
  return page;
}

/* ─── Helper functions ─── */

/**
 * Extracts the plain-text title from a Quick Notes page object.
 * Quick Notes uses "Title" property (not "Task" like Master Tasks).
 */
function getNoteTitle(page) {
  const titleProp = page.properties?.Title?.title;
  if (!titleProp || titleProp.length === 0) return '(untitled)';
  return titleProp.map((t) => t.plain_text).join('');
}

/**
 * Extracts plain text from the Content (rich_text) property.
 */
function getNoteContent(page) {
  const prop = page.properties?.Content?.rich_text;
  if (!prop || prop.length === 0) return '';
  return prop.map((t) => t.plain_text).join('');
}

/**
 * Extracts the select value from a Notion page property.
 */
function getNoteSelect(page, propertyName) {
  return page.properties?.[propertyName]?.select?.name || null;
}

/**
 * Extracts the date value from a Notion page property.
 */
function getNoteDate(page, propertyName) {
  return page.properties?.[propertyName]?.date?.start || null;
}

/**
 * Extracts the checkbox value from a Notion page property.
 */
function getNoteCheckbox(page, propertyName) {
  return page.properties?.[propertyName]?.checkbox || false;
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
  createNote,
  queryNotes,
  searchNotes,
  markNotePromoted,
  getNoteTitle,
  getNoteContent,
  getNoteSelect,
  getNoteDate,
  getNoteCheckbox,
};
