# Order Entry Bot (Bot 4) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Telegram bot (Bot 4) that watches an order group, parses order confirmations via Gemini AI, shows confirmation cards, and writes confirmed orders to Google Sheets.

**Architecture:** Bot 4 lives in `src/bot4/` following the Bot 3 pattern — separate folder, separate Dockerfile, separate Coolify container (port 3006). Reuses shared `utils/gemini.js` and `utils/google.js`. Combines REQ-051 (base bot) and REQ-052 (enhancements) into a single build.

**Tech Stack:** grammY, Gemini 2.0 Flash (text + vision), Google Sheets API v4, Express, JSON file persistence

**Design doc:** `docs/plans/2026-03-12-order-entry-bot-design.md`

**Key references:**
- Bot 3 pattern: `src/bot3/` (config, bot, router, index)
- Shared utils: `src/utils/gemini.js` (chat, multimodal), `src/utils/google.js` (sheets, withGoogleRetry)
- CRM product seed: `mom-crm-webapp/server/seeds/001_products.js`
- CRM phone util: `mom-crm-webapp/server/src/utils/phone.js`
- CRM sheet sync: `mom-crm-webapp/server/src/services/sheetSyncService.js`

**Testing note:** This repo has no test framework (Bot 1-3 have none). Manual testing via Telegram in dev mode (long polling). Testable pure functions (product lookup, phone normalization) can be verified inline during development.

---

## Task 1: Scaffolding — Config + Logger

**Files:**
- Create: `src/bot4/config.js`
- Create: `src/bot4/logger.js`

**Step 1: Create `src/bot4/config.js`**

Follow Bot 3's config pattern — minimal, standalone env vars:

```javascript
require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name, fallback) {
  return process.env[name] || fallback;
}

module.exports = {
  // Telegram
  TELEGRAM_BOT4_TOKEN: required('TELEGRAM_BOT4_TOKEN'),
  TELEGRAM_ORDER_GROUP_ID: Number(required('TELEGRAM_ORDER_GROUP_ID')),
  ADMIN_TELEGRAM_USER_ID: Number(required('ADMIN_TELEGRAM_USER_ID')),

  // Google Sheets (reuse CRM service account)
  GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REFRESH_TOKEN: required('GOOGLE_REFRESH_TOKEN'),
  GOOGLE_SHEETS_SPREADSHEET_ID: required('GOOGLE_SHEETS_SPREADSHEET_ID'),

  // AI
  GEMINI_API_KEY: required('GEMINI_API_KEY'),

  // App
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: Number(optional('PORT', '3006')),
  DATA_DIR: optional('DATA_DIR', './data'),
  TZ: optional('TZ', 'Asia/Kuala_Lumpur'),
};
```

**Step 2: Create `src/bot4/logger.js`**

Copy Bot 3's logger pattern (JSON structured logging):

```javascript
const config = require('./config');
const isDev = config.NODE_ENV !== 'production';

function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    bot: 'bot4-order',
    message,
    ...meta,
  };
  const output = isDev ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
```

**Step 3: Commit**

```bash
git add src/bot4/config.js src/bot4/logger.js
git commit -m "feat(bot4): add config and logger scaffolding"
```

---

## Task 2: Product Catalog Config

**Files:**
- Create: `src/bot4/config/products.js`

**Step 1: Create product catalog**

All 30 SKUs from CRM seed data. Two maps: `PRODUCT_NAME_MAP` (Chinese/English variations → base code) and `PRODUCTS` (SKU → price + display).

```javascript
// Chinese/English product name variations → base product code
const PRODUCT_NAME_MAP = {
  // HMG (HOMEGA 魚油王)
  '魚油王': 'HMG',
  '鱼油王': 'HMG',
  'homega': 'HMG',
  'HOMEGA': 'HMG',
  'Homega': 'HMG',
  // TMK (Tigrox 虎乳芝)
  '虎乳芝': 'TMK',
  'tigrox': 'TMK',
  'Tigrox': 'TMK',
  'TIGROX': 'TMK',
  // BLZ (Bio-Lingzhi 靈芝王)
  '靈芝王': 'BLZ',
  '灵芝王': 'BLZ',
  '靈芝': 'BLZ',
  'bio-lingzhi': 'BLZ',
  'Bio-Lingzhi': 'BLZ',
  'BIO靈芝王': 'BLZ',
  // BGS (Bio Grape Seed 葡萄籽)
  '葡萄籽': 'BGS',
  'bio grape seed': 'BGS',
  'Bio Grape Seed': 'BGS',
  'grape seed': 'BGS',
  // ERJ (Erojan 男士寳)
  '男士寳': 'ERJ',
  '男士宝': 'ERJ',
  'erojan': 'ERJ',
  'Erojan': 'ERJ',
  'EROJAN': 'ERJ',
};

// SKU code → pricing and display info
// Source: mom-crm-webapp/server/seeds/001_products.js
const PRODUCTS = {
  '1HMG': { price_hkd: 700, display: 'HOMEGA 1樽' },
  '2HMG': { price_hkd: 1150, display: 'HOMEGA 2樽' },
  '3HMG': { price_hkd: 1650, display: 'HOMEGA 3樽' },
  '4HMG': { price_hkd: 2150, display: 'HOMEGA 4樽' },
  '5HMG': { price_hkd: 2600, display: 'HOMEGA 5樽' },
  '6HMG': { price_hkd: 3000, display: 'HOMEGA 6樽' },

  '1TMK': { price_hkd: 700, display: 'Tigrox 1樽' },
  '2TMK': { price_hkd: 1150, display: 'Tigrox 2樽' },
  '3TMK': { price_hkd: 1650, display: 'Tigrox 3樽' },
  '4TMK': { price_hkd: 2150, display: 'Tigrox 4樽' },
  '5TMK': { price_hkd: 2600, display: 'Tigrox 5樽' },
  '6TMK': { price_hkd: 3000, display: 'Tigrox 6樽' },

  '1BLZ': { price_hkd: 550, display: 'Bio-Lingzhi 1樽' },
  '2BLZ': { price_hkd: 1000, display: 'Bio-Lingzhi 2樽' },
  '3BLZ': { price_hkd: 1400, display: 'Bio-Lingzhi 3樽' },
  '4BLZ': { price_hkd: 1850, display: 'Bio-Lingzhi 4樽' },
  '5BLZ': { price_hkd: 2300, display: 'Bio-Lingzhi 5樽' },
  '6BLZ': { price_hkd: 2700, display: 'Bio-Lingzhi 6樽' },

  '1BGS': { price_hkd: 550, display: 'Bio Grape Seed 1樽' },
  '2BGS': { price_hkd: 1000, display: 'Bio Grape Seed 2樽' },
  '3BGS': { price_hkd: 1400, display: 'Bio Grape Seed 3樽' },
  '4BGS': { price_hkd: 1850, display: 'Bio Grape Seed 4樽' },
  '5BGS': { price_hkd: 2300, display: 'Bio Grape Seed 5樽' },
  '6BGS': { price_hkd: 2700, display: 'Bio Grape Seed 6樽' },

  '1ERJ': { price_hkd: 600, display: 'Erojan 1樽' },
  '2ERJ': { price_hkd: 1050, display: 'Erojan 2樽' },
  '3ERJ': { price_hkd: 1400, display: 'Erojan 3樽' },
  '4ERJ': { price_hkd: 1850, display: 'Erojan 4樽' },
  '5ERJ': { price_hkd: 2300, display: 'Erojan 5樽' },
  '6ERJ': { price_hkd: 2700, display: 'Erojan 6樽' },
};

/**
 * Resolve a product from AI-extracted name + quantity to SKU + pricing.
 * @param {string} productName - Chinese or English product name from AI
 * @param {number} quantity - Number of bottles
 * @returns {{ sku: string, price_hkd: number, display: string } | null}
 */
function resolveProduct(productName, quantity) {
  // Try exact match first
  let baseCode = PRODUCT_NAME_MAP[productName];

  // Try case-insensitive partial match
  if (!baseCode) {
    const lower = productName.toLowerCase();
    for (const [name, code] of Object.entries(PRODUCT_NAME_MAP)) {
      if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) {
        baseCode = code;
        break;
      }
    }
  }

  if (!baseCode) return null;

  const sku = `${quantity}${baseCode}`;
  const product = PRODUCTS[sku];
  if (!product) return null;

  return { sku, price_hkd: product.price_hkd, display: product.display };
}

module.exports = { PRODUCT_NAME_MAP, PRODUCTS, resolveProduct };
```

