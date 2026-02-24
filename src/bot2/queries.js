/**
 * Expense query handler for Bot 2.
 *
 * Parses natural language expense queries via Claude Haiku
 * and returns formatted summaries from Google Sheets data.
 *
 * Supported queries: this month, last month, by category, recent, total.
 */

const { chat } = require('../utils/anthropic');
const { getExpensesByMonth, getExpensesByCategory, getAllExpenses } = require('./sheets');
const { todayMYT } = require('../utils/dates');
const logger = require('../utils/logger');

/* System prompt for classifying expense queries */
const QUERY_SYSTEM_PROMPT = `You classify expense queries from a Telegram bot user. Return ONLY valid JSON — no code fences.

Query types:
- "this_month" — current month summary (default if vague)
- "last_month" — previous month summary
- "by_category" — breakdown by category (optional: specific month)
- "recent" — last 5-10 transactions
- "search" — find specific merchant or category

Today's date: {{TODAY}}

JSON schema:
{"type": "this_month|last_month|by_category|recent|search", "month": "YYYY-MM or null", "search_term": "keyword or null"}

Examples:
- "how much this month" → {"type": "this_month", "month": null, "search_term": null}
- "total for january" → {"type": "this_month", "month": "2026-01", "search_term": null}
- "breakdown by category" → {"type": "by_category", "month": null, "search_term": null}
- "grab expenses" → {"type": "search", "month": null, "search_term": "grab"}
- "last 5 receipts" → {"type": "recent", "month": null, "search_term": null}`;

/**
 * Handles a text expense query. Classifies with Haiku, then queries Sheets.
 *
 * @param {string} text — user's text message
 * @returns {Promise<string>} — formatted response message
 */
async function handleExpenseQuery(text) {
  /* Classify the query using Claude Haiku */
  const query = await classifyQuery(text);
  logger.info('Expense query classified', { type: query.type });

  switch (query.type) {
    case 'this_month':
      return formatMonthSummary(query.month || currentMonth());
    case 'last_month':
      return formatMonthSummary(query.month || previousMonth());
    case 'by_category':
      return formatCategoryBreakdown(query.month || currentMonth());
    case 'recent':
      return formatRecentExpenses();
    case 'search':
      return formatSearchResults(query.search_term || text);
    default:
      return formatMonthSummary(currentMonth());
  }
}

/**
 * Classifies an expense query text into a structured query object.
 */
async function classifyQuery(text) {
  try {
    const system = QUERY_SYSTEM_PROMPT.replace('{{TODAY}}', todayMYT());
    const response = await chat({
      system,
      userMessage: text,
      model: 'haiku',
      maxTokens: 128,
    });

    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    return JSON.parse(cleaned);
  } catch (err) {
    logger.warn('Query classification failed — defaulting to this_month', { error: err.message });
    return { type: 'this_month', month: null, search_term: null };
  }
}

/**
 * Formats a monthly expense summary message.
 */
async function formatMonthSummary(yearMonth) {
  const { expenses, total, count } = await getExpensesByMonth(yearMonth);
  const label = formatMonthLabel(yearMonth);

  if (count === 0) {
    return `No expenses recorded for ${label}.`;
  }

  let msg = `Expenses for ${label}:\n\n`;
  msg += `Total: RM${total.toFixed(2)} (${count} receipts)\n\n`;

  /* Show last 5 entries */
  const recent = expenses.slice(-5);
  for (const e of recent) {
    msg += `  ${e.date} — ${e.merchant}: ${e.currency} ${e.amount.toFixed(2)}\n`;
  }

  if (count > 5) {
    msg += `\n  ...and ${count - 5} more`;
  }

  return msg;
}

/**
 * Formats a category breakdown message.
 */
async function formatCategoryBreakdown(yearMonth) {
  const { categories, total, count } = await getExpensesByCategory(yearMonth);
  const label = formatMonthLabel(yearMonth);

  if (count === 0) {
    return `No expenses recorded for ${label}.`;
  }

  let msg = `Category breakdown for ${label}:\n\n`;

  /* Sort categories by amount (highest first) */
  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  for (const [cat, amount] of sorted) {
    const pct = ((amount / total) * 100).toFixed(0);
    msg += `  ${cat}: RM${amount.toFixed(2)} (${pct}%)\n`;
  }

  msg += `\nTotal: RM${total.toFixed(2)} (${count} receipts)`;
  return msg;
}

/**
 * Formats the most recent expenses (last 10).
 */
async function formatRecentExpenses() {
  const all = await getAllExpenses();

  if (all.length === 0) {
    return 'No expenses recorded yet.';
  }

  const recent = all.slice(-10).reverse();
  let msg = `Recent expenses (last ${recent.length}):\n\n`;

  for (const e of recent) {
    msg += `  ${e.date} — ${e.merchant}: ${e.currency} ${e.amount.toFixed(2)} [${e.category}]\n`;
  }

  return msg;
}

/**
 * Searches expenses by merchant name or category keyword.
 */
async function formatSearchResults(searchTerm) {
  const all = await getAllExpenses();
  const term = searchTerm.toLowerCase();

  const matches = all.filter(
    (e) =>
      e.merchant.toLowerCase().includes(term) ||
      e.category.toLowerCase().includes(term) ||
      (e.notes && e.notes.toLowerCase().includes(term))
  );

  if (matches.length === 0) {
    return `No expenses found matching "${searchTerm}".`;
  }

  const total = matches.reduce((sum, e) => sum + e.amount, 0);
  let msg = `Found ${matches.length} expenses matching "${searchTerm}":\n\n`;

  const shown = matches.slice(-10);
  for (const e of shown) {
    msg += `  ${e.date} — ${e.merchant}: ${e.currency} ${e.amount.toFixed(2)}\n`;
  }

  if (matches.length > 10) {
    msg += `\n  ...and ${matches.length - 10} more`;
  }

  msg += `\nTotal: RM${total.toFixed(2)}`;
  return msg;
}

/** Returns current month as YYYY-MM */
function currentMonth() {
  return todayMYT().substring(0, 7);
}

/** Returns previous month as YYYY-MM */
function previousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }).substring(0, 7);
}

/** Formats YYYY-MM into a readable label like "February 2026" */
function formatMonthLabel(yearMonth) {
  const [year, month] = yearMonth.split('-');
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[parseInt(month) - 1]} ${year}`;
}

module.exports = { handleExpenseQuery };
