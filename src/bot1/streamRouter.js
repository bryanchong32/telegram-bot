/**
 * Stream Router — maps keywords in text to business streams.
 *
 * Shared module used by both Todos and Notes modules.
 * Returns { stream, confidence } — caller decides fallback behavior:
 *   - Todos: default to "Personal" on low confidence
 *   - Notes: leave stream blank on low confidence
 */

const logger = require('../utils/logger');

/**
 * Keyword → stream mapping.
 * Each stream has an array of lowercase keywords to match against.
 * More specific keywords first to reduce false positives.
 */
const STREAM_KEYWORDS = {
  Minionions: ['minionions', 'svo', 'supplement', 'wellous', 'ecomwave', 'ads', 'dashboard', 'inventory'],
  KLN: ['kln', 'consultant', 'client', 'report', 'north'],
  Overdrive: ['overdrive', 'od', 'event', 'pickleball', 'freelance'],
  Property: ['solasta', 'renovation', 'contractor', 'rental', 'property', 'lease', 'tenant', 'vp'],
};

/**
 * Infers the stream from message text using keyword matching.
 *
 * @param {string} text — the user's message or task title
 * @returns {{ stream: string|null, confidence: 'high'|'low' }}
 */
function inferStream(text) {
  if (!text) {
    return { stream: null, confidence: 'low' };
  }

  const lower = text.toLowerCase();

  /* Count keyword matches per stream */
  const scores = {};
  for (const [stream, keywords] of Object.entries(STREAM_KEYWORDS)) {
    const matchCount = keywords.filter((kw) => lower.includes(kw)).length;
    if (matchCount > 0) {
      scores[stream] = matchCount;
    }
  }

  /* No matches — low confidence, no stream */
  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return { stream: null, confidence: 'low' };
  }

  /* Sort by match count descending */
  entries.sort((a, b) => b[1] - a[1]);

  const [bestStream, bestScore] = entries[0];

  /* If there's a tie between two streams, confidence is low */
  if (entries.length > 1 && entries[1][1] === bestScore) {
    logger.debug('Stream router tie', { streams: entries.map((e) => e[0]) });
    return { stream: bestStream, confidence: 'low' };
  }

  return { stream: bestStream, confidence: 'high' };
}

module.exports = { inferStream, STREAM_KEYWORDS };