**Step 2: Commit**

```bash
git add src/bot4/config/products.js
git commit -m "feat(bot4): add product catalog with 30 SKUs"
```

---

## Task 3: Sheet Column Mapping

**Files:**
- Create: `src/bot4/config/sheetColumns.js`

**Step 1: Create sheet column mapping**

Must match the exact column order from the CRM's `sheetSyncService.js`:

```javascript
// Exact column order matching the Google Sheet 'order_list' tab
// Source: mom-crm-webapp/server/src/services/sheetSyncService.js
const SHEET_COLUMNS = [
  'Region',
  'Contact Number',
  'Order ID (FIV5S app)',
  'Customer Name',
  'Address',
  'Pain Point + Remark',
  'Sources (page)',
  'Order Date',
  'Delivered Date',
  'Order Status',
  'Selling Price (HKD)',
  'PV',
  'Commission (MYR)',
  'Courier',
  'Tracking Number',
  'Lead Gen Source (which ad?)',
  'Product',
];

/**
 * Build a row array matching SHEET_COLUMNS order from parsed order data.
 * Columns we don't fill are left as empty string.
 * PV left empty — Google Sheet formula calculates from SKU.
 */
function buildSheetRow(order) {
  return [
    order.region || '',                  // Region
    order.phone || '',                   // Contact Number
    order.order_id || '',                // Order ID (FIV5S app)
    order.customer_name || '',           // Customer Name
    order.address || '',                 // Address
    order.pain_point || '',              // Pain Point + Remark
    order.source_page || '',             // Sources (page)
    order.order_date || '',              // Order Date
    '',                                  // Delivered Date (empty)
    '',                                  // Order Status (empty — CRM maps to 'pending')
    order.selling_price ? String(order.selling_price) : '',  // Selling Price (HKD)
    '',                                  // PV (empty — sheet formula)
    '',                                  // Commission (MYR) (empty)
    order.courier || '',                 // Courier
    '',                                  // Tracking Number (empty)
    order.ad_source || '',               // Lead Gen Source (which ad?)
    order.product_string || '',          // Product
  ];
}

module.exports = { SHEET_COLUMNS, buildSheetRow };
```

**Step 2: Commit**

```bash
git add src/bot4/config/sheetColumns.js
git commit -m "feat(bot4): add sheet column mapping matching CRM sync"
```

---

## Task 4: Phone Normalization Utility

**Files:**
- Create: `src/bot4/utils/phone.js`

**Step 1: Create phone utility**

Port from CRM's `server/src/utils/phone.js` + add region detection:

```javascript
/**
 * Normalize phone number to match CRM's normalizePhone() logic.
 * Strips non-digits, removes leading +, prefixes 852 for 8-digit numbers.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length === 8) {
    cleaned = '852' + cleaned;
  }
  return cleaned;
}

/**
 * Derive region from phone prefix.
 * 852 = HK, 853 = MO, default = HK
 */
function getRegionFromPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return 'HK';
  if (normalized.startsWith('853')) return 'MO';
  return 'HK';
}

module.exports = { normalizePhone, getRegionFromPhone };
```

**Step 2: Commit**

```bash
git add src/bot4/utils/phone.js
git commit -m "feat(bot4): add phone normalization (ported from CRM)"
```

---

## Task 5: Promo Store Service (REQ-052)

**Files:**
- Create: `src/bot4/services/promoStore.js`

**Step 1: Create promo store with disk persistence**

```javascript
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const PROMOS_FILE = path.join(config.DATA_DIR, 'promos.json');

let promos = [];

function ensureDataDir() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
  }
}

function saveJsonAtomic(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function load() {
  ensureDataDir();
  if (fs.existsSync(PROMOS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PROMOS_FILE, 'utf8'));
      promos = data.promos || [];
      logger.info('Promos loaded from disk', { count: promos.length });
    } catch (err) {
      logger.error('Failed to load promos file', { error: err.message });
      promos = [];
    }
  }
}

function save() {
  try {
    ensureDataDir();
    saveJsonAtomic(PROMOS_FILE, { promos });
  } catch (err) {
    logger.error('Failed to save promos file', { error: err.message });
  }
}

function getActivePromos() {
  return promos;
}

function addPromo(name) {
  if (promos.some((p) => p.name === name)) return false;
  promos.push({ name, added_at: new Date().toISOString() });
  save();
  return true;
}

function removePromo(name) {
  const before = promos.length;
  promos = promos.filter((p) => p.name !== name);
  if (promos.length === before) return false;
  save();
  return true;
}

function isValidPromo(name) {
  return promos.some((p) => p.name === name);
}

module.exports = { load, getActivePromos, addPromo, removePromo, isValidPromo };
```

