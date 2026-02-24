/**
 * Gemini 2.0 Flash API wrapper.
 * Replaces Anthropic Claude for all text classification and generation tasks.
 * All Gemini API calls should go through this module.
 */

const { GoogleGenAI } = require('@google/genai');
const config = require('../shared/config');
const logger = require('./logger');

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

const MODEL = 'gemini-2.0-flash';

/**
 * Sends a message to Gemini and returns the text response.
 *
 * @param {Object} options
 * @param {string} options.systemInstruction — system prompt
 * @param {string} options.userMessage — user message content
 * @param {number} options.maxTokens — max response tokens (default 1024)
 * @returns {Promise<string>} — Gemini's text response
 */
async function chat({ systemInstruction, userMessage, maxTokens = 1024 }) {
  logger.debug('Gemini API call', { model: MODEL });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userMessage,
    config: {
      systemInstruction,
      maxOutputTokens: maxTokens,
    },
  });

  return response.text;
}

/**
 * Sends an image/PDF to Gemini for multimodal analysis.
 * Used by Bot 2 for PDF receipt extraction (Cloud Vision doesn't support PDF).
 *
 * @param {Object} options
 * @param {string} options.systemInstruction — system prompt
 * @param {Buffer} options.imageBuffer — raw file bytes
 * @param {string} options.mediaType — MIME type (image/jpeg, image/png, application/pdf, etc.)
 * @param {string} [options.textPrompt] — optional text alongside the image
 * @param {number} options.maxTokens — max response tokens (default 1024)
 * @returns {Promise<string>} — Gemini's text response
 */
async function multimodal({ systemInstruction, imageBuffer, mediaType, textPrompt, maxTokens = 1024 }) {
  logger.debug('Gemini multimodal API call', { model: MODEL, mediaType });

  const parts = [
    {
      inlineData: {
        mimeType: mediaType,
        data: imageBuffer.toString('base64'),
      },
    },
  ];

  if (textPrompt) {
    parts.push({ text: textPrompt });
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction,
      maxOutputTokens: maxTokens,
    },
  });

  return response.text;
}

module.exports = { chat, multimodal };
