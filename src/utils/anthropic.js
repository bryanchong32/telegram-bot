/**
 * Anthropic (Claude) API wrapper.
 * Routes to Haiku for cheap classification tasks and Sonnet for complex ones.
 * All Claude API calls should go through this module.
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../shared/config');
const logger = require('./logger');

/* Initialise the Anthropic client */
const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

/* Model IDs — use Haiku for simple tasks, Sonnet for complex ones */
const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250514',
};

/**
 * Sends a message to Claude and returns the text response.
 *
 * @param {Object} options
 * @param {string} options.system — system prompt
 * @param {string} options.userMessage — user message content
 * @param {'haiku'|'sonnet'} options.model — which model tier to use
 * @param {number} options.maxTokens — max response tokens (default 1024)
 * @returns {Promise<string>} — Claude's text response
 */
async function chat({ system, userMessage, model = 'haiku', maxTokens = 1024 }) {
  logger.debug('Claude API call', { model: MODELS[model] });

  const response = await anthropic.messages.create({
    model: MODELS[model],
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  /* Extract the text content from the response */
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return text;
}

/**
 * Sends an image to Claude Vision and returns the text response.
 * Used by Bot 2 for receipt data extraction.
 *
 * @param {Object} options
 * @param {string} options.system — system prompt
 * @param {Buffer} options.imageBuffer — raw image bytes
 * @param {string} options.mediaType — MIME type (image/jpeg, image/png, image/webp, application/pdf)
 * @param {string} [options.textPrompt] — optional text alongside the image
 * @param {'haiku'|'sonnet'} options.model — which model tier to use
 * @param {number} options.maxTokens — max response tokens (default 1024)
 * @returns {Promise<string>} — Claude's text response
 */
async function vision({ system, imageBuffer, mediaType, textPrompt, model = 'sonnet', maxTokens = 1024 }) {
  logger.debug('Claude Vision API call', { model: MODELS[model], mediaType });

  /* Build the content array: image block + optional text block */
  const content = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: imageBuffer.toString('base64'),
      },
    },
  ];

  if (textPrompt) {
    content.push({ type: 'text', text: textPrompt });
  }

  const response = await anthropic.messages.create({
    model: MODELS[model],
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  });

  /* Extract the text content from the response */
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return text;
}

module.exports = { anthropic, chat, vision, MODELS };
