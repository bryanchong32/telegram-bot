/**
 * Confirmation reply template for Bot 4.
 * Sent after an order is successfully written to Google Sheet.
 */

const { formatDate } = require('./confirmCard');

/**
 * Format a Date as "11 March 2026, 10:15 PM" (12-hour, MYT timezone UTC+8).
 *
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  if (!date) return 'N/A';

  // Shift to UTC+8
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);

  const day = utc8.getUTCDate();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = months[utc8.getUTCMonth()];
  const year = utc8.getUTCFullYear();

  let hours = utc8.getUTCHours();
  const minutes = utc8.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;

  return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
}

/**
 * Format a number with commas.
 * @param {number|null} num
 * @returns {string}
 */
function formatWithCommas(num) {
  if (num == null) return 'N/A';
  return Number(num).toLocaleString('en-US');
}

/**
 * Build the confirmation reply message after writing to Google Sheet.
 *
 * @param {object} order
 * @param {string} confirmerName
 * @param {Date} timestamp
 * @returns {string}
 */
function formatConfirmReply(order, confirmerName, timestamp) {
  const orderId = order.order_id || 'N/A';
  const date = formatDate(order.order_date);
  const region = order.region || 'N/A';
  const customerName = order.customer_name || 'N/A';
  const phone = order.phone || 'N/A';
  const address = order.address || 'N/A';

  // Build product lines with promo prefix
  const productLines = (order.products || []).map((p) => {
    const promoPrefix = order.promo_tag ? `[${order.promo_tag}]` : '';
    return `${promoPrefix}${p.sku} (${p.display}) — HK$${formatWithCommas(p.price_hkd)}`;
  }).join('\n  ');

  const sellingPrice = order.selling_price != null
    ? `HK$${formatWithCommas(order.selling_price)}`
    : 'N/A';
  const courier = order.courier || 'N/A';
  const adSource = order.ad_source || 'N/A';
  const painPoint = order.pain_point || 'N/A';

  return [
    '\u2705 \u5DF2\u5BEB\u5165 Google Sheet',
    '',
    `\u{1F4CB} \u8A02\u55AE (Order ID: \u{1F194} ${orderId})`,
    `\u{1F4C5} ${date}`,
    `\u{1F30D} ${region}`,
    `\u{1F464} ${customerName}`,
    `\u{1F4DE} ${phone}`,
    `\u{1F4CD} ${address}`,
    '',
    `\u{1F4E6} ${productLines}`,
    `\u{1F4B0} ${sellingPrice} | \u{1F69A} ${courier}`,
    '',
    `\u{1F4E3} Ad: ${adSource}`,
    `\u{1F48A} Pain Point: ${painPoint}`,
    '',
    `\u78BA\u8A8D\u4EBA: ${confirmerName}`,
    `\u78BA\u8A8D\u6642\u9593: ${formatTimestamp(timestamp)}`,
  ].join('\n');
}

module.exports = { formatConfirmReply, formatTimestamp };
