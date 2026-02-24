/**
 * Notion File Links — append file links to Master Tasks.
 *
 * Handles the "File Links" rich_text property on Notion Master Tasks pages.
 * IMPORTANT: Notion API replaces rich_text on PATCH — we must GET existing
 * content first, append the new link, then PATCH the combined result.
 *
 * File attachments are processed sequentially to avoid race conditions
 * on the File Links field (per CLAUDE.md coding standards).
 */

const { notion, withRetry } = require('../../utils/notion');
const logger = require('../../utils/logger');

/**
 * Appends a Google Drive file link to a task's File Links property.
 * GET → append → PATCH to avoid overwriting existing links.
 *
 * @param {string} pageId — Notion page ID of the task
 * @param {string} fileName — display name for the link
 * @param {string} driveUrl — Google Drive shareable URL
 */
async function appendFileLink(pageId, fileName, driveUrl) {
  /* Step 1: GET the current File Links content */
  const page = await withRetry(() =>
    notion.pages.retrieve({ page_id: pageId })
  );

  const existingLinks = page.properties?.['File Links']?.rich_text || [];
  const existingText = existingLinks.map((t) => t.plain_text).join('');

  /* Step 2: Build the new link entry.
     Format: [filename] URL — one per line, easy to scan in Notion. */
  const newEntry = `[${fileName}] ${driveUrl}`;
  const separator = existingText ? '\n' : '';
  const combinedText = existingText + separator + newEntry;

  /* Step 3: PATCH with the combined content.
     Use a linked rich_text block so the URL is clickable in Notion. */
  const richTextBlocks = [];

  /* If there was existing content, preserve it as plain text */
  if (existingText) {
    richTextBlocks.push({
      type: 'text',
      text: { content: existingText + '\n' },
    });
  }

  /* Add the new link as a clickable rich_text block */
  richTextBlocks.push({
    type: 'text',
    text: {
      content: newEntry,
      link: { url: driveUrl },
    },
  });

  /* Notion rich_text has a 2000-char limit per block.
     If total exceeds limit, fall back to plain text (truncated). */
  const totalLength = richTextBlocks.reduce(
    (sum, block) => sum + block.text.content.length, 0
  );

  if (totalLength > 2000) {
    /* Truncate to fit — keep as much as possible */
    const truncated = combinedText.slice(0, 1997) + '...';
    await withRetry(() =>
      notion.pages.update({
        page_id: pageId,
        properties: {
          'File Links': {
            rich_text: [{ text: { content: truncated } }],
          },
        },
      })
    );
  } else {
    await withRetry(() =>
      notion.pages.update({
        page_id: pageId,
        properties: {
          'File Links': { rich_text: richTextBlocks },
        },
      })
    );
  }

  logger.info('File link appended to task', { pageId, fileName });
}

module.exports = { appendFileLink };
