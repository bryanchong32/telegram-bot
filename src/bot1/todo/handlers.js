/**
 * Todo Module — Intent Handlers.
 *
 * Handles ADD_TODO, COMPLETE_TODO, LIST_TODOS, and UPDATE_TODO intents.
 * Each handler receives the grammY context (ctx) and the parsed intent object
 * from the intent engine, then interacts with Notion via the todo/notion module.
 */

const { InlineKeyboard } = require('grammy');
const {
  createTask,
  queryTasks,
  searchTasks,
  updateTask,
  completeTask,
  getPageTitle,
  getPageSelect,
  getPageDate,
} = require('./notion');
const { inferStream } = require('../streamRouter');
const { db } = require('../../shared/db');
const logger = require('../../utils/logger');

/**
 * Handles ADD_TODO intent — creates a new task in Notion Master Tasks DB.
 *
 * @param {Object} ctx — grammY context
 * @param {Object} intent — parsed intent from intent engine
 */
async function handleAddTodo(ctx, intent) {
  try {
    /* Use intent engine's stream, but validate/override with keyword router if low confidence */
    let stream = intent.stream || 'Personal';
    let streamNote = '';

    /* If the intent engine picked a stream, trust it. Otherwise run keyword matching. */
    if (!intent.stream) {
      const routed = inferStream(intent.task + ' ' + (intent.notes || ''));
      stream = routed.stream || 'Personal';
      if (routed.confidence === 'low') {
        streamNote = '\n(Stream set to Personal — reply with correct stream to update)';
      }
    }

    /* Create the task in Notion */
    const page = await createTask({
      title: intent.task,
      status: 'Inbox',
      urgency: intent.urgency || 'No Urgency',
      stream,
      dueDate: intent.due_date || null,
      energy: intent.energy || 'Low',
      notes: intent.notes || null,
    });

    /* Build a friendly confirmation message */
    const parts = [`Added: ${intent.task}`];
    parts.push(`Stream: ${stream}`);
    if (intent.urgency && intent.urgency !== 'No Urgency') {
      parts.push(`Urgency: ${intent.urgency}`);
    }
    if (intent.due_date) {
      parts.push(`Due: ${intent.due_date}`);
    }
    if (intent.energy === 'High') {
      parts.push(`Energy: High`);
    }

    await ctx.reply(parts.join('\n') + streamNote);
  } catch (err) {
    logger.error('ADD_TODO failed', { error: err.message });

    /* Queue to pending_sync for retry */
    queuePendingSync('create_task', intent);
    await ctx.reply('Notion is unreachable. Task queued locally and will sync when restored.');
  }
}

/**
 * Handles COMPLETE_TODO intent — fuzzy-matches a task and asks for confirmation.
 *
 * @param {Object} ctx — grammY context
 * @param {Object} intent — parsed intent from intent engine
 */
async function handleCompleteTodo(ctx, intent) {
  try {
    const matches = await searchTasks(intent.search_term);

    if (matches.length === 0) {
      await ctx.reply(`No open tasks found matching "${intent.search_term}". Try different keywords.`);
      return;
    }

    /* Show the top match with a confirm/cancel button */
    const topMatch = matches[0];
    const title = getPageTitle(topMatch);
    const stream = getPageSelect(topMatch, 'Stream') || '—';
    const dueDate = getPageDate(topMatch, 'Due Date') || 'no due date';

    const keyboard = new InlineKeyboard()
      .text('Mark Done', `complete:${topMatch.id}`)
      .text('Cancel', 'complete:cancel');

    let message = `Mark this task as done?\n\n${title}\nStream: ${stream} | Due: ${dueDate}`;

    /* If there are other matches, hint at them */
    if (matches.length > 1) {
      const others = matches.slice(1, 4).map((p) => `  - ${getPageTitle(p)}`).join('\n');
      message += `\n\nOther matches:\n${others}`;
    }

    await ctx.reply(message, { reply_markup: keyboard });
  } catch (err) {
    logger.error('COMPLETE_TODO search failed', { error: err.message });
    await ctx.reply('Failed to search tasks. Please try again.');
  }
}

/**
 * Handles the confirmation callback when user taps "Mark Done" or "Cancel".
 *
 * @param {Object} ctx — grammY context (callback_query)
 */
async function handleCompleteCallback(ctx) {
  const data = ctx.callbackQuery.data;

  if (data === 'complete:cancel') {
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.editMessageText('Cancelled — task not marked done.');
    return;
  }

  /* Extract the page ID from callback data */
  const pageId = data.replace('complete:', '');

  try {
    await completeTask(pageId);
    await ctx.answerCallbackQuery({ text: 'Done!' });
    await ctx.editMessageText('Task marked as done.');
  } catch (err) {
    logger.error('COMPLETE_TODO callback failed', { error: err.message, pageId });
    await ctx.answerCallbackQuery({ text: 'Failed — try again' });
  }
}

/**
 * Handles LIST_TODOS intent — queries Notion and formats a task list.
 *
 * @param {Object} ctx — grammY context
 * @param {Object} intent — parsed intent from intent engine
 */