**Step 2: Commit**

```bash
git add src/bot4/services/promoStore.js
git commit -m "feat(bot4): add promo store with disk persistence"
```

---

## Task 6: Pending Order Store (REQ-052)

**Files:**
- Create: `src/bot4/services/pendingOrderStore.js`

**Step 1: Create pending order store with disk persistence**

```javascript
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const PENDING_FILE = path.join(config.DATA_DIR, 'pending-orders.json');
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// In-memory map: order_uuid → order entry
const pendingOrders = new Map();

function ensureDataDir() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
  }
}

function saveJsonAtomic(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function saveToDisk() {
  try {
    ensureDataDir();
    const entries = Array.from(pendingOrders.values());
    saveJsonAtomic(PENDING_FILE, { orders: entries });
  } catch (err) {
    logger.error('Failed to save pending orders', { error: err.message });
  }
}

function loadFromDisk() {
  ensureDataDir();
  if (!fs.existsSync(PENDING_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    const now = Date.now();
    let loaded = 0;
    let expired = 0;
    for (const entry of data.orders || []) {
      const age = now - new Date(entry.created_at).getTime();
      if (age > EXPIRY_MS) {
        expired++;
        continue;
      }
      pendingOrders.set(entry.order_uuid, entry);
      loaded++;
    }
    logger.info('Pending orders loaded', { loaded, expired });
    if (expired > 0) saveToDisk(); // Remove expired entries from file
  } catch (err) {
    logger.error('Failed to load pending orders', { error: err.message });
  }
}

function add(orderUuid, entry) {
  pendingOrders.set(orderUuid, {
    ...entry,
    order_uuid: orderUuid,
    created_at: new Date().toISOString(),
  });
  saveToDisk();
}

function get(orderUuid) {
  const entry = pendingOrders.get(orderUuid);
  if (!entry) return null;
  // Check expiry
  const age = Date.now() - new Date(entry.created_at).getTime();
  if (age > EXPIRY_MS) {
    pendingOrders.delete(orderUuid);
    saveToDisk();
    return null;
  }
  return entry;
}

function remove(orderUuid) {
  pendingOrders.delete(orderUuid);
  saveToDisk();
}

module.exports = { loadFromDisk, add, get, remove };
```

**Step 2: Commit**

```bash
git add src/bot4/services/pendingOrderStore.js
git commit -m "feat(bot4): add pending order store with disk persistence"
```

---

## Task 7: AI Parser — Text Extraction

**Files:**
- Create: `src/bot4/services/aiParser.js`

**Step 1: Create Gemini text parser**

Uses shared `utils/gemini.js` `chat()` function:

```javascript
const { chat } = require('../../utils/gemini');
const logger = require('../logger');

const SYSTEM_PROMPT = `You are an order data extraction assistant for a health supplement company in Hong Kong.

Extract structured data from Chinese order confirmation text. The text is posted by sales staff in a Telegram group.

Return ONLY valid JSON with these fields:
{
  "customer_name": "string — customer's full name",
  "phone": "string — phone number (digits only, may include country code)",
  "address": "string — full delivery address",
  "products": [
    { "quantity": number, "product_name": "string — the product name as written" }
  ],
  "selling_price": number or null — total selling price in HKD,
  "courier": "string — one of: SF COD, SF PL, Other, or null if not mentioned",
  "ad_source": "string or null — which ad/campaign brought the customer",
  "pain_point": "string or null — customer's health concern or reason for buying",
  "promo_mention": "string or null — any promotion/campaign name mentioned (e.g. 女神節, 中秋)",
  "source_page": "string or null — which social media page (e.g. messenger, whatsapp, facebook)"
}

Rules:
- Extract phone number as digits only, preserving country code if present
- For courier: "順豐到付" or "SF到付" = "SF COD", "順豐寄付" or "SF寄付" = "SF PL", anything else = "Other"
- selling_price is the ACTUAL price charged, not the catalog price
- products array should have one entry per distinct product, with quantity
- If a field is not present in the text, set it to null
- Return ONLY the JSON object, no markdown, no explanation`;

/**
 * Parse order text using Gemini to extract structured fields.
 * @param {string} text - Raw order text from Telegram message
 * @returns {Promise<Object|null>} Parsed order fields or null on failure
 */
async function parseOrderText(text) {
  try {
    const response = await chat({
      systemInstruction: SYSTEM_PROMPT,
      userMessage: text,
      maxTokens: 1024,
    });

    // Strip markdown code fences if present
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    logger.info('Order text parsed', { customer: parsed.customer_name, phone: parsed.phone });
    return parsed;
  } catch (err) {
    logger.error('Failed to parse order text', { error: err.message });
    return null;
  }
}

module.exports = { parseOrderText };
```

**Step 2: Commit**

```bash
git add src/bot4/services/aiParser.js
git commit -m "feat(bot4): add Gemini text parser for order extraction"
```

---

## Task 8: AI Vision — Screenshot OCR

**Files:**
- Create: `src/bot4/services/aiVision.js`

**Step 1: Create Gemini Vision screenshot parser**

Uses shared `utils/gemini.js` `multimodal()` function:

```javascript
const { multimodal } = require('../../utils/gemini');
const logger = require('../logger');

const SYSTEM_PROMPT = `You are an OCR assistant extracting data from a FIV5S order app screenshot.

Extract these fields from the screenshot:
{
  "order_id": "string — the 7-digit FIV5S order number",
  "phone": "string — phone number with country code (digits only)",
  "order_date": "string — order date in YYYY-MM-DD format"
}

