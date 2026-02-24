/**
 * Bot 2 — Receipt & Expense Tracker message router.
 *
 * Routes:
 * - /start, /help — welcome + feature overview
 * - /summary — this month's expense summary
 * - /categories — category breakdown
 * - /recent — last 10 receipts
 * - Photo/document → Claude Vision → Sheets + Drive → confirmation
 * - Text → expense query (Haiku classification → Sheets lookup)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractReceiptData, CONFIDENCE_THRESHOLD } = require('./vision');
const { uploadReceiptToDrive } = require('./drive');
const { appendExpenseRow, deleteExpenseRow } = require('./sheets');
const { InlineKeyboard } = require('grammy');
const { drive, withGoogleRetry } = require('../utils/google');
const { handleExpenseQuery } = require('./queries');
const logger = require('../utils/logger');

/**
 * Registers all command and message handlers on the bot instance.
 */
function registerRouter(bot) {

  /* ─── Commands ─── */

  /* /start — welcome message with feature overview */
  bot.command('start', async (ctx) => {
    logger.info('Bot 2 /start', { chatId: ctx.chat.id });
    await ctx.reply(
      'Hey Bryan! I\'m your Receipt & Expense Tracker.\n\n' +
      'What I do:\n' +
      '  Send me a receipt photo or PDF\n' +
      '  → I extract the details (Claude Vision)\n' +
      '  → Log to Google Sheets\n' +
      '  → Save to Google Drive\n\n' +
      'Expense queries:\n' +
      '  "How much this month?"\n' +
      '  "Breakdown by category"\n' +
      '  "Grab expenses"\n\n' +
      'Commands:\n' +
      '  /summary — This month\'s total\n' +
      '  /categories — Spending by category\n' +
      '  /recent — Last 10 receipts\n' +
      '  /help — Show this message\n' +
      '  /health — System status'
    );
  });

  /* /help — same as /start */
  bot.command('help', async (ctx) => {
    logger.info('Bot 2 /help', { chatId: ctx.chat.id });
    await ctx.reply(
      'Receipt & Expense Tracker — Help\n\n' +
      'Send a receipt:\n' +
      '  Photo or PDF → auto-extracted and logged\n' +
      '  Add a caption for extra context\n\n' +
      'Ask about expenses:\n' +
      '  "How much this month?"\n' +
      '  "Total for January"\n' +
      '  "Category breakdown"\n' +
      '  "Grab expenses"\n' +
      '  "Last 5 receipts"\n\n' +
      'Shortcuts:\n' +
      '  /summary — This month\'s expenses\n' +
      '  /categories — Breakdown by category\n' +
      '  /recent — Last 10 receipts'
    );
  });

  /* /summary — quick shortcut for this month's summary */
  bot.command('summary', async (ctx) => {
    logger.info('Bot 2 /summary', { chatId: ctx.chat.id });
    try {
      const result = await handleExpenseQuery('how much this month');
      await ctx.reply(result);
    } catch (err) {
      logger.error('/summary failed', { error: err.message });
      await ctx.reply('Could not load summary. Please try again.');
    }
  });

  /* /categories — quick shortcut for category breakdown */
  bot.command('categories', async (ctx) => {
    logger.info('Bot 2 /categories', { chatId: ctx.chat.id });
    try {
      const result = await handleExpenseQuery('breakdown by category');
      await ctx.reply(result);
    } catch (err) {
      logger.error('/categories failed', { error: err.message });
      await ctx.reply('Could not load categories. Please try again.');
    }
  });

  /* /recent — quick shortcut for recent receipts */
  bot.command('recent', async (ctx) => {
    logger.info('Bot 2 /recent', { chatId: ctx.chat.id });
    try {
      const result = await handleExpenseQuery('last 10 receipts');
      await ctx.reply(result);
    } catch (err) {
      logger.error('/recent failed', { error: err.message });
      await ctx.reply('Could not load recent expenses. Please try again.');
    }
  });

  /* ─── Receipt Processing (Photo/Document) ─── */

  bot.on(['message:photo', 'message:document'], async (ctx) => {
    await handleReceiptMessage(ctx);
  });

  /* ─── Expense Queries (Text) ─── */

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    logger.info('Bot 2 text query', { chatId: ctx.chat.id });

    try {
      const result = await handleExpenseQuery(text);
      await ctx.reply(result);
    } catch (err) {
      logger.error('Expense query failed', { error: err.message });
      await ctx.reply('Something went wrong with that query. Try again or rephrase.');
    }
  });

  /* ─── Delete Receipt Callback ─── */

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    /* Only handle receipt:delete callbacks */
    if (!data.startsWith('receipt:delete:')) {
      await ctx.answerCallbackQuery();
      return;
    }

    /* Parse: receipt:delete:{driveFileId}:{sheetRow} */
    const parts = data.split(':');
    const driveFileId = parts[2];
    const sheetRow = parseInt(parts[3]);

    try {
      await ctx.answerCallbackQuery({ text: 'Deleting...' });

      /* Delete from Google Drive */
      await withGoogleRetry(() =>
        drive.files.delete({ fileId: driveFileId, supportsAllDrives: true })
      );

      /* Delete from Google Sheets */
      await deleteExpenseRow(sheetRow);

      /* Update the message to show it was deleted */
      await ctx.editMessageText('Receipt deleted from Sheets and Drive.');

      logger.info('Receipt deleted', { driveFileId, sheetRow });
    } catch (err) {
      logger.error('Receipt deletion failed', { error: err.message, driveFileId, sheetRow });
      await ctx.editMessageText('Failed to delete receipt. Please remove manually.');
    }
  });

  /* Register Telegram menu commands for Bot 2 */
  bot.api.setMyCommands([
    { command: 'summary', description: 'This month\'s expense summary' },
    { command: 'categories', description: 'Spending breakdown by category' },
    { command: 'recent', description: 'Last 10 receipts' },
    { command: 'help', description: 'How to use this bot' },
    { command: 'health', description: 'System status' },
  ]).catch((err) => logger.warn('setMyCommands failed (Bot 2)', { error: err.message }));
}