async function handleListTodos(ctx, intent) {
  try {
    const filter = intent.filter || 'today';
    const tasks = await queryTasks(filter);

    if (tasks.length === 0) {
      const labels = {
        today: 'No tasks due today or in progress.',
        inbox: 'Inbox is empty.',
        waiting: 'No waiting tasks.',
        upcoming: 'No upcoming tasks in the next 7 days.',
        all: 'No open tasks.',
      };
      await ctx.reply(labels[filter] || 'No tasks found.');
      return;
    }

    /* Format the task list grouped by urgency */
    const header = {
      today: `Today's Tasks`,
      inbox: 'Inbox',
      waiting: 'Waiting',
      upcoming: 'Upcoming (7 days)',
      all: 'All Open Tasks',
    };

    /* Group tasks by urgency for a clean display */
    const grouped = {};
    for (const page of tasks) {
      const urgency = getPageSelect(page, 'Urgency') || 'No Urgency';
      if (!grouped[urgency]) grouped[urgency] = [];
      grouped[urgency].push(page);
    }

    /* Urgency display order and emoji */
    const urgencyOrder = [
      { key: 'Urgent', emoji: '🔴' },
      { key: 'Less Urg', emoji: '🟡' },
      { key: 'No Urgency', emoji: '⚪' },
    ];

    let message = `${header[filter] || 'Tasks'} (${tasks.length})\n`;

    for (const { key, emoji } of urgencyOrder) {
      const group = grouped[key];
      if (!group || group.length === 0) continue;

      message += `\n${emoji} ${key}\n`;
      for (const page of group) {
        const title = getPageTitle(page);
        const stream = getPageSelect(page, 'Stream') || '';
        const dueDate = getPageDate(page, 'Due Date');
        const status = getPageSelect(page, 'Status') || '';

        let line = `  - ${title}`;
        const meta = [];
        if (stream) meta.push(stream);
        if (dueDate) meta.push(`due ${dueDate}`);
        if (filter === 'all' && status) meta.push(status);
        if (meta.length > 0) line += ` (${meta.join(', ')})`;

        message += line + '\n';
      }
    }

    await ctx.reply(message.trim());
  } catch (err) {
    logger.error('LIST_TODOS failed', { error: err.message });
    await ctx.reply('Failed to fetch tasks from Notion. Please try again.');
  }
}

/**
 * Handles UPDATE_TODO intent — fuzzy-matches a task and applies field updates.
 *
 * @param {Object} ctx — grammY context
 * @param {Object} intent — parsed intent from intent engine
 */
async function handleUpdateTodo(ctx, intent) {
  try {
    const matches = await searchTasks(intent.search_term);

    if (matches.length === 0) {
      await ctx.reply(`No open tasks found matching "${intent.search_term}". Try different keywords.`);
      return;
    }

    const topMatch = matches[0];
    const title = getPageTitle(topMatch);

    /* Build the updates object from the intent */
    const updates = {};
    if (intent.updates?.due_date) updates.dueDate = intent.updates.due_date;
    if (intent.updates?.urgency) updates.urgency = intent.updates.urgency;
    if (intent.updates?.status) updates.status = intent.updates.status;
    if (intent.updates?.stream) updates.stream = intent.updates.stream;
    if (intent.updates?.energy) updates.energy = intent.updates.energy;
    if (intent.updates?.notes) updates.notes = intent.updates.notes;

    /* Check if there are actually any updates to apply */
    if (Object.keys(updates).length === 0) {
      await ctx.reply(`Found "${title}" but no changes specified. What would you like to update?`);
      return;
    }

    /* Apply updates */
    await updateTask(topMatch.id, updates);

    /* Build confirmation message */
    const parts = [`Updated: ${title}`];
    if (updates.dueDate) parts.push(`Due: ${updates.dueDate}`);
    if (updates.urgency) parts.push(`Urgency: ${updates.urgency}`);
    if (updates.status) parts.push(`Status: ${updates.status}`);
    if (updates.stream) parts.push(`Stream: ${updates.stream}`);
    if (updates.energy) parts.push(`Energy: ${updates.energy}`);
    if (updates.notes) parts.push(`Notes appended`);

    /* If there were other matches, mention them */
    if (matches.length > 1) {
      parts.push(`\n(${matches.length - 1} other match${matches.length > 2 ? 'es' : ''} found — updated the top match)`);
    }

    await ctx.reply(parts.join('\n'));
  } catch (err) {
    logger.error('UPDATE_TODO failed', { error: err.message });
    await ctx.reply('Failed to update the task. Please try again.');
  }
}

/* ─── Helper: queue a failed write to pending_sync for retry ─── */

/**
 * Queues a failed Notion operation to SQLite pending_sync table.
 * The background worker will retry every 5 minutes.
 */
function queuePendingSync(action, payload) {
  try {
    const stmt = db.prepare(
      'INSERT INTO pending_sync (action, payload) VALUES (?, ?)'
    );
    stmt.run(action, JSON.stringify(payload));
    logger.info('Queued to pending_sync', { action });
  } catch (err) {
    logger.error('Failed to queue pending_sync', { error: err.message });
  }
}

module.exports = {
  handleAddTodo,
  handleCompleteTodo,
  handleCompleteCallback,
  handleListTodos,
  handleUpdateTodo,
};
