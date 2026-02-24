/**
 * Daily Briefing Composer.
 * Fires at 08:00 MYT every day via the scheduler.
 *
 * Queries Notion for today's tasks (due today OR In Progress),
 * inbox count, and active reminders, then formats a morning briefing
 * message to send via Telegram.
 *
 * Spec reference: notion-todo-spec.md → Daily Briefing section.
 */

const { queryTasks, getPageTitle, getPageSelect, getPageDate } = require('../todo/notion');
const { queryNotes, getNoteTitle, getNoteDate } = require('../notes/notion');
const { todayMYT, formatMYT } = require('../../utils/dates');
const logger = require('../../utils/logger');

/**
 * Composes the daily morning briefing message.
 * Each section is modular — easy to extend with calendar in Phase 2.
 *
 * @returns {Promise<string>} — formatted briefing message for Telegram
 */
async function composeDailyBriefing() {
  const today = todayMYT();
  const sections = [];

  sections.push(`📋 Today's Tasks — ${today}\n`);

  try {
    /* 1. Today's tasks: due today OR Status = In Progress */
    const todayTasks = await queryTasks('today');

    if (todayTasks.length === 0) {
      sections.push('No tasks due today. Clean slate!\n');
    } else {
      /* Group tasks by urgency for clear prioritisation */
      const urgent = [];
      const lessUrg = [];
      const noUrgency = [];
      const inProgress = [];

      todayTasks.forEach((page) => {
        const title = getPageTitle(page);
        const stream = getPageSelect(page, 'Stream') || '';
        const urgency = getPageSelect(page, 'Urgency') || 'No Urgency';
        const status = getPageSelect(page, 'Status') || '';
        const dueDate = getPageDate(page, 'Due Date');

        const duePart = dueDate === today ? ' (due today)' : '';
        const line = `• ${title}${duePart} — ${stream}`;

        if (status === 'In Progress') {
          inProgress.push(line);
        } else if (urgency === 'Urgent') {
          urgent.push(line);
        } else if (urgency === 'Less Urg') {
          lessUrg.push(line);
        } else {
          noUrgency.push(line);
        }
      });

      if (urgent.length > 0) {
        sections.push('🔴 Urgent');
        sections.push(urgent.join('\n'));
        sections.push('');
      }
      if (lessUrg.length > 0) {
        sections.push('🟡 Less Urgent');
        sections.push(lessUrg.join('\n'));
        sections.push('');
      }
      if (noUrgency.length > 0) {
        sections.push('⚪ No Urgency');
        sections.push(noUrgency.join('\n'));
        sections.push('');
      }
      if (inProgress.length > 0) {
        sections.push('🔵 In Progress');
        sections.push(inProgress.join('\n'));
        sections.push('');
      }
    }

    /* 2. Inbox count — unprocessed tasks that need triaging */
    const inboxTasks = await queryTasks('inbox');
    if (inboxTasks.length > 0) {
      sections.push(`📥 Inbox — ${inboxTasks.length} unprocessed`);
      sections.push('Reply "inbox" to review\n');
    }

    /* 3. Active reminders for today */
    const reminders = await queryNotes('reminders');
    const todayReminders = reminders.filter((page) => {
      const remindAt = getNoteDate(page, 'Remind At');
      if (!remindAt) return false;
      return remindAt.startsWith(today);
    });

    if (todayReminders.length > 0) {
      sections.push(`⏰ Reminders today — ${todayReminders.length}`);
      todayReminders.forEach((page) => {
        const title = getNoteTitle(page);
        const remindAt = getNoteDate(page, 'Remind At');
        const time = remindAt ? formatMYT(remindAt).split(', ')[1] : '';
        sections.push(`• ${title}${time ? ' at ' + time : ''}`);
      });
      sections.push('');
    }

    /* 4. Calendar placeholder — Phase 2 */
    /* When calendar module is built, add a section here:
       const calendarSection = await composeCalendarSection();
       if (calendarSection) sections.push(calendarSection); */

  } catch (err) {
    logger.error('Daily briefing composition failed', { error: err.message });
    sections.push('⚠️ Could not fetch some data. Check /health for details.');
  }

  return sections.join('\n').trim();
}

module.exports = { composeDailyBriefing };
