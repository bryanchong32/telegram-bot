/**
 * Phone number normalization for HK/Macau customers.
 * Ported from CRM's server/src/utils/phone.js with added region detection.
 */

/**
 * Normalize a phone number string.
 * - Strips all non-digit characters (except leading +)
 * - Removes leading + (stored without it)
 * - If 8 digits with no country code, assumes HK (852)
 *
 * @param {string} phone
 * @returns {string|null}
 */
function normalizePhone(phone) {
  if (!phone) return null;

  // Strip non-digit characters
  let cleaned = phone.replace(/[^0-9+]/g, '');

  // Remove leading + if present
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // If 8 digits with no country code, assume HK (852)
  if (cleaned.length === 8) {
    cleaned = '852' + cleaned;
  }

  return cleaned;
}

/**
 * Determine region from a normalized phone number.
 * 853 prefix = Macau (MO), everything else = Hong Kong (HK).
 *
 * @param {string} phone — normalized phone (digits only, with country code)
 * @returns {'MO'|'HK'}
 */
function getRegionFromPhone(phone) {
  if (!phone) return 'HK';
  const normalized = normalizePhone(phone);
  if (normalized && normalized.startsWith('853')) return 'MO';
  return 'HK';
}

module.exports = { normalizePhone, getRegionFromPhone };
