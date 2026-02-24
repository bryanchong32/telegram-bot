/**
 * Weekly Review Composer.
 * Fires at Sunday 20:00 MYT via the scheduler.
 *
 * Queries Notion for waiting items (with age), tasks completed this week,
 * and upcoming tasks for the next 7 days. Formats a weekly review message
 * for Bryan to plan the week ahead.
 *
 * Spec reference: notion-todo-spec.md → Sunday Weekly Review section.
 */

const { queryTasks, getPageTitle, getPageSelect, getPageDate } = require('../todo/notion');
const { todayMYT } = require('../../utils/dates');
const logger = require('../../utils/logger');

/**
 * Composes the Sunday weekly review message.
 *
 * @returns {Promise<string>} — formatted weekly review message for Telegram
 */
async function composeWeeklyReview() {
  const today = todayMYT();
  const sections = [];

  sections.push(`🗓 Weekly Review — ${today}\n`);

  try {
    /* 1. Waiting items — tasks blocked or delegated, with how long they've been waiting */
    const waitingTasks = await queryTasks('waiting');

    if (waitingTasks.length > 0) {
      sections.push(`⏳ Waiting (${waitingTasks.length} items):`);
      waitingTasks.forEach((page) => {
        const title = getPageTitle(page);
        const stream = getPageSelect(page, 'Stream') || '';
        const createdTime = page.created_time;
        const waitingDays = daysSince(createdTime);
        sections.push(`• ${title} — ${stream} (waiting ${waitingDays} days)`);
      });
      sections.push('');
    } else {
      sections.push('⏳ No waiting items.\n');
    }

    /* 2. Completed this week — tasks marked Done in the past 7 days.
       Notion doesn't track "completed date" separately, so we query Done tasks
       and check their last_edited_time as a proxy. */
    const doneTasks = await queryDoneThisWeek();
    sections.push(`✅ Completed this week: ${doneTasks.length} tasks`);
    if (doneTasks.length > 0 && doneTasks.length <= 10) {
      doneTasks.forEach((page) => {
        const title = getPageTitle(page);
        sections.push(`  • ${title}`);
      });
    }
    sections.push('');

    /* 3. Upcoming next 7 days — tasks due in the coming week */
    const upcomingTasks = await queryTasks('upcoming');
    sections.push(`📋 Upcoming next 7 days: ${upcomingTasks.length} tasks`);
    if (upcomingTasks.length > 0) {
      upcomingTasks.forEach((page) => {
        const title = getPageTitle(page);
        const stream = getPageSelect(page, 'Stream') || '';
        const dueDate = getPageDate(page, 'Due Date') || '';
        sections.push(`  • ${title} — ${stream}${dueDate ? ', due ' + dueDate : ''}`);
      });
    }
    sections.push('');

    sections.push('Reply with new tasks or priorities for next week.');

  } catch (err) {
    logger.error('Weekly review composition failed', { error: err.message });
    sections.push('⚠️ Could not fetch some data. Check /health for details.');
  }

  return sections.join('\n').trim();
}

/**
 * Queries tasks marked Done that were last edited within the past 7 days.
 * Uses last_edited_time as a proxy for completion date since Notion
 * doesn't have a dedicated "completed at" timestamp.
 *
 * @returns {Promise<Object[]>} — array of Notion page objects
 */
async function queryDoneThisWeek() {
  const { withRetry, queryDatabase } = require('../../utils/notion');
  const config = require('../../shared/config');

  /* Calculate 7 days ago in ISO format */
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString().split('T')[0];

  const response = await withRetry(() =>
    queryDatabase({
      database_id: config.NOTION_TASKS_DB_ID,
      filter: {
        and: [
          { property: 'Status', select: { equals: 'Done' } },
          { timestamp: 'last_edited_time', last_edited_time: { on_or_after: sevenDaysAgoISO } },
        ],
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 20,
    })
  );

  return response.results;
}

/**
 * Calculates the number of days since an ISO date string.
 *
 * @param {string} isoDate — ISO datetime string
 * @returns {number} — number of days elapsed
 */
function daysSince(isoDate) {
  if (!isoDate) return 0;
  const now = new Date();
  const date = new Date(isoDate);
  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
}

module.exports = { composeWeeklyReview };
