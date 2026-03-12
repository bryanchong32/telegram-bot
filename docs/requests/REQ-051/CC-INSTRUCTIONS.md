# CLAUDE CODE INSTRUCTIONS

## Objective

Build a standalone Telegram bot (new repo) that watches a dedicated order group, parses order confirmations (text + screenshot) using Gemini AI, shows a confirmation card with full SKU/price/PV breakdown, and writes confirmed orders to a Google Sheet.

## Context

This is a **new standalone project** — not part of the existing `mom-crm-webapp` or `telegram-bot` repos.

The bot bridges Telegram → Google Sheets. The existing CRM (`mom-crm-webapp`) reads from this Google Sheet every 30 minutes via its sync service. The bot does not interact with the CRM database at all.

Staff currently post order confirmations in a Telegram group with two components:
1. A screenshot from the FIV5S order app (contains Order ID, phone, order date)
2. A text summary with customer details, products, price, address, etc.

These may come as one message (image + caption) or two separate messages (image then text, or vice versa). The bot must handle both patterns.

## Technical Specification

### Project Structure

```
order-entry-bot/
├── CLAUDE.md              # Project context for Claude Code
├── Dockerfile             # For Coolify deployment
├── package.json
├── src/
│   ├── index.js           # Entry point — bot initialization, message handlers
│   ├── config/
│   │   ├── products.js    # Product catalog (SKU, display name, price, PV)
│   │   ├── promos.js      # Active promo list (manually updated)
│   │   └── sheetColumns.js # Google Sheet column mapping
│   ├── services/
│   │   ├── telegramBot.js # Telegram bot setup and message routing
│   │   ├── aiParser.js    # Gemini text parsing (order fields extraction)
│   │   ├── aiVision.js    # Gemini Vision (screenshot OCR for Order ID)
│   │   ├── sheetWriter.js # Google Sheets API write operations
│   │   └── orderMatcher.js # Links screenshot + text via phone number matching
│   ├── utils/
│   │   ├── phone.js       # Phone normalization (reuse logic from CRM)
│   │   └── formatter.js   # Confirmation card formatting, date formatting
│   └── templates/
│       └── confirmCard.js # Telegram message template for confirmation card
└── .env.example
```

### Message Flow

```
Telegram Group Message
  │
  ├─ Has image? ──► aiVision.js ──► Extract: Order ID, phone, order date
  │                                    │
  │                                    ▼
  │                              orderMatcher.js (store by phone, 5-min TTL)
  │
  ├─ Has text? ──► aiParser.js ──► Extract: name, phone, address, products,
  │                                  price, courier, ad, pain point, promo
  │                                    │
  │                                    ▼
  │                              orderMatcher.js (look up stored screenshot by phone)
  │
  ▼
  Combine screenshot data + text data
  │
  ▼
  Validate: all required fields present?
  ├─ No ──► Ask in group for missing fields
  │           └─ Wait for reply ──► Re-validate
  │
  ├─ Yes ──► Map products to SKU codes (products.js lookup)
  │          Validate promo against active list (promos.js)
  │          Look up price + PV from product catalog
  │
  ▼
  Send confirmation card (inline keyboard: ✅ / ❌)
  │
  ├─ ✅ Confirm ──► sheetWriter.js ──► Append row to Google Sheet
  │                   │
  │                   ├─ Success ──► Bot replies "✅ 已寫入 Google Sheet"
  │                   └─ Failure ──► Bot replies with error, stores for retry
  │
  └─ ❌ Cancel ──► Bot replies "❌ 已取消", discards order
```

### AI Parsing Specification

**Text parsing prompt (Gemini):**
The prompt should instruct Gemini to extract structured JSON from the order text. Expected output format:
```json
{
  "customer_name": "Hung Lam",
  "phone": "93422260",
  "address": "元朗大棠路紅棗田村148号",
  "products": [
    { "quantity": 3, "product_name": "魚油王", "raw_text": "3樽魚油王🌊" }
  ],
  "selling_price": 1600,
  "courier": "SF COD",
  "ad_source": "清貨特價",
  "pain_point": "血壓高，食緊血壓藥",
  "promo_mention": "女神節",
  "source_page": "messenger"
}
```

**Screenshot OCR prompt (Gemini Vision):**
The prompt should instruct Gemini to extract from the FIV5S app screenshot:
```json
{
  "order_id": "4082858",
  "phone": "85293422260",
  "order_date": "2026-03-11"
}
```

### Product Catalog (`config/products.js`)