Rules:
- The order ID is typically a 7-digit number displayed prominently
- Phone number should include country code (e.g. 85293422260)
- Date should be converted to YYYY-MM-DD format regardless of original format
- If a field cannot be found, set it to null
- Return ONLY the JSON object, no markdown, no explanation`;

/**
 * Extract Order ID, phone, and date from a FIV5S app screenshot.
 * @param {Buffer} imageBuffer - Raw image bytes
 * @param {string} mediaType - MIME type (e.g. "image/jpeg")
 * @returns {Promise<Object|null>} Extracted fields or null on failure
 */
async function parseScreenshot(imageBuffer, mediaType) {
  try {
    const response = await multimodal({
      systemInstruction: SYSTEM_PROMPT,
      imageBuffer,
      mediaType,
      maxTokens: 512,
    });

    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    logger.info('Screenshot parsed', { orderId: parsed.order_id, phone: parsed.phone });
    return parsed;
  } catch (err) {
    logger.error('Failed to parse screenshot', { error: err.message });
    return null;
  }
}

module.exports = { parseScreenshot };
```

**Step 2: Commit**

```bash
git add src/bot4/services/aiVision.js
git commit -m "feat(bot4): add Gemini Vision OCR for FIV5S screenshots"
```

---

## Task 9: Order Matcher — Phone-Based Linking

**Files:**
- Create: `src/bot4/services/orderMatcher.js`

**Step 1: Create order matcher**

Links screenshot data and text data using normalized phone number, with 5-minute TTL:

```javascript
const { normalizePhone } = require('../utils/phone');
const logger = require('../logger');

const TTL_MS = 5 * 60 * 1000; // 5 minutes

// Pending screenshot data: normalizedPhone → { orderId, phone, orderDate, timestamp, chatId, userId }
const pendingScreenshots = new Map();
// Pending text data: normalizedPhone → { parsedText, timestamp, chatId, userId }
const pendingTexts = new Map();

function cleanup() {
  const now = Date.now();
  for (const [key, val] of pendingScreenshots) {
    if (now - val.timestamp > TTL_MS) pendingScreenshots.delete(key);
  }
  for (const [key, val] of pendingTexts) {
    if (now - val.timestamp > TTL_MS) pendingTexts.delete(key);
  }
}

/**
 * Store screenshot data and check for matching text.
 * @returns {Object|null} Combined order if match found, null otherwise
 */
function addScreenshot(screenshotData, chatId, userId) {
  cleanup();
  const phone = normalizePhone(screenshotData.phone);
  if (!phone) return null;

  // Check if text is already waiting
  const matchingText = pendingTexts.get(phone);
  if (matchingText) {
    pendingTexts.delete(phone);
    logger.info('Screenshot matched with pending text', { phone });
    return {
      ...matchingText.parsedText,
      order_id: screenshotData.order_id,
      order_date: screenshotData.order_date,
      phone: phone,
      poster_user_id: matchingText.userId,
    };
  }

  // No match — store and wait for text
  pendingScreenshots.set(phone, {
    ...screenshotData,
    timestamp: Date.now(),
    chatId,
    userId,
  });
  return null;
}

/**
 * Store text data and check for matching screenshot.
 * @returns {Object|null} Combined order if match found, null otherwise
 */
function addText(parsedText, chatId, userId) {
  cleanup();
  const phone = normalizePhone(parsedText.phone);
  if (!phone) return null;

  // Check if screenshot is already waiting
  const matchingScreenshot = pendingScreenshots.get(phone);
  if (matchingScreenshot) {
    pendingScreenshots.delete(phone);
    logger.info('Text matched with pending screenshot', { phone });
    return {
      ...parsedText,
      order_id: matchingScreenshot.order_id,
      order_date: matchingScreenshot.order_date,
      phone: phone,
      poster_user_id: userId,
    };
  }

  // No match — store and wait for screenshot
  pendingTexts.set(phone, {
    parsedText,
    timestamp: Date.now(),
    chatId,
    userId,
  });
  return null;
}

module.exports = { addScreenshot, addText };
```

**Step 2: Commit**

```bash
git add src/bot4/services/orderMatcher.js
git commit -m "feat(bot4): add phone-based order matcher with 5-min TTL"
```

---

## Task 10: Sheet Writer

**Files:**
- Create: `src/bot4/services/sheetWriter.js`

**Step 1: Create Google Sheets writer**

Uses shared `utils/google.js` sheets client:

```javascript
const { sheets, withGoogleRetry } = require('../../utils/google');
const config = require('../config');
const { buildSheetRow } = require('../config/sheetColumns');
const logger = require('../logger');

const SHEET_TAB = 'order_list';

/**
 * Append an order row to the Google Sheet.
 * @param {Object} order - Parsed + resolved order data
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function writeOrderToSheet(order) {
  const row = buildSheetRow(order);

  try {
    await withGoogleRetry(async () => {
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.GOOGLE_SHEETS_SPREADSHEET_ID,
        range: `${SHEET_TAB}!A:Q`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row],
        },
      });
    });

    logger.info('Order written to sheet', {
      orderId: order.order_id,
      customer: order.customer_name,
    });
    return true;
  } catch (err) {
    logger.error('Failed to write to sheet', { error: err.message });
    return false;
  }
}

module.exports = { writeOrderToSheet };
```

**Step 2: Commit**

```bash
git add src/bot4/services/sheetWriter.js
git commit -m "feat(bot4): add Google Sheets writer"
```

---

## Task 11: Message Templates

**Files:**
- Create: `src/bot4/templates/confirmCard.js`
- Create: `src/bot4/templates/confirmReply.js`
- Create: `src/bot4/templates/cancelReply.js`

**Step 1: Create confirmation card template (pre-confirm, with inline keyboard)**

```javascript
/**
 * Format the confirmation card shown before staff confirms.
 * Returns { text, reply_markup } for ctx.reply().
 */
function formatConfirmCard(order, orderUuid) {
  const productLines = order.resolved_products
    .map((p) => {
      const promoPrefix = order.promo_tag || '';
      return `  ${promoPrefix}${p.sku} (${p.display}) — HK$${p.price_hkd.toLocaleString()}`;
    })
    .join('\n');

  const text = [
    `📋 新訂單確認 (Order ID: 🆔 ${order.order_id || 'N/A'})`,
    `📅 ${formatDate(order.order_date)}`,
    `🌍 ${order.region}`,
    `👤 ${order.customer_name}`,
    `📞 ${order.phone}`,
    `📍 ${order.address}`,
    '',
    `📦 產品:`,
    productLines,
    `💰 售價: HK$${order.selling_price ? order.selling_price.toLocaleString() : 'N/A'}`,
    `🏷️ 優惠: ${order.promo_tag || 'N/A'}`,
    `🚚 ${order.courier || 'N/A'}`,
    '',
    `📣 Ad: ${order.ad_source || 'N/A'}`,
    `💊 Pain Point: ${order.pain_point || 'N/A'}`,
  ].join('\n');

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '✅ 確認寫入 Google Sheet', callback_data: `confirm_${orderUuid}` },
        { text: '❌ 取消', callback_data: `cancel_${orderUuid}` },
      ],
    ],
  };

  return { text, reply_markup };
}

/**
 * Format date as "11 March 2026"
 */
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const d = new Date(dateStr + 'T00:00:00+08:00');
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

module.exports = { formatConfirmCard, formatDate };
```

