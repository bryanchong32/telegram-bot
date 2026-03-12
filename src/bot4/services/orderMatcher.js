/**
 * Order Matcher — links screenshot data and text data using normalized phone number.
 * When both pieces arrive within 5 minutes, they are combined into a complete order.
 */

const { normalizePhone } = require('../utils/phone');
const logger = require('../logger');

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/** @type {Map<string, { orderId: string, phone: string, orderDate: string, timestamp: number, chatId: number, userId: number }>} */
const pendingScreenshots = new Map();

/** @type {Map<string, { parsedText: object, timestamp: number, chatId: number, userId: number }>} */
const pendingTexts = new Map();

/**
 * Remove entries older than TTL from both maps.
 */
function cleanup() {
  const now = Date.now();

  for (const [key, entry] of pendingScreenshots) {
    if (now - entry.timestamp > TTL_MS) {
      logger.info('Expired pending screenshot', { phone: key });
      pendingScreenshots.delete(key);
    }
  }

  for (const [key, entry] of pendingTexts) {
    if (now - entry.timestamp > TTL_MS) {
      logger.info('Expired pending text', { phone: key });
      pendingTexts.delete(key);
    }
  }
}

/**
 * Add screenshot data and attempt to match with pending text.
 *
 * @param {{ order_id: string, phone: string, order_date: string }} screenshotData
 * @param {number} chatId
 * @param {number} userId
 * @returns {object|null} Combined order object if matched, null if stored as pending.
 */
function addScreenshot(screenshotData, chatId, userId) {
  cleanup();

  const normalizedPhone = normalizePhone(screenshotData.phone);
  if (!normalizedPhone) {
    logger.warn('Screenshot has no valid phone number', { screenshotData });
    return null;
  }

  // Check for matching pending text
  if (pendingTexts.has(normalizedPhone)) {
    const textEntry = pendingTexts.get(normalizedPhone);
    pendingTexts.delete(normalizedPhone);

    const combined = {
      ...textEntry.parsedText,
      order_id: screenshotData.order_id,
      order_date: screenshotData.order_date,
      phone: normalizedPhone,
      poster_user_id: textEntry.userId,
    };

    logger.info('Matched screenshot with pending text', {
      phone: normalizedPhone,
      order_id: screenshotData.order_id,
    });

    return combined;
  }

  // No match — store as pending
  pendingScreenshots.set(normalizedPhone, {
    orderId: screenshotData.order_id,
    phone: normalizedPhone,
    orderDate: screenshotData.order_date,
    timestamp: Date.now(),
    chatId,
    userId,
  });

  logger.info('Stored pending screenshot', {
    phone: normalizedPhone,
    order_id: screenshotData.order_id,
  });

  return null;
}

/**
 * Add parsed text data and attempt to match with pending screenshot.
 *
 * @param {object} parsedText — parsed order fields from text message
 * @param {number} chatId
 * @param {number} userId
 * @returns {object|null} Combined order object if matched, null if stored as pending.
 */
function addText(parsedText, chatId, userId) {
  cleanup();

  const normalizedPhone = normalizePhone(parsedText.phone);
  if (!normalizedPhone) {
    logger.warn('Text has no valid phone number', { parsedText });
    return null;
  }

  // Check for matching pending screenshot
  if (pendingScreenshots.has(normalizedPhone)) {
    const ssEntry = pendingScreenshots.get(normalizedPhone);
    pendingScreenshots.delete(normalizedPhone);

    const combined = {
      ...parsedText,
      order_id: ssEntry.orderId,
      order_date: ssEntry.orderDate,
      phone: normalizedPhone,
      poster_user_id: userId,
    };

    logger.info('Matched text with pending screenshot', {
      phone: normalizedPhone,
      order_id: ssEntry.orderId,
    });

    return combined;
  }

  // No match — store as pending
  pendingTexts.set(normalizedPhone, {
    parsedText,
    timestamp: Date.now(),
    chatId,
    userId,
  });

  logger.info('Stored pending text', { phone: normalizedPhone });

  return null;
}

module.exports = { addScreenshot, addText, cleanup, pendingScreenshots, pendingTexts };
