# Order Entry Bot (Bot 4) — Design Document

**Date:** 2026-03-12
**REQs:** REQ-051 (base bot) + REQ-052 (enhancements)
**Status:** Approved by Bryan

---

## Problem

Sales staff double-handle order data — they post order confirmations (screenshot + text) in a Telegram group, then manually re-enter the same data into Google Sheets. The CRM syncs from this sheet every 30 minutes, so manual entry delays downstream processes.

## Solution

A Telegram bot (Bot 4) that watches the dedicated order group, parses order confirmations using Gemini AI, shows a confirmation card for staff to verify, and writes confirmed orders directly to Google Sheets.

## Architecture Decisions

1. **Option B: Add to existing `telegram-bot` repo** (not a standalone repo) — reuses shared utils (Gemini, Google APIs, phone normalization), follows Bot 3 pattern with separate Dockerfile and Coolify container
2. **Bot → Google Sheets** (not CRM directly) — the sheet is the master record others reference, CRM sync picks up rows as usual
3. **Access control via group chat ID** — no individual user whitelist needed, group membership = authorization
4. **Conservative order detection** — trigger on photo OR text with order keywords (確認訂單/名字/電話/產品/地址), no Gemini call for non-order messages. Group is order-only (casual chat in separate WhatsApp).
5. **PV column left empty** — Google Sheet formula calculates PV from SKU. Bot does not auto-fill PV.
6. **Dynamic promo management** — `/promo add|remove|list` commands via Telegram, persisted to JSON file on disk. Replaces static config file.
7. **JSON file persistence** — pending orders and promos stored in `data/` directory with atomic writes. No database needed at this volume (~20 orders/day).

## Shortcoming Note

The current product catalog has flat pricing — no promo-specific variants. `6HMG` and `[女神節]6HMG` have the same price/PV. Future enhancement: support promo packages with distinct PV values so the bot (and CRM) can differentiate promo vs standard pricing.

## File Structure

```
src/bot4/
├── index.js              # Entry point — bot init, startup recovery
├── bot.js                # grammY bot instance + middleware
├── router.js             # Message routing (group check → photo/text detection)
├── handlers/
│   ├── order.js          # Order processing (combine, validate, show card)
│   ├── callback.js       # ✅/❌ handlers (poster check, reply msg, keyboard removal)
│   └── promo.js          # /promo command handler (admin-only)
├── services/
│   ├── aiParser.js       # Gemini text parsing
│   ├── aiVision.js       # Gemini Vision screenshot OCR
│   ├── sheetWriter.js    # Google Sheets append
│   ├── orderMatcher.js   # Phone-based screenshot↔text linking (5-min TTL)
│   ├── promoStore.js     # Promo CRUD + disk persistence (data/promos.json)
│   └── pendingOrderStore.js  # Pending order persistence (data/pending-orders.json)
├── config/
│   ├── products.js       # 30 SKUs with price, display name, Chinese name map
│   └── sheetColumns.js   # Column mapping matching CRM sync expectations
└── templates/
    ├── confirmCard.js    # Pre-confirmation card (inline keyboard)
    ├── confirmReply.js   # Post-confirmation reply (with confirmer + timestamp)
    └── cancelReply.js    # Post-cancellation reply
```

## Message Flow

```
Group message arrives
  │
  ├─ Has photo? → Gemini Vision OCR → Extract: Order ID, phone, order date
  │                                     → Store in pendingScreenshots (5-min TTL, keyed by phone)
  │                                     → Check if matching text already waiting → combine
  │
  ├─ Has text with order keywords?
  │   → Gemini text parse → Extract: name, phone, address, products, price, courier, ad, pain point, promo
  │   → Check pendingScreenshots for matching phone → combine
  │
  ├─ Has photo + caption? → Both paths run, combine immediately
  │
  └─ None of the above? → Silently ignore

  After combining:
  → Validate required fields (name, phone, address, product, Order ID)
  → Map products to SKU codes via product catalog
  → Validate promo against active promo list (promoStore)
  → Send confirmation card (inline keyboard: ✅/❌)
  → Save to pending-orders.json
```

## Confirmation Flow (REQ-052)

```
Staff taps ✅ Confirm
  │
  ├─ Is this the original poster? (check poster_telegram_user_id)
  │   ├─ No → toast: "只有發送人可以確認", do nothing
  │   └─ Yes ↓
  │
  ├─ Write to Google Sheet
  │   ├─ Fail → reply with error message
  │   └─ Success ↓
  │
  ├─ Send confirm reply message (order summary + confirmer + timestamp)
  ├─ Remove inline keyboard from original card
  └─ Remove from pending-orders.json
```

## Sheet Column Mapping

**Bot fills:** Region, Customer Name, Contact Number, Order ID (FIV5S app), Order Date, Product, Selling Price (HKD), Courier, Address, Pain Point + Remark, Sources (page), Lead Gen Source (which ad?)

**Left empty:** PV (sheet formula), Order Status, Tracking Number, Delivered Date, Commission (MYR), First/Repeat?

## Product Catalog

30 SKUs: 5 product families (HMG, TMK, BLZ, BGS, ERJ) × 6 bundle sizes (1-6 bottles). Prices and display names sourced from CRM seed data (`server/seeds/001_products.js`).

## Deployment

- Coolify container on **port 3006**
- Dockerfile: `Dockerfile.order-bot` in repo root
- Nginx: `/webhook/order-bot` → localhost:3006
- Volume mount: `/app/data` for JSON persistence files
- Auto-deploy from `main` branch

## Environment Variables

```
TELEGRAM_BOT4_TOKEN=          # Order bot token from @BotFather
TELEGRAM_ORDER_GROUP_ID=      # Chat ID of the order group
ADMIN_TELEGRAM_USER_ID=       # Bryan's Telegram ID (for /promo commands)
GOOGLE_SHEETS_SPREADSHEET_ID= # Same sheet as CRM
GEMINI_API_KEY=               # Can reuse existing key
DATA_DIR=./data               # Persistence directory
NODE_ENV=production
PORT=3006
```
