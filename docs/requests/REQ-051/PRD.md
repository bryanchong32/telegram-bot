# PRD

## Problem Statement

Sales staff at Minionions Marketing currently double-handle order data. They post order confirmations (screenshot + text summary) in a dedicated Telegram group to report closings, then manually re-enter the same data into a Google Sheet. This manual entry is time-consuming, error-prone, and delays downstream processes — the CRM syncs from Google Sheets every 30 minutes, so any delay in sheet entry delays follow-up task generation and customer tracking.

## Users & Stakeholders

- **Primary users:** Minionions Marketing sales staff (~7 people) who post orders in the Telegram group
- **Secondary users:** Bryan (admin) — monitors orders, manages promos, verifies data accuracy
- **Downstream system:** Solworks CRM (ecomwave.duckdns.org) — reads from Google Sheets via 30-min sync
- **Requested by:** Bryan (Solworks)

## Success Criteria

1. Sales staff can post an order in the Telegram group and have it written to Google Sheets within 30 seconds of confirmation
2. Zero manual Google Sheet data entry required for standard orders
3. SKU mapping is 100% accurate — every confirmed order has the correct SKU code, price, and PV
4. Order ID (from FIV5S screenshot) is captured for every order
5. Staff adoption within 1 week — the bot fits into their existing workflow with minimal behavior change

## Requirements

### Functional Requirements

- FR-1: Bot watches all messages in a dedicated Telegram order group
- FR-2: Bot detects order messages by identifying order-related keywords (確認訂單, 名字, 電話, 產品) or screenshots from the FIV5S app
- FR-3: Bot sends screenshots to Gemini Vision API to extract: FIV5S Order ID (7-digit number), phone number, and order date (system timestamp from the app)
- FR-4: Bot sends order text to Gemini API to extract: customer name, phone, address, product(s) with quantities, selling price, courier type, ad source, pain point, promo name, and source page
- FR-5: Bot links separate screenshot and text messages using phone number matching — when a screenshot is received, the extracted phone is held in memory (5-minute expiry, keyed by phone); when text arrives with a matching phone, they are combined into one order
- FR-6: Bot also handles screenshot + text sent as a single message (image with caption)
- FR-7: Bot translates natural-language Chinese product descriptions to exact SKU codes using the CRM product catalog (e.g., "3樽魚油王" → `3HMG`)
- FR-8: Bot validates promo names against a configurable list of active promos; only validated promos are tagged in the `[promo]SKU` format
- FR-9: Bot replies in the group with a structured confirmation card showing all parsed fields including SKU code, price (HKD), and PV for staff to verify
- FR-10: Confirmation card has inline keyboard buttons: ✅ Confirm (writes to sheet) and ❌ Cancel (discards)
- FR-11: On confirm, bot writes a new row to the Google Sheet with all fields mapped to the correct columns
- FR-12: If required fields are missing (name, phone, address, product, Order ID), bot asks for the missing information in the group and waits for a reply
- FR-13: If Order ID is missing (no screenshot), bot explicitly asks staff to send the FIV5S screenshot — order does not proceed without it
- FR-14: If bot cannot parse a message after a clarification attempt and receives no reply, the order is flagged (bot sends a warning message in the group)
- FR-15: Multi-product orders are formatted in a single cell joined with ` + ` (e.g., `3HMG + 2BGS` or `[女神節]3HMG + [女神節]2BGS`)
- FR-16: Region is derived from phone prefix (852 = HK, 853 = MO), defaulting to HK
- FR-17: Courier is normalized to standard values: `SF COD`, `SF PL`, or `Other`

### Non-Functional Requirements

- NFR-1: Bot response time < 5 seconds for text parsing, < 10 seconds when screenshot OCR is involved
- NFR-2: Google Sheets write must succeed or the bot must inform the staff and retry — no silent data loss
- NFR-3: Gemini API costs should stay under $5/month at expected volume (~10-20 orders/day)
- NFR-4: Bot must handle Telegram API rate limits gracefully (no crashes on rapid messages)
- NFR-5: Bot must run 24/7 with automatic restart on crash (Coolify managed)

## Scope

### In Scope

- Telegram bot that watches a single dedicated order group
- AI-powered parsing of order text (Gemini)
- AI-powered screenshot OCR for Order ID extraction (Gemini Vision)
- Phone-number-based linking of separate screenshot + text messages
- Product name to SKU code translation using product catalog
- Promo validation against a configurable active promo list
- Confirmation card with full breakdown (SKU, price, PV) before writing
- Write confirmed orders to Google Sheets via Sheets API
- Error handling: missing fields, parse failures, sheet write failures
- Deployed on Hetzner VPS via Coolify (same infrastructure as CRM)

### Out of Scope

- Writing directly to CRM database (goes via Sheet → existing sync)
- Order edits or amendments after confirmation (Phase 2)
- Order cancellations
- Voice message parsing
- Multi-group support (single group only)
- Multi-tenant support (Minionions Marketing only for now)
- Admin UI for managing promos (config file is sufficient for 1-2 active promos)
- Two-way sync (Sheet → Telegram notifications)
- Duplicate order detection (the CRM sync handles dedup via FIV5S Order ID)

## UI/UX Notes

The bot's primary UI is the Telegram confirmation card. Final format:

```
📋 新訂單確認 (Order ID: 🆔 4082858)
📅 11 March 2026
🌍 HK
👤 Hung Lam
📞 85293422260
📍 元朗大棠路紅棗田村148号

📦 產品:
  [女神節]3HMG (HOMEGA 3樽) — HK$1,650 | PV 630
💰 售價: HK$1,600
🏷️ 優惠: [女神節]
🚚 SF COD

📣 Ad: 清貨特價
💊 Pain Point: 血壓高，食緊血壓藥

✅ 確認寫入 Google Sheet
❌ 取消
```

Rules:
- Date format: `11 March 2026` (not ISO)
- Promo in brackets: `[女神節]`
- Courier as English codes: `SF COD`, `SF PL`, `Other`
- Ad and Pain Point always shown — display `N/A` if not present in the source text
- Product line shows promo prefix + SKU + display name + price + PV
- For multi-product orders, each product on its own line under 📦

## Technical Notes

- **New standalone repo** — not added to the existing telegram-bot (Rekko) repo
- **Google Sheets API** — uses the same Solworks service account that the CRM uses for reading. Bryan has upgraded it to Editor access on the sheet.
- **Gemini API** — can reuse the Minionions tenant API key from tenant_settings, or use a dedicated key
- **Product catalog** — the bot needs access to SKU codes, display names, prices (HKD), and PV values. Options: read from CRM database directly, or maintain a local config file synced from the product seed data. Local config is simpler for a standalone bot.
- **Sheet column mapping** — the bot must write to the exact columns the CRM sync reads from. Column headers are defined in the Google Sheet's `order_list` tab.

## Open Questions

1. **Sheet column headers** — Claude Code should read the actual Google Sheet headers before building the column mapping. The headers are referenced in `sheetSyncService.js` (field names like `Customer Name`, `Contact Number`, `Order ID (FIV5S app)`, `Product`, etc.) but the exact column order and any extra columns need to be confirmed from the live sheet.
2. **PV column** — does the PV value come from the product catalog (calculated from SKU), or does staff enter it manually? If calculated, the bot can auto-fill it. If manual, the bot should leave it for the CRM sync to handle.
3. **Promo list storage** — simple JSON config file or environment variable? Leaning toward a config file (`config/activePromos.json`) that Bryan can edit.