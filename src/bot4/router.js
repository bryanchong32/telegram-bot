/**
 * Router for Bot 4 — Order Entry Bot.
 * Registers command handlers, callback query handler,
 * photo handler (screenshot OCR), and text handler (order parsing).
 */

const config = require('./config');
const logger = require('./logger');
const { parseOrderText } = require('./services/aiParser');
const { parseScreenshot } = require('./services/aiVision');
const { addScreenshot, addText } = require('./services/orderMatcher');
const { processOrder } = require('./handlers/order');
const { handleCallback } = require('./handlers/callback');
const { handlePromoCommand } = require('./handlers/promo');

/* ── Order detection keywords ── */
const ORDER_KEYWORDS = ['確認訂單', '名字', '姓名', '電話', '產品', '地址', '訂單'];

/**
 * Returns true if the text contains at least one order keyword.
 */
function hasOrderKeywords(text) {
  if (!text) return false;
  return ORDER_KEYWORDS.some((kw) => text.includes(kw));
}

/* ── Message deduplication (5-min TTL) ── */
const DEDUP_TTL_MS = 5 * 60 * 1000;
const seenMessages = new Map();

/**
 * Returns true if this message ID was already processed recently.
 * Records the ID for future checks.
 */
function isDuplicate(messageId) {
  const now = Date.now();

  // Cleanup expired entries
  for (const [id, ts] of seenMessages) {
    if (now - ts > DEDUP_TTL_MS) seenMessages.delete(id);
  }

  if (seenMessages.has(messageId)) return true;
  seenMessages.set(messageId, now);
  return false;
}

/* ── Media type helper ── */
function mediaTypeFromPath(filePath) {
  if (filePath && filePath.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

/**
 * Registers all handlers on the bot instance.
 */
function registerRouter(bot) {
  /* ── Commands ── */

  bot.command('start', (ctx) => {
    return ctx.reply(
      '👋 歡迎使用訂單機器人！\n\n'
      + '請在群組中發送訂單文字和 FIV5S 截圖，我會自動處理訂單。\n\n'
      + '輸入 /help 查看使用說明。',
    );
  });

  bot.command('help', (ctx) => {
    return ctx.reply(
      '📖 使用說明\n\n'
      + '1️⃣ 發送訂單文字（包含姓名、電話、地址、產品）\n'
      + '2️⃣ 發送 FIV5S 訂單截圖\n'
      + '3️⃣ Bot 會自動配對並生成確認卡片\n'
      + '4️⃣ 點擊「確認」或「取消」按鈕\n\n'
      + '也可以在截圖附帶文字說明（caption），一次完成。\n\n'
      + '指令：\n'
      + '/promo — 管理優惠碼 (admin)\n'
      + '/health — 查看 Bot 狀態',
    );
  });

  bot.command('health', (ctx) => {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = uptime % 60;
    return ctx.reply(
      `🟢 Bot 4 運行中\n`
      + `⏱ 運行時間: ${hours}h ${mins}m ${secs}s\n`
      + `🌍 環境: ${config.NODE_ENV}`,
    );
  });

  bot.command('promo', handlePromoCommand);

  /* ── Callback queries (confirm / cancel buttons) ── */

  bot.on('callback_query:data', handleCallback);

  /* ── Photo messages (screenshot OCR) ── */

  bot.on('message:photo', async (ctx) => {
    const msgId = ctx.message.message_id;
    if (isDuplicate(msgId)) return;

    try {
      // Download the largest photo (last in the array)
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT4_TOKEN}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mediaType = mediaTypeFromPath(file.file_path);

      // Parse the screenshot with AI Vision
      const screenshotData = await parseScreenshot(buffer, mediaType);
      if (!screenshotData) {
        return ctx.reply('⚠️ 無法識別截圖，請確認是 FIV5S 訂單截圖。', {
          reply_parameters: { message_id: msgId },
        });
      }

      const caption = ctx.message.caption || '';
      const chatId = ctx.chat.id;
      const userId = ctx.from.id;

      // If caption contains order keywords, combine screenshot + caption
      if (hasOrderKeywords(caption)) {
        const parsedCaption = await parseOrderText(caption);
        if (parsedCaption) {
          const combined = {
            ...parsedCaption,
            order_id: screenshotData.order_id,
            order_date: screenshotData.order_date,
            phone: screenshotData.phone || parsedCaption.phone,
            poster_user_id: userId,
          };
          return processOrder(ctx, combined);
        }
      }

      // No caption or caption parse failed — try order matcher
      const matched = addScreenshot(screenshotData, chatId, userId);
      if (matched) {
        return processOrder(ctx, matched);
      }

      return ctx.reply('📸 截圖已收到，等待訂單文字...', {
        reply_parameters: { message_id: msgId },
      });
    } catch (err) {
      logger.error('Photo handler error', { error: err.message, stack: err.stack });
      return ctx.reply('⚠️ 處理截圖時發生錯誤，請稍後再試。', {
        reply_parameters: { message_id: msgId },
      }).catch(() => {});
    }
  });

  /* ── Text messages (order parsing) ── */

  bot.on('message:text', async (ctx) => {
    const msgId = ctx.message.message_id;
    if (isDuplicate(msgId)) return;

    const text = ctx.message.text;

    // Silently ignore messages without order keywords
    if (!hasOrderKeywords(text)) return;

    try {
      const parsed = await parseOrderText(text);
      if (!parsed) {
        return ctx.reply('⚠️ 無法解析訂單內容，請確認格式。', {
          reply_parameters: { message_id: msgId },
        });
      }

      const chatId = ctx.chat.id;
      const userId = ctx.from.id;

      const matched = addText(parsed, chatId, userId);
      if (matched) {
        return processOrder(ctx, matched);
      }

      return ctx.reply(
        '📝 訂單文字已收到。\n⚠️ 請發送 FIV5S 截圖以獲取訂單號碼。',
        { reply_parameters: { message_id: msgId } },
      );
    } catch (err) {
      logger.error('Text handler error', { error: err.message, stack: err.stack });
      return ctx.reply('⚠️ 處理訂單文字時發生錯誤，請稍後再試。', {
        reply_parameters: { message_id: msgId },
      }).catch(() => {});
    }
  });
}

module.exports = { registerRouter };
