/**
 * Google Cloud Vision OCR wrapper.
 * Uses the REST API with an API key for receipt text extraction.
 * Preferred over Gemini for image OCR — better at structured text layouts.
 */

const config = require('../shared/config');
const { withGoogleRetry } = require('./google');
const logger = require('./logger');

const VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';

/**
 * Extracts text from an image buffer using Google Cloud Vision OCR.
 * Uses DOCUMENT_TEXT_DETECTION for best results on structured layouts (receipts).
 *
 * @param {Buffer} imageBuffer — raw image bytes (JPEG, PNG, WebP)
 * @returns {Promise<string>} — extracted text from the image
 */
async function extractTextFromImage(imageBuffer) {
  logger.debug('Cloud Vision OCR call');

  const body = {
    requests: [
      {
        image: { content: imageBuffer.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      },
    ],
  };

  const text = await withGoogleRetry(async () => {
    const url = `${VISION_API_URL}?key=${config.GOOGLE_CLOUD_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Cloud Vision API error: ${response.status} ${errBody}`);
    }

    const data = await response.json();
    const annotation = data.responses?.[0]?.fullTextAnnotation;
    return annotation?.text || '';
  });

  logger.info('Cloud Vision OCR result', { textLength: text.length });
  return text;
}

module.exports = { extractTextFromImage };
