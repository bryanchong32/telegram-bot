/**
 * Sheet Writer — appends confirmed orders to the Google Sheet.
 * Uses service account auth (same credentials as CRM).
 */

const { google } = require('googleapis');
const { buildRowPartA, buildRowPartB } = require('../config/sheetColumns');
const config = require('../config');
const logger = require('../logger');

/* Parse service account credentials from env var (JSON string) */
let credentials;
try {
  credentials = JSON.parse(config.GOOGLE_SHEETS_CREDENTIALS);
} catch (err) {
  logger.error('Failed to parse GOOGLE_SHEETS_CREDENTIALS', { error: err.message });
  throw new Error('Invalid GOOGLE_SHEETS_CREDENTIALS — must be valid JSON');
}

/* Create service account auth client */
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

/**
 * Retry wrapper for Google API calls (429 / 5xx).
 */
async function withRetry(fn, maxRetries = 2) {
  const delays = [1000, 3000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status || err.code;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = delays[attempt] || 3000;
      logger.warn('Google API retry', { attempt: attempt + 1, status, delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Find the next empty row by scanning column G (Contact Number).
 * Returns the 1-based row number to write to.
 */
async function findNextEmptyRow() {
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: 'Order_List!G:G',
      majorDimension: 'COLUMNS',
    })
  );

  const values = res.data.values?.[0] || [];
  // values.length = number of rows with data in column G (including header)
  // Next empty row = values.length + 1 (1-based)
  return values.length + 1;
}

/**
 * Write a confirmed order to the Google Sheet.
 * Finds the next empty row (by Contact Number column) and writes there.
 * @param {object} order — combined order data
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function writeOrderToSheet(order) {
  try {
    const partA = buildRowPartA(order); // A:K
    const partB = buildRowPartB(order); // Q:X
    const nextRow = await findNextEmptyRow();

    // Write A:K and Q:X separately to skip formula columns L:P
    await withRetry(() =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: config.GOOGLE_SHEETS_SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: `Order_List!A${nextRow}:K${nextRow}`, values: [partA] },
            { range: `Order_List!Q${nextRow}:X${nextRow}`, values: [partB] },
          ],
        },
      })
    );

    logger.info('Order written to sheet', {
      order_id: order.order_id,
      phone: order.phone,
      row: nextRow,
    });

    return true;
  } catch (err) {
    logger.error('Failed to write order to sheet', {
      order_id: order.order_id,
      phone: order.phone,
      error: err.message,
    });

    return false;
  }
}

module.exports = { writeOrderToSheet };
