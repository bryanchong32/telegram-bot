/**
 * Sheet Writer — appends completed orders to the Google Sheet.
 */

const { sheets, withGoogleRetry } = require('../../utils/google');
const { buildSheetRow } = require('../config/sheetColumns');
const config = require('../config');
const logger = require('../logger');

/**
 * Write a combined order object to the Google Sheet.
 *
 * @param {object} order — combined order from orderMatcher
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function writeOrderToSheet(order) {
  try {
    const row = buildSheetRow(order);

    await withGoogleRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId: config.GOOGLE_SHEETS_SPREADSHEET_ID,
        range: 'order_list!A:Q',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row],
        },
      })
    );

    logger.info('Order written to sheet', {
      order_id: order.order_id,
      phone: order.phone,
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
