/**
 * Google Sheets expense logging module.
 *
 * Appends receipt data as rows to the "Expense Log" spreadsheet.
 * Also provides query functions for expense summaries.
 *
 * Sheet headers (row 1):
 * Date | Merchant | Amount | Currency | Category | Receipt Link | Notes | Created At | Logged By
 */

const { sheets, withGoogleRetry } = require('../utils/google');
const config = require('../shared/config');
const { nowMYT } = require('../utils/dates');
const logger = require('../utils/logger');

const SHEET_NAME = 'Expenses';

/**
 * Appends a receipt record as a new row to the Expense Log spreadsheet.
 *
 * @param {Object} receipt — extracted receipt data
 * @param {string} receipt.date — YYYY-MM-DD
 * @param {string} receipt.merchant — store/restaurant name
 * @param {number} receipt.amount — total amount
 * @param {string} receipt.currency — currency code (MYR, USD, etc.)
 * @param {string} receipt.category — expense category
 * @param {string} receipt.driveLink — Google Drive link to the receipt file
 * @param {string|null} receipt.notes — any extra notes
 * @param {string} receipt.loggedBy — who logged this receipt (Telegram display name)
 */
/**
 * Checks if a receipt with the same date and amount already exists in the sheet.
 * Returns true if a duplicate is found (within ±0.01 tolerance for float comparison).
 */
async function checkDuplicate(date, amount) {
  const all = await getAllExpenses();

  return all.some((e) =>
    e.date === date && Math.abs(e.amount - amount) < 0.01
  );
}

async function appendExpenseRow(receipt) {
  const spreadsheetId = config.GSHEETS_EXPENSE_LOG_ID;
  if (!spreadsheetId) {
    throw new Error('GSHEETS_EXPENSE_LOG_ID not set — run scripts/setup-google.js first');
  }

  /* Duplicate check — reject if same date + amount already exists */
  const isDup = await checkDuplicate(receipt.date, receipt.amount);
  if (isDup) {
    logger.warn('Duplicate expense rejected', {
      date: receipt.date,
      merchant: receipt.merchant,
      amount: receipt.amount,
    });
    return { rowIndex: null, duplicate: true };
  }

  const row = [
    receipt.date,
    receipt.merchant,
    receipt.amount,
    receipt.currency,
    receipt.category,
    receipt.driveLink || '',
    receipt.notes || '',
    nowMYT(),
    receipt.loggedBy || 'Bot',
  ];

  const res = await withGoogleRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:I`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    })
  );

  /* Extract the row number from the updatedRange (e.g. "Expenses!A5:I5" → 5) */
  const updatedRange = res.data.updates?.updatedRange || '';
  const rowMatch = updatedRange.match(/!A(\d+):/);
  const rowIndex = rowMatch ? parseInt(rowMatch[1]) : null;

  logger.info('Expense row appended', {
    merchant: receipt.merchant,
    amount: receipt.amount,
    rowIndex,
  });

  return { rowIndex };
}

/**
 * Reads all expense rows from the spreadsheet.
 * Returns parsed objects (skips header row).
 *
 * @returns {Promise<Array<Object>>} — array of expense records
 */
async function getAllExpenses() {
  const spreadsheetId = config.GSHEETS_EXPENSE_LOG_ID;

  const res = await withGoogleRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A:I`,
    })
  );

  const rows = res.data.values || [];
  if (rows.length <= 1) return []; /* Only header or empty */

  /* Skip header row (index 0), parse each data row */
  return rows.slice(1).map((row) => ({
    date: row[0] || '',
    merchant: row[1] || '',
    amount: parseFloat(row[2]) || 0,
    currency: row[3] || 'MYR',
    category: row[4] || 'Other',
    driveLink: row[5] || '',
    notes: row[6] || '',
    createdAt: row[7] || '',
    loggedBy: row[8] || '',
  }));
}

/**
 * Queries expenses for a given month (YYYY-MM format).
 * Returns matching records and a total amount.
 *
 * @param {string} yearMonth — e.g. "2026-02"
 * @returns {Promise<{expenses: Array, total: number, count: number}>}
 */
async function getExpensesByMonth(yearMonth) {
  const all = await getAllExpenses();
  const filtered = all.filter((e) => e.date.startsWith(yearMonth));
  const total = filtered.reduce((sum, e) => sum + e.amount, 0);

  return { expenses: filtered, total, count: filtered.length };
}

/**
 * Queries expenses by category for a given month.
 * Returns a breakdown of spending per category.
 *
 * @param {string} yearMonth — e.g. "2026-02"
 * @returns {Promise<Object>} — { categories: { "Food": 150, ... }, total, count }
 */
async function getExpensesByCategory(yearMonth) {
  const { expenses, total, count } = await getExpensesByMonth(yearMonth);

  const categories = {};
  for (const e of expenses) {
    categories[e.category] = (categories[e.category] || 0) + e.amount;
  }

  return { categories, total, count };
}

/**
 * Deletes a row from the Expense Log spreadsheet by row index.
 * Uses batchUpdate with deleteDimension request (deletes the entire row).
 *
 * @param {number} rowIndex — 1-based row number (as returned by appendExpenseRow)
 */
async function deleteExpenseRow(rowIndex) {
  const spreadsheetId = config.GSHEETS_EXPENSE_LOG_ID;

  /* Get the sheet ID (needed for batchUpdate — usually 0 for first sheet) */
  const sheetMeta = await withGoogleRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    })
  );

  const sheetId = sheetMeta.data.sheets.find(
    (s) => s.properties.title === SHEET_NAME
  )?.properties?.sheetId || 0;

  /* Delete the row — startIndex is 0-based, endIndex is exclusive */
  await withGoogleRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        }],
      },
    })
  );

  logger.info('Expense row deleted', { rowIndex });
}

module.exports = {
  appendExpenseRow,
  checkDuplicate,
  deleteExpenseRow,
  getAllExpenses,
  getExpensesByMonth,
  getExpensesByCategory,
};