/**
 * Full receipt processing pipeline:
 * 1. Download file from Telegram
 * 2. Send to Claude Vision for data extraction
 * 3. Upload original to Google Drive (receipts/YYYY/MM/)
 * 4. Append expense row to Google Sheets
 * 5. Reply with confirmation
 */
async function handleReceiptMessage(ctx) {
  let tempPath = null;

  try {
    await ctx.reply('Receipt received — extracting details...');

    /* ─── Step 1: Get file info from Telegram ─── */
    const { fileId, fileName, mimeType } = extractFileInfo(ctx);

    /* ─── Step 2: Download the file ─── */
    tempPath = await downloadTelegramFile(ctx, fileId, fileName);

    /* ─── Step 3: Extract receipt data via Claude Vision ─── */
    const imageBuffer = fs.readFileSync(tempPath);
    const caption = ctx.message.caption || '';

    /* Map MIME types for Vision API (PDFs supported directly) */
    const visionMediaType = mapMediaType(mimeType);
    const receiptData = await extractReceiptData(imageBuffer, visionMediaType, caption);

    /* ─── Step 3b: Validate — reject non-receipts ─── */
    if (!receiptData.isReceipt) {
      await ctx.reply(
        'This doesn\'t look like a receipt. ' +
        'Please send a photo of a receipt, invoice, or bill.'
      );
      return;
    }

    /* ─── Step 3c: Validate — low confidence → ask to re-upload ─── */
    if (receiptData.confidence < CONFIDENCE_THRESHOLD) {
      await ctx.reply(
        'The receipt is hard to read (too blurry, cut off, or unclear). ' +
        'Please try again with a clearer photo — make sure the full receipt is visible and well-lit.'
      );
      return;
    }

    /* ─── Step 4: Upload to Google Drive ─── */
    const { fileId: driveFileId, webViewLink } = await uploadReceiptToDrive(
      tempPath,
      receiptData.date,
      receiptData.merchant,
      receiptData.amount,
      mimeType
    );

    /* ─── Step 5: Log to Google Sheets ─── */
    const notes = buildNotes(receiptData);
    const loggedBy = getUserDisplayName(ctx);
    const { rowIndex } = await appendExpenseRow({
      date: receiptData.date,
      merchant: receiptData.merchant,
      amount: receiptData.amount,
      currency: receiptData.currency,
      category: receiptData.category,
      driveLink: webViewLink,
      notes,
      loggedBy,
    });

    /* ─── Step 6: Reply with confirmation + Delete button ─── */
    const confirmMsg = formatConfirmation(receiptData, webViewLink);
    const keyboard = new InlineKeyboard()
      .text('Delete', `receipt:delete:${driveFileId}:${rowIndex}`);

    await ctx.reply(confirmMsg, { reply_markup: keyboard });

  } catch (err) {
    logger.error('Receipt processing failed', { error: err.message, stack: err.stack });

    /* Give a helpful error message based on failure type */
    const userMsg = err.message.includes('parse receipt') || err.message.includes('Could not read')
      ? 'Could not read the receipt clearly. Please try a clearer photo.'
      : 'Receipt processing failed. Please try again.';

    await ctx.reply(userMsg);
  } finally {
    /* Clean up temp file */
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
    }
  }
}

