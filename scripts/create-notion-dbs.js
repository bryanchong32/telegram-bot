/**
 * One-time script: Creates the Master Tasks and Quick Notes databases
 * in Notion with all properties and views per SCHEMA.md.
 *
 * Usage: node scripts/create-notion-dbs.js
 *
 * Prerequisites:
 * - NOTION_TOKEN set in .env
 * - The Notion integration must have access to at least one page
 *   (Bryan shares a page with the integration from the Notion UI)
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function findParentPage() {
  /**
   * Search for any page the integration has access to.
   * The integration needs at least one shared page to create databases under.
   */
  const response = await notion.search({
    filter: { property: 'object', value: 'page' },
    page_size: 10,
  });

  if (response.results.length === 0) {
    console.error('\n❌ No pages found. Please share a Notion page with the "telegram-bot" integration first.');
    console.error('   Go to Notion → open any page → "..." menu → "Connections" → add "telegram-bot"\n');
    process.exit(1);
  }

  /* Show available pages and let the script pick the first one */
  console.log('\nFound pages the integration can access:');
  response.results.forEach((page, i) => {
    const title = page.properties?.title?.title?.[0]?.plain_text
      || page.properties?.Name?.title?.[0]?.plain_text
      || '(untitled)';
    console.log(`  ${i + 1}. ${title} — ${page.id}`);
  });

  const parent = response.results[0];
  const parentTitle = parent.properties?.title?.title?.[0]?.plain_text
    || parent.properties?.Name?.title?.[0]?.plain_text
    || '(untitled)';
  console.log(`\nUsing "${parentTitle}" as parent page.\n`);
  return parent.id;
}

async function createMasterTasksDB(parentPageId) {
  console.log('Creating Master Tasks database...');

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Master Tasks' } }],
    properties: {
      /* Title property — main task name */
      'Task': { title: {} },

      /* Status — task lifecycle */
      'Status': {
        select: {
          options: [
            { name: 'Inbox', color: 'default' },
            { name: 'Todo', color: 'blue' },
            { name: 'In Progress', color: 'yellow' },
            { name: 'Waiting', color: 'orange' },
            { name: 'Done', color: 'green' },
          ],
        },
      },

      /* Urgency — priority level */
      'Urgency': {
        select: {
          options: [
            { name: 'Urgent', color: 'red' },
            { name: 'Less Urg', color: 'yellow' },
            { name: 'No Urgency', color: 'default' },
          ],
        },
      },

      /* Stream — business area / life category */
      'Stream': {
        select: {
          options: [
            { name: 'Minionions', color: 'purple' },
            { name: 'KLN', color: 'blue' },
            { name: 'Overdrive', color: 'green' },
            { name: 'Personal', color: 'default' },
            { name: 'Property', color: 'brown' },
          ],
        },
      },

      /* Due Date — date with optional time */
      'Due Date': { date: {} },

      /* Energy — effort level */
      'Energy': {
        select: {
          options: [
            { name: 'High', color: 'red' },
            { name: 'Low', color: 'green' },
          ],
        },
      },

      /* Notes — task context, always appended not overwritten */
      'Notes': { rich_text: {} },

      /* File Links — Google Drive URLs, separate from Notes */
      'File Links': { rich_text: {} },

      /* Recurring — flag for scheduler */
      'Recurring': { checkbox: {} },

      /* Created — auto-populated */
      'Created': { created_time: {} },
    },
  });

  console.log(`✅ Master Tasks created — ID: ${db.id}`);
  return db.id;
}

async function createQuickNotesDB(parentPageId) {
  console.log('Creating Quick Notes database...');

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Quick Notes' } }],
    properties: {
      /* Title — Claude-generated summary */
      'Title': { title: {} },

      /* Content — full concatenated note body */
      'Content': { rich_text: {} },

      /* Type — note category */
      'Type': {
        select: {
          options: [
            { name: 'Idea', color: 'purple' },
            { name: 'Meeting', color: 'blue' },
            { name: 'Voice', color: 'default' },
          ],
        },
      },

      /* Stream — optional, only when clearly inferable */
      'Stream': {
        select: {
          options: [
            { name: 'Minionions', color: 'purple' },
            { name: 'KLN', color: 'blue' },
            { name: 'Overdrive', color: 'green' },
            { name: 'Personal', color: 'default' },
            { name: 'Property', color: 'brown' },
          ],
        },
      },

      /* Remind At — optional, with time */
      'Remind At': { date: {} },

      /* Promoted — true if converted to Master Tasks */
      'Promoted': { checkbox: {} },

      /* Source — how the note was captured */
      'Source': {
        select: {
          options: [
            { name: 'Text', color: 'default' },
            { name: 'Voice', color: 'blue' },
          ],
        },
      },

      /* Created — auto-populated */
      'Created': { created_time: {} },
    },
  });

  console.log(`✅ Quick Notes created — ID: ${db.id}`);
  return db.id;
}

async function main() {
  console.log('=== Notion Database Creator ===\n');

  /* Find a parent page to create databases under */
  const parentPageId = await findParentPage();

  /* Create both databases */
  const tasksDbId = await createMasterTasksDB(parentPageId);
  const notesDbId = await createQuickNotesDB(parentPageId);

  /* Print the env vars to add */
  console.log('\n=== Add these to your .env file ===\n');
  console.log(`NOTION_TASKS_DB_ID=${tasksDbId}`);
  console.log(`NOTION_QUICKNOTES_DB_ID=${notesDbId}`);
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  if (err.body) console.error('   Details:', JSON.stringify(err.body, null, 2));
  process.exit(1);
});
