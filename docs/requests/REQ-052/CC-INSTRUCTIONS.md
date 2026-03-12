# CLAUDE CODE INSTRUCTIONS

## Objective

Enhance the Order Entry Bot (REQ-051) with four features: post-confirmation reply messages, poster-only confirm restriction, promo management via bot commands, and disk persistence for pending orders and promos.

## Context

This builds on top of the REQ-051 base implementation. The base bot already handles: message detection → AI parsing → confirmation card → sheet write. This REQ modifies the confirmation callback flow, adds Telegram command handlers, and adds a file-based persistence layer.

Assume the REQ-051 codebase exists with at minimum: a Telegram bot instance, a confirmation card with inline keyboard, a callback handler for ✅/❌, and a promo config file.

## Technical Specification

### 1. Post-Confirmation Reply Messages

**On ✅ Confirm (after successful sheet write):**

Send a new message replying to the original confirmation card (`reply_to_message_id`). Content:

```
✅ 已寫入 Google Sheet

📋 訂單 (Order ID: 🆔 {order_id})
📅 {order_date}
🌍 {region}
👤 {customer_name}
📞 {phone}
📍 {address}

📦 {product_lines}
💰 HK${selling_price} | 🚚 {courier}

📣 Ad: {ad_source or "N/A"}
💊 Pain Point: {pain_point or "N/A"}

確認人: @{confirmer_username or confirmer_first_name}
確認時間: {timestamp as "11 March 2026, 10:15 PM"}
```

After sending the reply, edit the original confirmation card to remove the inline keyboard (prevents double-tapping). Use `editMessageReplyMarkup` with an empty reply markup.

**On ❌ Cancel:**

Send a shorter reply:

```
❌ 已取消

📋 訂單 (Order ID: 🆔 {order_id})
👤 {customer_name} — HK${selling_price}

取消人: @{canceller_username or canceller_first_name}
取消時間: {timestamp}
```

Also remove the inline keyboard from the original card.

### 2. Poster-Only Confirm Restriction

Each pending order must store the `poster_telegram_user_id` — the Telegram user ID of the person whose message triggered the order parsing.

In the callback query handler:
- Extract `callback_query.from.id`
- Compare against the stored `poster_telegram_user_id` for this order
- If they don't match: call `answerCallbackQuery` with `text: "只有發送人可以確認"` and `show_alert: true` — then return (do nothing)
- If they match: proceed with confirm/cancel flow