**Step 2: Create confirm reply template (REQ-052)**

```javascript
const { formatDate } = require('./confirmCard');

/**
 * Format the post-confirmation reply message.
 */
function formatConfirmReply(order, confirmerName, timestamp) {
  const productLines = order.resolved_products
    .map((p) => {
      const promoPrefix = order.promo_tag || '';
      return `${promoPrefix}${p.sku} (${p.display}) — HK$${p.price_hkd.toLocaleString()}`;
    })
    .join('\n  ');

  return [
    '✅ 已寫入 Google Sheet',
    '',
    `📋 訂單 (Order ID: 🆔 ${order.order_id || 'N/A'})`,
    `📅 ${formatDate(order.order_date)}`,
    `🌍 ${order.region}`,
    `👤 ${order.customer_name}`,
    `📞 ${order.phone}`,
    `📍 ${order.address}`,
    '',
    `📦 ${productLines}`,
    `💰 HK$${order.selling_price ? order.selling_price.toLocaleString() : 'N/A'} | 🚚 ${order.courier || 'N/A'}`,
    '',
    `📣 Ad: ${order.ad_source || 'N/A'}`,
    `💊 Pain Point: ${order.pain_point || 'N/A'}`,
    '',
    `確認人: ${confirmerName}`,
    `確認時間: ${formatTimestamp(timestamp)}`,
  ].join('\n');
}

/**
 * Format timestamp as "11 March 2026, 10:15 PM"
 */
function formatTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const { formatDate: fmtDate } = require('./confirmCard');
  const dateStr = fmtDate(d.toISOString().split('T')[0]);
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${dateStr}, ${h12}:${minutes} ${ampm}`;
}

module.exports = { formatConfirmReply };
```

**Step 3: Create cancel reply template (REQ-052)**

```javascript
const { formatTimestamp } = require('./confirmReply');

/**
 * Format the post-cancellation reply message.
 */
function formatCancelReply(order, cancellerName, timestamp) {
  return [
    '❌ 已取消',
    '',
    `📋 訂單 (Order ID: 🆔 ${order.order_id || 'N/A'})`,
    `👤 ${order.customer_name} — HK$${order.selling_price ? order.selling_price.toLocaleString() : 'N/A'}`,
    '',
    `取消人: ${cancellerName}`,
    `取消時間: ${formatTimestamp(timestamp)}`,
  ].join('\n');
}

module.exports = { formatCancelReply };
```

**Step 4: Commit**

```bash
git add src/bot4/templates/
git commit -m "feat(bot4): add confirmation card and reply templates"
```

---

## Task 12: Order Handler — Main Processing Logic

**Files:**
- Create: `src/bot4/handlers/order.js`

**Step 1: Create order handler**

This is the core logic: receives parsed data, resolves products, validates, shows confirmation card.

```javascript
const crypto = require('crypto');
const { resolveProduct } = require('../config/products');
const { normalizePhone, getRegionFromPhone } = require('../utils/phone');
const { formatConfirmCard } = require('../templates/confirmCard');
const { isValidPromo } = require('../services/promoStore');
const pendingOrderStore = require('../services/pendingOrderStore');
const logger = require('../logger');

/**
 * Process a combined order (screenshot + text data merged).
 * Resolves products, validates fields, shows confirmation card.
 * @param {Object} ctx - grammY context
 * @param {Object} rawOrder - Merged order data from matcher
 */
async function processOrder(ctx, rawOrder) {
  const phone = normalizePhone(rawOrder.phone);
  const region = getRegionFromPhone(rawOrder.phone);

  // Resolve products to SKUs
  const resolvedProducts = [];
  const failedProducts = [];

  for (const p of rawOrder.products || []) {
    const resolved = resolveProduct(p.product_name, p.quantity);
    if (resolved) {
      resolvedProducts.push(resolved);
    } else {
      failedProducts.push(p);
    }
  }

  // If any product failed to resolve, ask staff
  if (failedProducts.length > 0) {
    const names = failedProducts.map((p) => `${p.quantity}x ${p.product_name}`).join(', ');
    await ctx.reply(`⚠️ 無法識別以下產品: ${names}\n請重新輸入正確的產品名稱和數量。`);
    return;
  }

  if (resolvedProducts.length === 0) {
    await ctx.reply('⚠️ 未找到任何產品資料，請重新輸入。');
    return;
  }

  // Check required fields
  const missing = [];
  if (!rawOrder.customer_name) missing.push('姓名 (name)');
  if (!phone) missing.push('電話 (phone)');
  if (!rawOrder.address) missing.push('地址 (address)');
  if (!rawOrder.order_id) missing.push('訂單號碼 (Order ID) — 請發送 FIV5S 截圖');

  if (missing.length > 0) {
    await ctx.reply(`⚠️ 缺少以下資料:\n${missing.map((m) => `• ${m}`).join('\n')}\n\n請補充以上資料。`);
    return;
  }

  // Validate promo
  const promoTag = rawOrder.promo_mention && isValidPromo(rawOrder.promo_mention)
    ? `[${rawOrder.promo_mention}]`
    : null;

  // Normalize courier
  const courier = normalizeCourier(rawOrder.courier);

  // Build product string for sheet (e.g. "[女神節]3HMG + [女神節]2BGS")
  const productString = resolvedProducts
    .map((p) => `${promoTag || ''}${p.sku}`)
    .join(' + ');

  // Build complete order object
  const order = {
    order_id: rawOrder.order_id,
    order_date: rawOrder.order_date,
    region,
    customer_name: rawOrder.customer_name,
    phone,
    address: rawOrder.address,
    resolved_products: resolvedProducts,
    selling_price: rawOrder.selling_price,
    courier,
    ad_source: rawOrder.ad_source,
    pain_point: rawOrder.pain_point,
    source_page: rawOrder.source_page,
    promo_tag: promoTag,
    product_string: productString,
    poster_user_id: rawOrder.poster_user_id,
  };

  // Generate UUID for this order
  const orderUuid = crypto.randomUUID();

  // Send confirmation card
  const { text, reply_markup } = formatConfirmCard(order, orderUuid);
  const sentMsg = await ctx.reply(text, { reply_markup });

  // Persist pending order (REQ-052)
  pendingOrderStore.add(orderUuid, {
    order_data: order,
    poster_telegram_user_id: rawOrder.poster_user_id,
    chat_id: ctx.chat.id,
    confirmation_message_id: sentMsg.message_id,
  });

  logger.info('Confirmation card sent', { orderUuid, orderId: order.order_id });
}