Static config derived from the CRM's product seed data. Maps Chinese product names to SKU codes with pricing.

```javascript
const PRODUCT_MAP = {
  // Chinese name variations → base product code
  '魚油王': 'HMG',
  'HOMEGA': 'HMG',
  'homega': 'HMG',
  '虎乳芝': 'TMK',
  'Tigrox': 'TMK',
  '靈芝王': 'BLZ',
  'Bio-Lingzhi': 'BLZ',
  '葡萄籽': 'BGS',
  'Bio Grape Seed': 'BGS',
  '男士寳': 'ERJ',
  'Erojan': 'ERJ',
  // Add more variations as discovered
};

const PRODUCTS = {
  '1HMG': { price_hkd: 700, pv: 250, display: 'HOMEGA 1樽' },
  '2HMG': { price_hkd: 1150, pv: 460, display: 'HOMEGA 2樽' },
  '3HMG': { price_hkd: 1650, pv: 630, display: 'HOMEGA 3樽' },
  '4HMG': { price_hkd: 2150, pv: 840, display: 'HOMEGA 4樽' },
  '5HMG': { price_hkd: 2600, pv: 1050, display: 'HOMEGA 5樽' },
  '6HMG': { price_hkd: 3000, pv: 1250, display: 'HOMEGA 6樽' },
  // ... same pattern for TMK, BLZ, BGS, ERJ (all 1-6 bottles)
  // Source: server/seeds/001_products.js in mom-crm-webapp
};
```

The AI parser returns a product name and quantity. The bot:
1. Looks up the product name in `PRODUCT_MAP` → gets base product code (e.g., `HMG`)
2. Combines quantity + base product → SKU code (e.g., `3HMG`)
3. Looks up `3HMG` in `PRODUCTS` → gets price and PV
4. If lookup fails at any step → bot asks staff to clarify the product

### Active Promo Config (`config/promos.js`)

```javascript
// Manually updated by Bryan when promos change (1-2 active at a time)
const ACTIVE_PROMOS = [
  { name: '女神節', tag: '[女神節]' },
  // Add/remove as campaigns change
];
```

AI extracts a `promo_mention` from the text. Bot checks if it matches any entry in `ACTIVE_PROMOS`. If yes, the promo tag is prepended to the SKU in the sheet (e.g., `[女神節]3HMG`). If no match, no tag is applied (the mention is ignored — could be old/invalid promo reference).

### Screenshot + Text Matching (`orderMatcher.js`)

```
pendingScreenshots: Map<phone, { orderId, phone, orderDate, timestamp }>
```

- When a screenshot is processed: store extracted data keyed by phone number, with a 5-minute TTL
- When text is processed: check `pendingScreenshots` for a matching phone. If found, combine and remove from pending. If not found, proceed without screenshot data and ask for it.
- Cleanup: expire entries older than 5 minutes (check on each new message, or use a setInterval)
- Also handle the single-message case (image + caption): both are available immediately, no matching needed

### Google Sheet Write (`sheetWriter.js`)

Uses Google Sheets API v4 `spreadsheets.values.append` to add a new row.

- Auth: Solworks service account (same credentials JSON as CRM uses — `GOOGLE_SHEETS_CREDENTIALS` env var)
- Spreadsheet ID: from env var `GOOGLE_SHEETS_SPREADSHEET_ID`
- Sheet tab: `order_list`
- Append method: `INSERT_ROWS` with `USER_ENTERED` value input option (so the sheet processes data types correctly)

Column mapping must match the sheet's actual header row. Claude Code should inspect the sheet headers (via Sheets API `spreadsheets.values.get` on row 1) during development to confirm the exact column order and names. The CRM's `sheetSyncService.js` references these field names for reading:
- `Region`
- `Customer Name`
- `Contact Number`
- `Order ID (FIV5S app)`
- `Order Date`
- `Product`
- `Selling Price (HKD)`
- `PV`
- `Courier`
- `Tracking Number`
- `Order Status`
- `Address`
- `Pain Point + Remark`
- `Sources (page)`
- `Lead Gen Source (which ad?)`
- `Delivered Date`
- `Commission (MYR)`
- `First/Repeat?`

The bot should write values for the fields it has data for and leave others empty. `Order Status` should be left empty (the CRM sync maps empty → `pending`). `Delivered Date`, `Tracking Number`, `Commission (MYR)`, and `First/Repeat?` are left empty (filled later by staff or CRM).

### Confirmation Card Format (`templates/confirmCard.js`)

Exact format (this is the approved design):

