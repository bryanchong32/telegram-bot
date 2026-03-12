/**
 * Callback handler for Bot 4.
 * Handles confirm/cancel button taps on order confirmation cards.
 */

const pendingOrderStore = require('../services/pendingOrderStore');
const { writeOrderToSheet } = require('../services/sheetWriter');
const { formatConfirmReply } = require('../templates/confirmReply');
const { formatCancelReply } = require('../templates/cancelReply');
const logger = require('../logger');

/**
 * Handle inline keyboard callback queries (confirm/cancel buttons).
 *
 * @param {object} ctx — Telegram bot context
 */
async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data;

  // Only handle confirm_ and cancel_ callbacks
  if (!data.startsWith('confirm_') && !data.startsWith('cancel_')) return;

  const isConfirm = data.startsWith('confirm_');
  const orderUuid = data.replace(/^(confirm_|cancel_)/, '');

  // 3. Get pending order
  const pending = pendingOrderStore.get(orderUuid);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: '\u8A02\u55AE\u5DF2\u904E\u671F', show_alert: true });
    return;
  }

  // 4. Poster-only check
  if (ctx.callbackQuery.from.id !== pending.poster_telegram_user_id) {
    await ctx.answerCallbackQuery({ text: '\u53EA\u6709\u767C\u9001\u4EBA\u53EF\u4EE5\u78BA\u8A8D', show_alert: true });
    return;
  }

  // 5. Get tapper name
  const tapperName = ctx.callbackQuery.from.username
    ? `@${ctx.callbackQuery.from.username}`
    : ctx.callbackQuery.from.first_name;

  // 6. Current timestamp
  const timestamp = new Date();

  const order = pending.order_data;

  if (isConfirm) {
    // Write to Google Sheet
    const success = await writeOrderToSheet(order);
    if (!success) {
      await ctx.answerCallbackQuery({
        text: '\u5BEB\u5165 Google Sheet \u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66',
        show_alert: true,
      });
      return;
    }

    // Send confirm reply as reply to the confirmation message
    const replyText = formatConfirmReply(order, tapperName, timestamp);
    await ctx.reply(replyText, {
      reply_to_message_id: pending.confirmation_message_id,
    });

    logger.info('Order confirmed and written to sheet', {
      order_uuid: orderUuid,
      order_id: order.order_id,
      confirmed_by: tapperName,
    });
  } else {
    // Send cancel reply as reply to the confirmation message
    const replyText = formatCancelReply(order, tapperName, timestamp);
    await ctx.reply(replyText, {
      reply_to_message_id: pending.confirmation_message_id,
    });

    logger.info('Order cancelled', {
      order_uuid: orderUuid,
      order_id: order.order_id,
      cancelled_by: tapperName,
    });
  }

  // Remove inline keyboard
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch (err) {
    logger.warn('Failed to remove inline keyboard', { error: err.message });
  }

  // Cleanup
  pendingOrderStore.remove(orderUuid);
  await ctx.answerCallbackQuery();
}

module.exports = { handleCallback };
