/**
 * Date/time helpers.
 * All dates use Asia/Kuala_Lumpur timezone (UTC+8).
 */

const TZ = 'Asia/Kuala_Lumpur';

/** Returns current time as an ISO string in MYT */
function nowMYT() {
  return new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T');
}

/** Returns today's date in YYYY-MM-DD format (MYT) */
function todayMYT() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** Formats a Date object to a readable MYT string, e.g. "24 Feb 2026, 08:00" */
function formatMYT(date) {
  return new Date(date).toLocaleString('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

module.exports = { nowMYT, todayMYT, formatMYT, TZ };
