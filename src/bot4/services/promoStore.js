/**
 * Promo Store — manages active promotions for Bot 4.
 * Persists to data/promos.json with atomic writes.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const PROMOS_FILE = path.join(config.DATA_DIR, 'promos.json');

/** @type {{ name: string, added_at: string }[]} */
let promos = [];

function ensureDataDir() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    logger.info('Created data directory', { path: config.DATA_DIR });
  }
}

/**
 * Write JSON atomically — write to .tmp first, then rename.
 * Prevents corruption if the process crashes mid-write.
 */
function saveJsonAtomic(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/** Load promos from disk. If file missing, start with empty array. */
function load() {
  ensureDataDir();
  try {
    if (fs.existsSync(PROMOS_FILE)) {
      const raw = fs.readFileSync(PROMOS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      promos = Array.isArray(parsed.promos) ? parsed.promos : [];
      logger.info('Loaded promos from disk', { count: promos.length });
    } else {
      promos = [];
      logger.info('No promos file found, starting with empty list');
    }
  } catch (err) {
    logger.error('Failed to load promos file, starting with empty list', { error: err.message });
    promos = [];
  }
}

/** Save current promos to disk atomically. */
function save() {
  ensureDataDir();
  saveJsonAtomic(PROMOS_FILE, { promos });
}

/** Return all active promos. */
function getActivePromos() {
  return promos;
}

/**
 * Add a promo by name. Returns true if added, false if duplicate.
 */
function addPromo(name) {
  const normalised = name.trim();
  if (promos.some((p) => p.name === normalised)) {
    logger.warn('Duplicate promo, not adding', { name: normalised });
    return false;
  }
  promos.push({ name: normalised, added_at: new Date().toISOString() });
  save();
  logger.info('Promo added', { name: normalised });
  return true;
}

/**
 * Remove a promo by name. Returns true if removed, false if not found.
 */
function removePromo(name) {
  const normalised = name.trim();
  const idx = promos.findIndex((p) => p.name === normalised);
  if (idx === -1) {
    logger.warn('Promo not found for removal', { name: normalised });
    return false;
  }
  promos.splice(idx, 1);
  save();
  logger.info('Promo removed', { name: normalised });
  return true;
}

/**
 * Check if a name matches any active promo.
 */
function isValidPromo(name) {
  const normalised = name.trim();
  return promos.some((p) => p.name === normalised);
}

module.exports = {
  load,
  save,
  getActivePromos,
  addPromo,
  removePromo,
  isValidPromo,
};
