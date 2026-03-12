/**
 * Pending Order Store — holds orders awaiting confirmation for Bot 4.
 * Persists to data/pending-orders.json with atomic writes.
 * Entries expire after 1 hour.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const PENDING_FILE = path.join(config.DATA_DIR, 'pending-orders.json');
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/** @type {Map<string, object>} */
const orders = new Map();

function ensureDataDir() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    logger.info('Created data directory', { path: config.DATA_DIR });
  }
}

/**
 * Write JSON atomically — write to .tmp first, then rename.
 */
function saveJsonAtomic(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Load pending orders from disk. Discards entries older than 1 hour.
 */
function loadFromDisk() {
  ensureDataDir();
  try {
    if (fs.existsSync(PENDING_FILE)) {
      const raw = fs.readFileSync(PENDING_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed.orders) ? parsed.orders : [];
      const now = Date.now();
      let discarded = 0;

      for (const entry of entries) {
        const age = now - new Date(entry.created_at).getTime();
        if (age < EXPIRY_MS) {
          orders.set(entry.order_uuid, entry);
        } else {
          discarded++;
        }
      }

      logger.info('Loaded pending orders from disk', {
        loaded: orders.size,
        discarded,
      });
    } else {
      logger.info('No pending orders file found, starting empty');
    }
  } catch (err) {
    logger.error('Failed to load pending orders file', { error: err.message });
  }
}

/** Save current Map to disk atomically. */
function saveToDisk() {
  ensureDataDir();
  const entries = Array.from(orders.values());
  saveJsonAtomic(PENDING_FILE, { orders: entries });
}

/**
 * Add a pending order. Stamps created_at and saves to disk.
 */
function add(orderUuid, entry) {
  const record = {
    ...entry,
    order_uuid: orderUuid,
    created_at: new Date().toISOString(),
  };
  orders.set(orderUuid, record);
  saveToDisk();
  logger.info('Pending order added', { order_uuid: orderUuid });
}

/**
 * Get a pending order by UUID. Returns null if not found or expired.
 */
function get(orderUuid) {
  const entry = orders.get(orderUuid);
  if (!entry) return null;

  const age = Date.now() - new Date(entry.created_at).getTime();
  if (age >= EXPIRY_MS) {
    orders.delete(orderUuid);
    saveToDisk();
    logger.info('Pending order expired on access', { order_uuid: orderUuid });
    return null;
  }

  return entry;
}

/**
 * Remove a pending order by UUID. Saves to disk.
 */
function remove(orderUuid) {
  const existed = orders.delete(orderUuid);
  if (existed) {
    saveToDisk();
    logger.info('Pending order removed', { order_uuid: orderUuid });
  }
}

module.exports = {
  loadFromDisk,
  saveToDisk,
  add,
  get,
  remove,
};