function normalizeCourier(courier) {
  if (!courier) return 'Other';
  const lower = courier.toLowerCase();
  if (lower.includes('到付') || lower.includes('cod')) return 'SF COD';
  if (lower.includes('寄付') || lower.includes('pl') || lower.includes('prepaid')) return 'SF PL';
  if (lower.includes('sf') || lower.includes('順豐')) {
    if (lower.includes('到付') || lower.includes('cod')) return 'SF COD';
    if (lower.includes('寄付')) return 'SF PL';
    return 'SF COD'; // Default SF to COD
  }
  return 'Other';
}

module.exports = { processOrder };
```

**Step 2: Commit**

```bash
git add src/bot4/handlers/order.js
git commit -m "feat(bot4): add order processing handler with product resolution"
```

---

## Task 13: Callback Handler — Confirm/Cancel (REQ-052)

**Files:**
- Create: `src/bot4/handlers/callback.js`

**Step 1: Create callback handler with poster-only restriction**

```javascript
const pendingOrderStore = require('../services/pendingOrderStore');
const { writeOrderToSheet } = require('../services/sheetWriter');
const { formatConfirmReply } = require('../templates/confirmReply');
const { formatCancelReply } = require('../templates/cancelReply');
const logger = require('../logger');

/**
 * Handle ✅/❌ button taps on confirmation cards.
 */
async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data;
  if (!data) return;

  const isConfirm = data.startsWith('confirm_');
  const isCancel = data.startsWith('cancel_');
  if (!isConfirm && !isCancel) return;

  const orderUuid = data.replace(/^(confirm|cancel)_/, '');
  const pending = pendingOrderStore.get(orderUuid);

  if (!pending) {
    await ctx.answerCallbackQuery({ text: '訂單已過期', show_alert: true });
    return;
  }

  // Poster-only check (REQ-052 FR-3)
  const tapperId = ctx.callbackQuery.from.id;
  if (tapperId !== pending.poster_telegram_user_id) {
    await ctx.answerCallbackQuery({ text: '只有發送人可以確認', show_alert: true });
    return;
  }

  const tapperName = ctx.callbackQuery.from.username
    ? `@${ctx.callbackQuery.from.username}`
    : ctx.callbackQuery.from.first_name;
  const now = new Date();
  const order = pending.order_data;

  if (isConfirm) {
    // Write to Google Sheet
    const success = await writeOrderToSheet(order);
    if (!success) {
      await ctx.answerCallbackQuery({ text: '寫入失敗，請重試', show_alert: true });
      return;
    }

    // Send confirm reply (REQ-052 FR-1)
    const replyText = formatConfirmReply(order, tapperName, now);
    await ctx.reply(replyText, {
      reply_to_message_id: pending.confirmation_message_id,
    });

    logger.info('Order confirmed', { orderUuid, confirmer: tapperName });
  }

  if (isCancel) {
    // Send cancel reply (REQ-052 FR-2)
    const replyText = formatCancelReply(order, tapperName, now);
    await ctx.reply(replyText, {
      reply_to_message_id: pending.confirmation_message_id,
    });

    logger.info('Order cancelled', { orderUuid, canceller: tapperName });
  }

  // Remove inline keyboard from original card
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch (err) {
    logger.warn('Could not remove keyboard', { error: err.message });
  }

  // Remove from pending store
  pendingOrderStore.remove(orderUuid);
  await ctx.answerCallbackQuery();
}

module.exports = { handleCallback };
```

**Step 2: Commit**

```bash
git add src/bot4/handlers/callback.js
git commit -m "feat(bot4): add callback handler with poster-only restriction"
```

---

## Task 14: Promo Command Handler (REQ-052)

**Files:**
- Create: `src/bot4/handlers/promo.js`

**Step 1: Create /promo command handler**

```javascript
const config = require('../config');
const promoStore = require('../services/promoStore');
const logger = require('../logger');

/**
 * Handle /promo commands (admin-only).
 * Subcommands: list, add {name}, remove {name}
 */
async function handlePromoCommand(ctx) {
  // Admin check (REQ-052 FR-7)
  if (ctx.from.id !== config.ADMIN_TELEGRAM_USER_ID) {
    await ctx.reply('⚠️ 無權限');
    return;
  }

  const text = ctx.message.text || '';
  const parts = text.split(/\s+/);
  // parts[0] = "/promo", parts[1] = subcommand, parts[2+] = args
  const subcommand = (parts[1] || '').toLowerCase();
  const promoName = parts.slice(2).join(' ').trim();

  switch (subcommand) {
    case 'list': {
      const promos = promoStore.getActivePromos();
      if (promos.length === 0) {
        await ctx.reply('🏷️ 目前沒有優惠');
      } else {
        const lines = promos.map((p, i) => `  ${i + 1}. [${p.name}]`);
        await ctx.reply(`🏷️ 目前優惠:\n${lines.join('\n')}`);
      }
      break;
    }

    case 'add': {
      if (!promoName) {
        await ctx.reply('⚠️ 用法: /promo add {名稱}');
        return;
      }
      const added = promoStore.addPromo(promoName);
      if (added) {
        await ctx.reply(`✅ 已新增優惠: [${promoName}]`);
        logger.info('Promo added', { name: promoName });
      } else {
        await ctx.reply(`⚠️ 優惠 [${promoName}] 已存在`);
      }
      break;
    }

    case 'remove': {
      if (!promoName) {
        await ctx.reply('⚠️ 用法: /promo remove {名稱}');
        return;
      }
      const removed = promoStore.removePromo(promoName);
      if (removed) {
        await ctx.reply(`✅ 已移除優惠: [${promoName}]`);
        logger.info('Promo removed', { name: promoName });
      } else {
        await ctx.reply(`⚠️ 找不到優惠: [${promoName}]`);
      }
      break;
    }

    default:
      await ctx.reply('⚠️ 用法: /promo list | /promo add {名稱} | /promo remove {名稱}');
  }
}