For the case where screenshot and text come from different messages: the poster is the person who sent the **text** message (since that's the substantive order content).

### 3. Promo Management Commands

Add command handlers for `/promo`. Parse the subcommand from the message text.

**`/promo list`** — responds with all active promos:
```
🏷️ 目前優惠:
  1. [女神節]
  2. [中秋]
```
If empty: `🏷️ 目前沒有優惠`

**`/promo add {name}`** — adds to the list, saves to disk:
```
✅ 已新增優惠: [{name}]
```
If already exists: `⚠️ 優惠 [{name}] 已存在`

**`/promo remove {name}`** — removes from the list, saves to disk:
```
✅ 已移除優惠: [{name}]
```
If not found: `⚠️ 找不到優惠: [{name}]`

**Permission check:** Before processing any `/promo` command, check `message.from.id` against `ADMIN_TELEGRAM_USER_ID` env var (parsed as integer). If no match, reply: `⚠️ 無權限`

**Storage:** Active promos stored in `data/promos.json`:
```json
{
  "promos": [
    { "name": "女神節", "added_at": "2026-03-12T14:30:00Z" }
  ]
}
```

On startup, load from this file. If the file doesn't exist, create it with an empty array.

The AI parser's promo validation should read from this in-memory list (loaded from disk) instead of a hardcoded config. Replace the static `config/promos.js` with a `services/promoStore.js` that manages the list and exposes `getActivePromos()`, `addPromo(name)`, `removePromo(name)`.

### 4. Pending Order Persistence

**On parse complete (before showing confirmation card):**
Save the pending order to `data/pending-orders.json`. Each entry includes:
```json
{
  "order_uuid": "uuid-v4",
  "poster_telegram_user_id": 123456789,
  "chat_id": -100...,
  "confirmation_message_id": 12345,
  "order_data": { ...all parsed fields... },
  "created_at": "2026-03-12T14:30:00Z"
}
```

**On confirm or cancel:**
Remove the entry from `data/pending-orders.json`.

**On bot startup:**
Load pending orders from disk. For each:
- If older than 1 hour → discard (expired)
- If still valid → restore into the in-memory pending orders map so callbacks still work

Note: the original Telegram inline keyboard buttons reference an `order_uuid` in the callback data. As long as the bot restores the pending order keyed by this UUID, the buttons in the group chat will still work when tapped — even after a restart.

**Atomic writes:** When writing JSON files, write to a `.tmp` file first, then rename to the final path. This prevents corruption if the bot crashes mid-write.

```javascript
const fs = require('fs');
const path = require('path');

function saveJsonAtomic(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}
```

### 5. Data Directory Setup

Create `data/` directory on startup if it doesn't exist:
```javascript
const DATA_DIR = process.env.DATA_DIR || './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
```

**Dockerfile** must create the directory and declare it as a volume:
```dockerfile
RUN mkdir -p /app/data
VOLUME /app/data
```

**Coolify note:** The `data/` volume must be configured in Coolify so it persists across container rebuilds. Document this in CLAUDE.md.

### Environment Variables (new)

```
ADMIN_TELEGRAM_USER_ID=     # Bryan's Telegram user ID (integer) — for /promo commands
DATA_DIR=./data             # Directory for JSON persistence files (default: ./data)
```

Add these to `.env.example`.

## Constraints

- Do not change the confirmation card format (defined in REQ-051) — only add the post-confirmation reply and keyboard removal
- Promo store must be backward-compatible: if `data/promos.json` doesn't exist, fall back to whatever static config REQ-051 shipped with (then migrate to the file on first `/promo add`)
- Pending order persistence must not slow down the happy path — writes happen after the confirmation card is sent, not before
- JSON files should be pretty-printed (`JSON.stringify(data, null, 2)`) for easy debugging via SSH

## Acceptance Criteria

- AC-1: After tapping ✅, a reply message appears showing the confirmed order summary with confirmer name and timestamp
- AC-2: After tapping ✅ or ❌, the inline keyboard buttons are removed from the original confirmation card
- AC-3: After tapping ❌, a short cancellation reply appears with canceller name and timestamp
- AC-4: When a user who did NOT post the order taps ✅ or ❌, they see a popup toast "只有發送人可以確認" and nothing happens
- AC-5: `/promo add 女神節` adds the promo and confirms in chat
- AC-6: `/promo remove 女神節` removes the promo and confirms in chat
- AC-7: `/promo list` shows all active promos with bracket formatting
- AC-8: A non-admin user running `/promo add` gets "無權限"
- AC-9: After adding a promo via command, the next order that mentions that promo name gets the `[promo]` tag in the SKU
- AC-10: After restarting the bot, active promos are still present (loaded from disk)
- AC-11: After restarting the bot, pending orders less than 1 hour old can still be confirmed via their buttons in the group chat
- AC-12: Pending orders older than 1 hour are discarded on startup and their buttons become non-functional (bot responds "訂單已過期")

## Out of Scope

- Do NOT build `/stats` or daily summary commands (separate future REQ)
- Do NOT build order edit/amendment
- Do NOT use a database — JSON files only
- Do NOT support multiple admin user IDs (single ID is sufficient)

## Deliverables

1. Updated confirmation callback handler with reply messages and keyboard removal
2. Poster-only restriction on ✅/❌ buttons
3. `/promo` command handlers with permission check
4. `services/promoStore.js` — promo list management with disk persistence
5. `services/pendingOrderStore.js` — pending order persistence with disk read/write
6. Updated `.env.example` with new env vars
7. Updated `CLAUDE.md` with Coolify volume configuration notes
8. Updated `Dockerfile` with data directory and volume declaration