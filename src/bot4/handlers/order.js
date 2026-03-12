/**
 * Order handler for Bot 4.
 * Processes raw order data: validates, resolves products, builds confirmation card.
 */

const crypto = require('crypto');
const { resolveProduct } = require('../config/products');
const { normalizePhone, getRegionFromPhone } = require('../utils/phone');
const { isValidPromo } = require('../services/promoStore');
const pendingOrderStore = require('../services/pendingOrderStore');
const { formatConfirmCard } = require('../templates/confirmCard');
const logger = require('../logger');

/**
 * Normalize courier string to standard values.
 *
 * @param {string|null} courier
 * @returns {string}
 */
function normalizeCourier(courier) {
  if (!courier) return 'Other';

  const lower = courier.toLowerCase();

  if (lower.includes('\u5230\u4ED8') || lower.includes('cod')) return 'SF COD';
  if (lower.includes('\u5BC4\u4ED8') || lower.includes('pl') || lower.includes('prepaid')) return 'SF PL';
  if (lower.includes('sf') || lower.includes('\u9806\u8C50')) return 'SF COD';

  return 'Other';
}

/**
 * Process a raw order: validate, resolve products, send confirmation card.
 *
 * @param {object} ctx — Telegram bot context (grammY/Telegraf)
 * @param {object} rawOrder — parsed order data from screenshot + text
 */
async function processOrder(ctx, rawOrder) {
  // 1. Normalize phone
  const phone = normalizePhone(rawOrder.phone);

  // 2. Get region
  const region = getRegionFromPhone(rawOrder.phone);

  // 3. Resolve products
  const resolvedProducts = [];
  const failedNames = [];

  if (!rawOrder.products || rawOrder.products.length === 0) {
    await ctx.reply('\u26A0\uFE0F \u672A\u627E\u5230\u4EFB\u4F55\u7522\u54C1\u8CC7\u6599\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u3002');
    return;
  }

  for (const p of rawOrder.products) {
    const resolved = resolveProduct(p.product_name, p.quantity);
    if (resolved) {
      resolvedProducts.push(resolved);
    } else {
      failedNames.push(p.product_name);
    }
  }

  if (failedNames.length > 0) {
    await ctx.reply(
      `\u26A0\uFE0F \u7121\u6CD5\u8B58\u5225\u4EE5\u4E0B\u7522\u54C1: ${failedNames.join(', ')}\n\u8ACB\u91CD\u65B0\u8F38\u5165\u6B63\u78BA\u7684\u7522\u54C1\u540D\u7A31\u548C\u6578\u91CF\u3002`
    );
    return;
  }

  // 4. Check required fields
  const missingFields = [];
  if (!rawOrder.customer_name) missingFields.push('\u5BA2\u6236\u540D\u7A31 (customer_name)');
  if (!rawOrder.phone) missingFields.push('\u96FB\u8A71 (phone)');
  if (!rawOrder.address) missingFields.push('\u5730\u5740 (address)');
  if (!rawOrder.order_id) missingFields.push('\u8A02\u55AE\u865F (order_id) \u2014 \u8ACB\u767C\u9001 FIV5S \u622A\u5716');

  if (missingFields.length > 0) {
    await ctx.reply(
      `\u26A0\uFE0F \u7F3A\u5C11\u5FC5\u586B\u6B04\u4F4D:\n${missingFields.map((f) => `  \u2022 ${f}`).join('\n')}`
    );
    return;
  }

  // 5. Validate promo
  const promoTag = rawOrder.promo_mention && isValidPromo(rawOrder.promo_mention)
    ? rawOrder.promo_mention
    : null;

  // 6. Normalize courier
  const courier = normalizeCourier(rawOrder.courier);

  // 7. Build product_string
  const productString = resolvedProducts.map((p) => {
    const prefix = promoTag ? `[${promoTag}]` : '';
    return `${prefix}${p.sku}`;
  }).join(' + ');

  // 8. Build complete order object
  const order = {
    order_id: rawOrder.order_id,
    order_date: rawOrder.order_date || null,
    region,
    customer_name: rawOrder.customer_name,
    phone,
    address: rawOrder.address,
    products: resolvedProducts,
    product_string: productString,
    selling_price: rawOrder.selling_price || null,
    promo_tag: promoTag,
    courier,
    ad_source: rawOrder.ad_source || null,
    pain_point: rawOrder.pain_point || null,
  };

  // 9. Generate UUID
  const orderUuid = crypto.randomUUID();

  // 10. Format and send confirmation card
  const { text, reply_markup } = formatConfirmCard(order, orderUuid);
  const sentMessage = await ctx.reply(text, { reply_markup });

  // 11. Save to pending order store
  pendingOrderStore.add(orderUuid, {
    order_data: order,
    poster_telegram_user_id: ctx.from.id,
    chat_id: ctx.chat.id,
    confirmation_message_id: sentMessage.message_id,
  });

  logger.info('Order confirmation card sent', {
    order_uuid: orderUuid,
    order_id: order.order_id,
    customer: order.customer_name,
    products: order.product_string,
  });
}

module.exports = { processOrder };
