/**
 * AI Text Parser for Bot 4 (Order Entry).
 * Uses Gemini to extract structured order data from Chinese order confirmation text.
 */

const { chat } = require('../../utils/gemini');
const logger = require('../logger');

const SYSTEM_PROMPT = `You are an order data extraction assistant. You receive Chinese order confirmation text and extract structured data as JSON.

Rules:
- Extract phone as digits only, preserving country code (e.g. 60123456789)
- Courier mapping: 順豐到付 or SF到付 = "SF COD", 順豐寄付 or SF寄付 = "SF PL", anything else = "Other"
- selling_price is the ACTUAL price charged to the customer (number), not the list price
- products array: one entry per distinct product with its quantity
- Use null for any fields that cannot be found in the text
- Return ONLY valid JSON. No markdown code fences, no explanation, no extra text.

Required JSON structure:
{
  "customer_name": "string",
  "phone": "string (digits only, may include country code)",
  "address": "string",
  "products": [{ "quantity": number, "product_name": "string" }],
  "selling_price": number or null,
  "courier": "string or null (SF COD, SF PL, Other)",
  "ad_source": "string or null",
  "pain_point": "string or null",
  "promo_mention": "string or null",
  "source_page": "string or null"
}`;

/**
 * Parse order confirmation text using Gemini AI.
 *
 * @param {string} text — raw order confirmation text (typically Chinese)
 * @returns {Promise<Object|null>} — parsed order object or null on failure
 */
async function parseOrderText(text) {
  try {
    const response = await chat({
      systemInstruction: SYSTEM_PROMPT,
      userMessage: text,
      maxTokens: 1024,
    });

    // Strip markdown code fences if present
    const cleaned = response
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    logger.info('Order text parsed successfully', {
      customer: parsed.customer_name,
      productCount: parsed.products?.length ?? 0,
    });
    return parsed;
  } catch (err) {
    logger.error('Failed to parse order text', { error: err.message });
    return null;
  }
}

module.exports = { parseOrderText };
