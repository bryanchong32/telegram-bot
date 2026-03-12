/**
 * Cancellation reply template for Bot 4.
 * Sent when an order confirmation is cancelled.
 */

const { formatTimestamp } = require('./confirmReply');

/**
 * Build the cancellation reply message.
 *
 * @param {object} order
 * @param {string} cancellerName
 * @param {Date} timestamp
 * @returns {string}
 */
function formatCancelReply(order, cancellerName, timestamp) {
  const orderId = order.order_id || 'N/A';
  const customerName = order.customer_name || 'N/A';
  const sellingPrice = order.selling_price != null
    ? `HK$${Number(order.selling_price).toLocaleString('en-US')}`
    : 'N/A';

  return [
    '\u274C \u5DF2\u53D6\u6D88',
    '',
    `\u{1F4CB} \u8A02\u55AE (Order ID: \u{1F194} ${orderId})`,
    `\u{1F464} ${customerName} — ${sellingPrice}`,
    '',
    `\u53D6\u6D88\u4EBA: ${cancellerName}`,
    `\u53D6\u6D88\u6642\u9593: ${formatTimestamp(timestamp)}`,
  ].join('\n');
}

module.exports = { formatCancelReply };