```
📋 新訂單確認 (Order ID: 🆔 {order_id})
📅 {order_date as "11 March 2026"}
🌍 {region}
👤 {customer_name}
📞 {phone}
📍 {address}

📦 產品:
  {for each product: [promo_tag]{sku} ({display_name}) — HK${price} | PV {pv}}
💰 售價: HK${selling_price}
🏷️ 優惠: {promo_tag or "N/A"}
🚚 {courier}

📣 Ad: {ad_source or "N/A"}
💊 Pain Point: {pain_point or "N/A"}
```

Inline keyboard buttons:
- `✅ 確認寫入 Google Sheet` → callback_data: `confirm_{order_uuid}`
- `❌ 取消` → callback_data: `cancel_{order_uuid}`

### Environment Variables

```
# Telegram
TELEGRAM_BOT_TOKEN=         # From @BotFather
TELEGRAM_GROUP_ID=          # Chat ID of the dedicated order group

# Google Sheets
GOOGLE_SHEETS_CREDENTIALS=  # Service account JSON (same as CRM)
GOOGLE_SHEETS_SPREADSHEET_ID=  # Sheet ID (same as CRM)

# AI
GEMINI_API_KEY=             # Gemini API key for text parsing + vision

# App
NODE_ENV=production
```

### Deployment

- Dockerfile in repo root (Node.js slim, same pattern as CRM)
- Deployed via Coolify on the same Hetzner VPS (5.223.49.206)
- Auto-deploy from GitHub `main` branch
- No web server needed — bot is a long-running process (polling or webhook)

## Constraints

- Must use the same Google Sheets service account credentials as the CRM — do not create a new service account
- Product catalog config must match the CRM's product data exactly (prices, PV values from `server/seeds/001_products.js`)
- Phone normalization logic must match the CRM's `normalizePhone()` function (strip non-digits, add 852 prefix for 8-digit numbers)
- Bot must not crash on unexpected message types (stickers, GIFs, forwarded messages, etc.) — silently ignore non-order content
- All Gemini API calls must have error handling — if AI fails, tell the staff, don't crash

## Acceptance Criteria

- AC-1: When staff sends a screenshot + text as one message (image with caption), the bot extracts all fields and shows a confirmation card within 10 seconds
- AC-2: When staff sends screenshot and text as two separate messages, the bot links them by phone number and shows a single confirmation card
- AC-3: The confirmation card shows the correct SKU code, HKD price, and PV for each product (verified against the product catalog)
- AC-4: When staff taps ✅, a new row appears in the Google Sheet with all fields in the correct columns within 5 seconds
- AC-5: When staff taps ❌, the order is discarded and the bot confirms cancellation
- AC-6: If the phone number, customer name, address, product, or Order ID is missing, the bot asks for it in the group before showing the confirmation card
- AC-7: If no screenshot is provided (text only), the bot asks staff to send the FIV5S screenshot
- AC-8: If the AI cannot map a product name to a valid SKU, the bot asks staff to clarify
- AC-9: Promo tags only appear when the extracted promo name matches an entry in the active promos config
- AC-10: The bot ignores non-order messages (stickers, casual chat, etc.) without responding
- AC-11: If the Google Sheet write fails, the bot informs staff in the group with the error
- AC-12: Multi-product orders appear in one cell joined with ` + ` (e.g., `[女神節]3HMG + [女神節]2BGS`)
- AC-13: Date is displayed as "11 March 2026" format on the confirmation card
- AC-14: Courier is normalized to `SF COD`, `SF PL`, or `Other`
- AC-15: Ad and Pain Point fields show `N/A` on the confirmation card when not present in the source text

## Out of Scope

- Do NOT write to the CRM database — only write to Google Sheets
- Do NOT build order edit/amendment functionality
- Do NOT build an admin UI — promo config is a code file
- Do NOT build multi-group or multi-tenant support
- Do NOT build duplicate order detection — the CRM sync handles this
- Do NOT add this to the existing telegram-bot (Rekko) repo — this is a new standalone project

## Deliverables

1. New GitHub repo (`order-entry-bot` or similar) with complete source code
2. Working Telegram bot deployed on Hetzner VPS via Coolify
3. `CLAUDE.md` with project context, tech stack, env vars, and deployment notes
4. `.env.example` with all required environment variables documented
5. `Dockerfile` for Coolify deployment
6. `config/products.js` populated with all 30 core SKUs from the CRM product catalog
7. `config/promos.js` with the current active promo(s) — Bryan to confirm which promo is active