/**
 * Extracts file ID, name, and MIME type from a Telegram message.
 * Handles photos (uses largest size) and documents (PDF, etc.).
 */
function extractFileInfo(ctx) {
  if (ctx.message.document) {
    return {
      fileId: ctx.message.document.file_id,
      fileName: ctx.message.document.file_name || 'receipt',
      mimeType: ctx.message.document.mime_type || 'application/octet-stream',
    };
  }

  if (ctx.message.photo && ctx.message.photo.length > 0) {
    /* Telegram sends multiple sizes — use the largest (last in array) */
    const largest = ctx.message.photo[ctx.message.photo.length - 1];
    return {
      fileId: largest.file_id,
      fileName: `receipt_${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
    };
  }

  throw new Error('No file found in message');
}

/**
 * Downloads a file from Telegram servers to a temp directory.
 * Same pattern as Bot 1's file handler — construct URL from getFile().
 */
async function downloadTelegramFile(ctx, fileId, fileName) {
  const file = await ctx.api.getFile(fileId);

  if (!file.file_path) {
    throw new Error('Telegram returned no file_path — file may be too large (>20MB)');
  }

  const botToken = ctx.api.token;
  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

  /* Create temp directory for receipt downloads */
  const tempDir = path.join(os.tmpdir(), 'telegram-bot-receipts');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempPath = path.join(tempDir, `${Date.now()}_${fileName}`);
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tempPath, buffer);

  logger.info('Receipt downloaded from Telegram', { size: buffer.length });
  return tempPath;
}

/**
 * Maps MIME types to Claude Vision's supported media_type values.
 * Falls back to image/jpeg for unknown types.
 */
function mapMediaType(mimeType) {
  const supported = {
    'image/jpeg': 'image/jpeg',
    'image/png': 'image/png',
    'image/webp': 'image/webp',
    'image/gif': 'image/gif',
    'application/pdf': 'application/pdf',
  };
  return supported[mimeType] || 'image/jpeg';
}

/**
 * Builds a notes string from receipt data (items, payment method, tax).
 */
function buildNotes(data) {
  const parts = [];
  if (data.items && data.items.length > 0) {
    parts.push(`Items: ${data.items.join(', ')}`);
  }
  if (data.paymentMethod) {
    parts.push(`Paid: ${data.paymentMethod}`);
  }
  if (data.tax) {
    parts.push(`Tax: ${data.currency || 'MYR'} ${data.tax.toFixed(2)}`);
  }
  if (data.notes) {
    parts.push(data.notes);
  }
  return parts.join(' | ') || '';
}

/**
 * Gets the Telegram user's display name from the context.
 * Uses first_name + last_name, falls back to username.
 */
function getUserDisplayName(ctx) {
  const from = ctx.from;
  if (!from) return 'Unknown';

  if (from.first_name) {
    return from.last_name ? `${from.first_name} ${from.last_name}` : from.first_name;
  }

  return from.username || `User ${from.id}`;
}

/**
 * Formats the confirmation message sent after processing a receipt.
 */
function formatConfirmation(data, driveLink) {
  let msg = `Logged: ${data.currency} ${data.amount.toFixed(2)} at ${data.merchant}`;
  msg += `\nDate: ${data.date}`;
  msg += `\nCategory: ${data.category}`;

  if (data.items && data.items.length > 0) {
    msg += `\nItems: ${data.items.slice(0, 3).join(', ')}`;
    if (data.items.length > 3) msg += '...';
  }

  if (data.tax) {
    msg += `\nTax: ${data.currency} ${data.tax.toFixed(2)}`;
  }

  msg += `\n\nDrive: ${driveLink}`;
  return msg;
}

module.exports = { registerRouter };
