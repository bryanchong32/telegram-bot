/**
 * Claude Vision receipt extraction module.
 *
 * Takes a receipt image/PDF and extracts structured data:
 * merchant, date, amount, currency, category, items, tax, payment method, notes.
 *
 * Also validates whether the image IS a receipt and returns a confidence score.
 * Non-receipts are rejected. Low-confidence receipts trigger a re-upload request.
 *
 * Uses Haiku for cost efficiency — receipt extraction is structured,
 * not complex reasoning. Falls back gracefully on parse errors.
 */

const { vision } = require('../utils/anthropic');
const logger = require('../utils/logger');

/* System prompt for receipt extraction — includes is_receipt and confidence */
const RECEIPT_SYSTEM_PROMPT = `You are a receipt data extraction assistant. Your job is to determine if an image is a receipt, and if so, extract structured data from it.

STEP 1 — RECEIPT DETECTION:
- First, determine if this image is actually a receipt, invoice, bill, or proof of payment.
- If the image is NOT a receipt (e.g. a random photo, screenshot, meme, selfie, object, etc.), set is_receipt to false and leave all other fields null.
- If it IS a receipt, set is_receipt to true and extract the data.

STEP 2 — CONFIDENCE SCORE:
- Rate your confidence in the extraction from 0.0 to 1.0:
  - 0.0–0.3: Image is blurry, cut off, or mostly unreadable
  - 0.3–0.6: Some fields readable but key data (amount, merchant) unclear
  - 0.6–0.8: Most fields readable, minor guesswork on 1-2 fields
  - 0.8–1.0: Clear receipt, all key fields confidently extracted

STEP 3 — DATA EXTRACTION (only if is_receipt is true):
- Return ONLY valid JSON — no markdown, no code fences, no extra text
- If a field is not visible or unclear, use null
- Dates must be in YYYY-MM-DD format
- Amount must be a number (no currency symbols), e.g. 45.50 not "RM45.50"
- Currency: default to "MYR" unless another currency is clearly shown
- Category must be one of: Food & Dining, Transport, Groceries, Shopping, Entertainment, Healthcare, Utilities, Client Entertainment, Office Supplies, Travel, Subscriptions, Other
- For Malaysian receipts: SST is the tax, look for "SST" or "Service Tax" lines
- Items: list up to 5 main items (keep it brief)

JSON schema:
{
  "is_receipt": true,
  "confidence": 0.85,
  "merchant": "store/restaurant name",
  "date": "YYYY-MM-DD",
  "amount": 45.50,
  "currency": "MYR",
  "category": "Food & Dining",
  "items": ["item 1", "item 2"],
  "tax": 2.70,
  "payment_method": "Cash/Card/E-wallet/null",
  "notes": "any extra context worth noting, or null"
}

NOT a receipt example:
{
  "is_receipt": false,
  "confidence": 0.0,
  "merchant": null, "date": null, "amount": null, "currency": null,
  "category": null, "items": null, "tax": null, "payment_method": null, "notes": null
}`;

/* Confidence threshold — below this we ask for re-upload */
const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Extracts receipt data from an image buffer using Claude Vision.
 * Returns an object with is_receipt, confidence, and extracted fields.
 *
 * @param {Buffer} imageBuffer — raw image bytes (JPEG, PNG, WebP, or PDF)
 * @param {string} mediaType — MIME type of the image
 * @param {string} [captionHint] — optional caption text from the Telegram message
 * @returns {Promise<Object>} — parsed receipt data object with is_receipt and confidence
 */
async function extractReceiptData(imageBuffer, mediaType, captionHint) {
  /* Build text prompt with optional caption context */
  let textPrompt = 'Is this a receipt? If yes, extract all receipt data from this image.';
  if (captionHint) {
    textPrompt += ` Additional context from user: "${captionHint}"`;
  }

  /* Call Claude Vision — using Haiku for cost efficiency */
  const response = await vision({
    system: RECEIPT_SYSTEM_PROMPT,
    imageBuffer,
    mediaType,
    textPrompt,
    model: 'haiku',
    maxTokens: 512,
  });

  /* Parse the JSON response */
  const data = parseVisionResponse(response);

  logger.info('Vision result', {
    isReceipt: data.isReceipt,
    confidence: data.confidence,
    merchant: data.merchant,
    amount: data.amount,
  });

  return data;
}

/**
 * Parses Claude's response text into a structured receipt object.
 * Handles code fences, whitespace, and provides defaults for missing fields.
 */
function parseVisionResponse(responseText) {
  let cleaned = responseText.trim();

  /* Strip markdown code fences if present */
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    logger.error('Vision response parse failed', { response: cleaned.substring(0, 200) });
    throw new Error('Could not parse receipt data from image. Please try a clearer photo.');
  }

  /* Normalize and validate fields */
  return {
    isReceipt: parsed.is_receipt === true,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    merchant: parsed.merchant || 'Unknown',
    date: normalizeDate(parsed.date),
    amount: typeof parsed.amount === 'number' ? parsed.amount : parseFloat(parsed.amount) || 0,
    currency: parsed.currency || 'MYR',
    category: parsed.category || 'Other',
    items: Array.isArray(parsed.items) ? parsed.items : [],
    tax: typeof parsed.tax === 'number' ? parsed.tax : parseFloat(parsed.tax) || null,
    paymentMethod: parsed.payment_method || null,
    notes: parsed.notes || null,
  };
}

/**
 * Normalizes a date string to YYYY-MM-DD format.
 * Falls back to today's date if parsing fails.
 */
function normalizeDate(dateStr) {
  if (!dateStr) return todayFormatted();

  /* Already in YYYY-MM-DD format */
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  /* Try parsing common formats */
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });
  }

  return todayFormatted();
}

/** Returns today's date in YYYY-MM-DD format (MYT) */
function todayFormatted() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });
}

module.exports = { extractReceiptData, CONFIDENCE_THRESHOLD };