module.exports = { handlePromoCommand };
```

**Step 2: Commit**

```bash
git add src/bot4/handlers/promo.js
git commit -m "feat(bot4): add /promo command handler (admin-only)"
```

---

## Task 15: Bot Instance + Router

**Files:**
- Create: `src/bot4/bot.js`
- Create: `src/bot4/router.js`

**Step 1: Create bot instance**

```javascript
const { Bot } = require('grammy');
const config = require('./config');
const logger = require('./logger');
const { registerRouter } = require('./router');

const bot4 = new Bot(config.TELEGRAM_BOT4_TOKEN);

// Group-only middleware — only respond in the configured order group
bot4.use((ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId !== config.TELEGRAM_ORDER_GROUP_ID) {
    logger.warn('Message from unauthorized chat', { chatId });
    return; // Silently ignore
  }
  return next();
});

// Register all handlers
registerRouter(bot4);

// Set bot commands menu
bot4.api.setMyCommands([
  { command: 'start', description: '啟動 Order Bot' },
  { command: 'help', description: '使用說明' },
  { command: 'promo', description: '管理優惠 (admin only)' },
  { command: 'health', description: 'Bot 健康狀態' },
]).catch((err) => logger.warn('Failed to set commands', { error: err.message }));

// Global error handler
bot4.catch((err) => {
  logger.error('Unhandled bot error', { error: err.message, stack: err.stack });
  try {
    err.ctx?.reply('⚠️ 系統錯誤，請稍後再試。').catch(() => {});
  } catch (_) {}
});

module.exports = { bot4 };
```

**Step 2: Create router**

```javascript
const config = require('./config');
const logger = require('./logger');
const { parseOrderText } = require('./services/aiParser');
const { parseScreenshot } = require('./services/aiVision');
const { addScreenshot, addText } = require('./services/orderMatcher');
const { processOrder } = require('./handlers/order');
const { handleCallback } = require('./handlers/callback');
const { handlePromoCommand } = require('./handlers/promo');
const { normalizePhone } = require('./utils/phone');

// Order detection keywords
const ORDER_KEYWORDS = ['確認訂單', '名字', '姓名', '電話', '產品', '地址', '訂單'];

function hasOrderKeywords(text) {
  if (!text) return false;
  return ORDER_KEYWORDS.some((kw) => text.includes(kw));
}

// Message dedup (Telegram retries webhooks)
const processedMessages = new Map();
const DEDUP_TTL = 5 * 60 * 1000;

function isDuplicate(messageId) {
  const now = Date.now();
  // Cleanup old entries
  for (const [id, ts] of processedMessages) {
    if (now - ts > DEDUP_TTL) processedMessages.delete(id);
  }
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, now);
  return false;
}

