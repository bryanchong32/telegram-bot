/**
 * Confirmation card template for Bot 4 order flow.
 * Displays order summary with confirm/cancel inline buttons.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Convert "2026-03-11" to "11 March 2026". Handle null → "N/A".
 * Parses with UTC+8 timezone.
 *
 * @param {string|null} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';

  try {
    // Parse as UTC then display in UTC+8
    const d = new Date(dateStr + 'T00:00:00+08:00');
    if (isNaN(d.getTime())) return 'N/A';

    // Extract components in UTC+8
    const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const day = utc8.getUTCDate();
    const month = MONTHS[utc8.getUTCMonth()];
    const year = utc8.getUTCFullYear();

    return `${day} ${month} ${year}`;
  } catch {
    return 'N/A';
  }
}

/**
 * Format a number with commas (e.g. 1650 → "1,650").
 * @param {number|null} num
 * @returns {string}
 */
function formatWithCommas(num) {
  if (num == null) return 'N/A';
  return Number(num).toLocaleString('en-US');
}

/**
 * Build confirmation card text + inline keyboard for an order.
 *
 * @param {object} order — the complete order object
 * @param {string} orderUuid — UUID for callback data
 * @returns {{ text: string, reply_markup: object }}
 */
function formatConfirmCard(order, orderUuid) {
  const orderId = order.order_id || 'N/A';
  const date = formatDate(order.order_date);
  const region = order.region || 'N/A';
  const customerName = order.customer_name || 'N/A';
  const phone = order.phone || 'N/A';
  const address = order.address || 'N/A';

  // Build product lines
  const productLines = (order.products || []).map((p) => {
    const promoPrefix = order.promo_tag ? `[${order.promo_tag}]` : '';
    const price = formatWithCommas(p.price_hkd);
    return `  ${promoPrefix}${p.sku} (${p.display}) — HK$${price}`;
  }).join('\n');

  const sellingPrice = order.selling_price != null
    ? `HK$${formatWithCommas(order.selling_price)}`
    : 'N/A';
  const promoTag = order.promo_tag || 'N/A';
  const courier = order.courier || 'N/A';
  const adSource = order.ad_source || 'N/A';
  const painPoint = order.pain_point || 'N/A';

  const text = [
    `\u{1F4CB} \u65B0\u8A02\u55AE\u78BA\u8A8D (Order ID: \u{1F194} ${orderId})`,
    `\u{1F4C5} ${date}`,
    `\u{1F30D} ${region}`,
    `\u{1F464} ${customerName}`,
    `\u{1F4DE} ${phone}`,
    `\u{1F4CD} ${address}`,
    '',
    `\u{1F4E6} \u7522\u54C1:`,
    productLines,
    `\u{1F4B0} \u552E\u50F9: ${sellingPrice}`,
    `\u{1F3F7}\uFE0F \u512A\u60E0: ${promoTag}`,
    `\u{1F69A} ${courier}`,
    '',
    `\u{1F4E3} Ad: ${adSource}`,
    `\u{1F48A} Pain Point: ${painPoint}`,
  ].join('\n');

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '\u2705 \u78BA\u8A8D\u5BEB\u5165 Google Sheet', callback_data: `confirm_${orderUuid}` },
        { text: '\u274C \u53D6\u6D88', callback_data: `cancel_${orderUuid}` },
      ],
    ],
  };

  return { text, reply_markup };
}

module.exports = { formatConfirmCard, formatDate };
