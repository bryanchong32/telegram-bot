/**
 * AI Vision Screenshot OCR for Bot 4 (Order Entry).
 * Uses Gemini Vision to extract order metadata from FIV5S app screenshots.
 */

const { multimodal } = require('../../utils/gemini');
const logger = require('../logger');

const SYSTEM_PROMPT = `You are an OCR extraction assistant. You receive a screenshot from the FIV5S order management app and extract order metadata as JSON.

Rules:
- Order ID is typically a 7-digit number visible in the screenshot
- Phone should include country code, digits only (e.g. 60123456789)
- Convert the date to YYYY-MM-DD format regardless of the original format shown
- Use null for any fields that cannot be found in the screenshot
- Return ONLY valid JSON. No markdown code fences, no explanation, no extra text.

Required JSON structure:
{
  "order_id": "string (7-digit FIV5S order number)",
  "phone": "string (with country code, digits only)",
  "order_date": "string (YYYY-MM-DD format)"
}`;

/**
 * Parse a FIV5S app screenshot using Gemini Vision.
 *
 * @param {Buffer} imageBuffer — image file buffer
 * @param {string} mediaType — MIME type (e.g. "image/jpeg", "image/png")
 * @returns {Promise<Object|null>} — parsed screenshot data or null on failure
 */
async function parseScreenshot(imageBuffer, mediaType) {
  try {
    const response = await multimodal({
      systemInstruction: SYSTEM_PROMPT,
      imageBuffer,
      mediaType,
      textPrompt: 'Extract the order ID, phone number, and order date from this FIV5S screenshot.',
      maxTokens: 512,
    });

    // Strip markdown code fences if present
    const cleaned = response
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    logger.info('Screenshot parsed successfully', {
      orderId: parsed.order_id,
      hasPhone: !!parsed.phone,
      hasDate: !!parsed.order_date,
    });
    return parsed;
  } catch (err) {
    logger.error('Failed to parse screenshot', { error: err.message });
    return null;
  }
}

module.exports = { parseScreenshot };