function registerRouter(bot) {
  // Commands
  bot.command('start', (ctx) => ctx.reply('👋 Order Entry Bot 已啟動。\n發送訂單截圖 + 文字即可自動寫入 Google Sheet。'));
  bot.command('help', (ctx) => ctx.reply(
    '📖 使用說明:\n\n'
    + '1. 發送 FIV5S 截圖 + 訂單文字\n'
    + '2. Bot 會顯示確認卡\n'
    + '3. 點擊 ✅ 寫入 Google Sheet\n\n'
    + '管理員指令:\n'
    + '/promo list — 查看優惠\n'
    + '/promo add {名稱} — 新增優惠\n'
    + '/promo remove {名稱} — 移除優惠'
  ));
  bot.command('health', (ctx) => ctx.reply(`✅ Bot 4 (Order Entry) is running.\nUptime: ${Math.floor(process.uptime())}s`));
  bot.command('promo', handlePromoCommand);

  // Callback queries (✅/❌ buttons)
  bot.on('callback_query:data', handleCallback);

  // Photo messages (with or without caption)
  bot.on('message:photo', async (ctx) => {
    if (isDuplicate(ctx.message.message_id)) return;

    try {
      // Download the largest photo
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT4_TOKEN}/${file.file_path}`;
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());
      const mediaType = file.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg';

      // Parse screenshot via Gemini Vision
      const screenshotData = await parseScreenshot(buffer, mediaType);
      if (!screenshotData) {
        await ctx.reply('⚠️ 無法識別截圖，請確認是 FIV5S 訂單截圖。');
        return;
      }

      const caption = ctx.message.caption;

      // Case 1: Photo + caption (single message with both)
      if (caption && hasOrderKeywords(caption)) {
        const textData = await parseOrderText(caption);
        if (textData) {
          const combined = {
            ...textData,
            order_id: screenshotData.order_id,
            order_date: screenshotData.order_date,
            phone: normalizePhone(screenshotData.phone || textData.phone),
            poster_user_id: ctx.from.id,
          };
          await processOrder(ctx, combined);
          return;
        }
      }

      // Case 2: Photo only — store and wait for text
      const matched = addScreenshot(screenshotData, ctx.chat.id, ctx.from.id);
      if (matched) {
        await processOrder(ctx, matched);
      } else {
        await ctx.reply('📸 截圖已收到，等待訂單文字...');
      }
    } catch (err) {
      logger.error('Error processing photo', { error: err.message });
      await ctx.reply('⚠️ 處理截圖時發生錯誤，請重試。');
    }
  });

  // Text messages
  bot.on('message:text', async (ctx) => {
    if (isDuplicate(ctx.message.message_id)) return;

    const text = ctx.message.text;

    // Skip if no order keywords (ignore casual messages)
    if (!hasOrderKeywords(text)) return;

    try {
      const textData = await parseOrderText(text);
      if (!textData) {
        await ctx.reply('⚠️ 無法解析訂單內容，請確認格式。');
        return;
      }

      // Try to match with pending screenshot
      const matched = addText(textData, ctx.chat.id, ctx.from.id);
      if (matched) {
        await processOrder(ctx, matched);
      } else {
        // No screenshot yet — ask for it (FR-13)
        await ctx.reply('📝 訂單文字已收到。\n⚠️ 請發送 FIV5S 截圖以獲取訂單號碼。');
      }
    } catch (err) {
      logger.error('Error processing text', { error: err.message });
      await ctx.reply('⚠️ 處理訂單時發生錯誤，請重試。');
    }
  });
}

module.exports = { registerRouter };
```

**Step 3: Commit**

```bash
git add src/bot4/bot.js src/bot4/router.js
git commit -m "feat(bot4): add bot instance and message router"
```

---

## Task 16: Entry Point + Dockerfile

**Files:**
- Create: `src/bot4/index.js`
- Create: `Dockerfile.order-bot`
- Update: `.env.example`

**Step 1: Create entry point**

Follow Bot 3 pattern (Express + webhook/polling):

```javascript
const express = require('express');
const { webhookCallback } = require('grammy');
const config = require('./config');
const { bot4 } = require('./bot');
const logger = require('./logger');
const promoStore = require('./services/promoStore');
const pendingOrderStore = require('./services/pendingOrderStore');

async function main() {
  // Load persisted data from disk (REQ-052)
  promoStore.load();
  pendingOrderStore.loadFromDisk();

  const app = express();
  app.use(express.json());

  // Health endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'bot4-order', uptime: Math.floor(process.uptime()) });
  });
  app.get('/', (req, res) => {
    res.send('Bot 4 (Order Entry) is running.');
  });

  // Production: webhook
  if (config.NODE_ENV === 'production') {
    app.post('/webhook/order-bot', webhookCallback(bot4, 'express'));
    logger.info('Webhook mode', { path: '/webhook/order-bot' });
  } else {
    // Development: long polling
    await bot4.api.deleteWebhook({ drop_pending_updates: true });
    bot4.start({
      onStart: () => logger.info('Bot 4 (Order Entry) started in polling mode'),
    });
  }

  const server = app.listen(config.PORT, () => {
    logger.info('Server started', { port: config.PORT, env: config.NODE_ENV });
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info('Shutdown signal received', { signal });
    await bot4.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { error: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

main().catch((err) => {
  logger.error('Failed to start', { error: err.message });
  process.exit(1);
});
```

**Step 2: Create Dockerfile**

```dockerfile
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3006
CMD ["node", "src/bot4/index.js"]
```

**Step 3: Update `.env.example`**

Add Bot 4 env vars section at the end:

```
# Bot 4 — Order Entry Bot
TELEGRAM_BOT4_TOKEN=
TELEGRAM_ORDER_GROUP_ID=
ADMIN_TELEGRAM_USER_ID=
GOOGLE_SHEETS_SPREADSHEET_ID=
```

**Step 4: Commit**

```bash
git add src/bot4/index.js Dockerfile.order-bot .env.example
git commit -m "feat(bot4): add entry point, Dockerfile, and env example"
```

---

## Task 17: Local Dev Testing

**Files:** None (testing existing code)

**Step 1: Create `.env` with Bot 4 vars for local dev**

Add to the existing `.env` file (DO NOT commit):
```
TELEGRAM_BOT4_TOKEN=8785888948:AAE4pAgzhnuS_2159OHpUxVUOA9--qlqKbw
TELEGRAM_ORDER_GROUP_ID=-1003814814093
ADMIN_TELEGRAM_USER_ID=873921891
GOOGLE_SHEETS_SPREADSHEET_ID=<get from Bryan or CRM .env>
```

**Step 2: Start Bot 4 in dev mode**

```bash
cd c:\Users\user\Desktop\telegram-bot
node src/bot4/index.js
```

**Step 3: Test each flow in Telegram**

1. Send `/start` in the order group → expect welcome message
2. Send `/help` → expect usage instructions
3. Send `/health` → expect status
4. Send `/promo list` → expect empty list
5. Send `/promo add 女神節` → expect confirmation
6. Send `/promo list` → expect `[女神節]`
7. Send a test order text with keywords → expect "waiting for screenshot"
8. Send a test FIV5S screenshot → expect screenshot received, then confirmation card
9. Tap ✅ → expect sheet write + confirm reply
10. Test ❌ on a new order → expect cancel reply
11. Have someone else tap ✅ → expect "只有發送人可以確認" toast

**Step 4: Verify Google Sheet**

Check `order_list` tab — confirmed order should appear as a new row with correct column mapping.

---

## Task 18: Documentation Updates

**Files:**
- Update: `CLAUDE.md` — add Bot 4 section
- Update: `ARCHITECTURE.md` — add Bot 4 to architecture diagram
- Update: `DEPLOY.md` — add Coolify setup for Bot 4

**Step 1: Update CLAUDE.md**

Add Bot 4 section under Architecture Summary:
- Bot 4 (Order Entry) in `src/bot4/`, port 3006
- Separate Coolify container via `Dockerfile.order-bot`
- Watches Telegram order group, parses via Gemini, writes to Google Sheet
- JSON persistence in `data/` (promos + pending orders)
- Volume mount required in Coolify for `/app/data`

**Step 2: Update ARCHITECTURE.md**

Add Bot 4 to the system diagram and file structure.

**Step 3: Update DEPLOY.md**

Add Coolify setup instructions:
- New service pointing to `Dockerfile.order-bot`
- Port 3006
- Nginx rule: `/webhook/order-bot` → localhost:3006
- Volume mount: `/app/data`
- Required env vars

**Step 4: Commit**

```bash
git add CLAUDE.md ARCHITECTURE.md DEPLOY.md
git commit -m "docs: add Bot 4 (Order Entry) to project documentation"
```

---

## Summary

| Task | Description | Est. Files |
|------|-------------|------------|
| 1 | Config + Logger | 2 |
| 2 | Product Catalog | 1 |
| 3 | Sheet Column Mapping | 1 |
| 4 | Phone Normalization | 1 |
| 5 | Promo Store (REQ-052) | 1 |
| 6 | Pending Order Store (REQ-052) | 1 |
| 7 | AI Text Parser | 1 |
| 8 | AI Vision OCR | 1 |
| 9 | Order Matcher | 1 |
| 10 | Sheet Writer | 1 |
| 11 | Templates (3 files) | 3 |
| 12 | Order Handler | 1 |
| 13 | Callback Handler (REQ-052) | 1 |
| 14 | Promo Command (REQ-052) | 1 |
| 15 | Bot Instance + Router | 2 |
| 16 | Entry Point + Dockerfile | 3 |
| 17 | Local Dev Testing | 0 |
| 18 | Documentation | 3 |
| **Total** | | **~25 files** |
