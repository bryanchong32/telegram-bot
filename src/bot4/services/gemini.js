/**
 * Gemini wrapper for Bot 4.
 * Uses bot4's own config instead of shared/config.js to avoid
 * requiring Bot 1/2 env vars (TELEGRAM_BOT1_TOKEN, etc.).
 */

const { GoogleGenAI } = require('@google/genai');
const config = require('../config');

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
const MODEL = 'gemini-2.0-flash';

async function chat({ systemInstruction, userMessage, maxTokens = 1024 }) {
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

async function multimodal({ systemInstruction, imageBuffer, mediaType, textPrompt, maxTokens = 1024 }) {
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
