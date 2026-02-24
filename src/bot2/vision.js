/**
 * Receipt extraction module — Google Cloud Vision + Gemini 2.0 Flash.
 *
 * Takes a receipt image/PDF and extracts structured data:
 * merchant, date, amount, currency, category, items, tax, payment method, notes.
 *
 * Two code paths based on file type:
 * - Images (JPEG/PNG/WebP): Cloud Vision OCR → Gemini Flash text structuring
 * - PDFs: Gemini Flash multimodal directly (Cloud Vision doesn't support PDF)
 *
 * Also validates whether the content IS a receipt and returns a confidence score.
 * Non-receipts are rejected. Low-confidence receipts trigger a re-upload request.
 */

const { extractTextFromImage } = require('../utils/ocr');
const { chat, multimodal } = require('../utils/gemini');
const logger = require('../utils/logger');

/* System prompt for receipt extraction from OCR text */
const RECEIPT_TEXT_PROMPT = `You are a receipt data extraction assistant. You will receive OCR text extracted from an image.

STEP 1 — RECEIPT DETECTION:
- Determine if the OCR text looks like a receipt, invoice, bill, or proof of payment.
- If NOT a receipt (random text, screenshots, etc.), set is_receipt to false and leave all other fields null.
- If it IS a receipt, set is_receipt to true and extract the data.

STEP 2 — CONFIDENCE SCORE:
- Rate your confidence in the extraction from 0.0 to 1.0:
  - 0.0–0.3: OCR text is garbled, mostly unreadable, very little useful content
  - 0.3–0.6: Some fields recognizable but key data (amount, merchant) unclear
  - 0.6–0.8: Most fields clear, minor guesswork on 1-2 fields
  - 0.8–1.0: Clean OCR text, all key fields confidently extracted

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

/* System prompt for PDF multimodal extraction (same schema, different intro) */
const RECEIPT_PDF_PROMPT = `You are a receipt data extraction assistant. You will receive a PDF file.

STEP 1 — RECEIPT DETECTION:
- Determine if this PDF is a receipt, invoice, bill, or proof of payment.
- If NOT a receipt, set is_receipt to false and leave all other fields null.
- If it IS a receipt, set is_receipt to true and extract the data.

STEP 2 — CONFIDENCE SCORE:
- Rate your confidence in the extraction from 0.0 to 1.0:
  - 0.0–0.3: PDF is blurry, mostly unreadable
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
 * Extracts receipt data from an image/PDF buffer.
 * Routes to the appropriate pipeline based on media type:
 * - Images → Cloud Vision OCR → Gemini text structuring
 * - PDFs → Gemini multimodal directly
 *
 * @param {Buffer} imageBuffer — raw file bytes (JPEG, PNG, WebP, or PDF)
 * @param {string} mediaType — MIME type of the file
 * @param {string} [captionHint] — optional caption text from the Telegram message
 * @returns {Promise<Object>} — parsed receipt data object with is_receipt and confidence
 */
async function extractReceiptData(imageBuffer, mediaType, captionHint) {
  let response;

  if (mediaType === 'application/pdf') {
    /* PDF path: Gemini multimodal handles PDFs natively */
    let textPrompt = 'Is this a receipt? If yes, extract all receipt data.';
    if (captionHint) {
      textPrompt += ` Additional context from user: "${captionHint}"`;
    }

    response = await multimodal({
      systemInstruction: RECEIPT_PDF_PROMPT,
      imageBuffer,
      mediaType,
      textPrompt,
      maxTokens: 512,
    });
  } else {
    /* Image path: Cloud Vision OCR → Gemini text structuring */
    const ocrText = await extractTextFromImage(imageBuffer);

    if (!ocrText || ocrText.trim().length < 10) {
      /* OCR returned nothing useful — likely not a receipt or very blurry */
      return {
        isReceipt: false,
        confidence: 0,
        merchant: null,
        date: null,
        amount: 0,
        currency: null,
        category: null,
        items: [],
        tax: null,
        paymentMethod: null,
        notes: null,
      };
    }

    let userMessage = `OCR text from receipt image:\n\n${ocrText}`;
    if (captionHint) {
      userMessage += `\n\nAdditional context from user: "${captionHint}"`;
    }

    response = await chat({
      systemInstruction: RECEIPT_TEXT_PROMPT,
      userMessage,
      maxTokens: 512,
    });
  }

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
 * Parses the AI response text into a structured receipt object.
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
