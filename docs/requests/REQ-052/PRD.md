# PRD

## Problem Statement

The base Order Entry Bot (REQ-051) handles parsing and writing orders to Google Sheets, but has four UX and reliability gaps: (1) after staff confirms an order, there's no clear visual record in the group chat showing what was written and by whom, (2) any group member can tap the confirm button — not just the person who posted the order, which risks accidental confirmations, (3) promo campaigns change every few weeks and currently require a code change + redeployment to update, and (4) if the bot crashes between parsing and confirmation, all pending orders in memory are lost.

## Users & Stakeholders

- **Primary users:** Minionions Marketing sales staff — need clear confirmation feedback and protection from accidental confirms
- **Secondary users:** Bryan (admin) — needs to manage promo campaigns without touching code
- **Requested by:** Bryan (Solworks)

## Success Criteria

1. Every confirmed order has a visible reply in the group showing exactly what was written to the sheet, who confirmed it, and when
2. Only the staff member who originally posted the order can tap ✅ Confirm
3. Bryan can add/remove active promos in under 10 seconds via Telegram commands — no code deploy needed
4. If the bot restarts, all unconfirmed orders that were mid-flow are restored and can still be confirmed

## Requirements

### Functional Requirements

- FR-1: When staff taps ✅ Confirm, the bot sends a **new reply message** (not editing the original) with the confirmed order summary, confirmer's name, and timestamp
- FR-2: When staff taps ❌ Cancel, the bot sends a short reply confirming cancellation with who cancelled and when
- FR-3: Only the Telegram user who triggered the original order parsing can tap ✅ or ❌. If a different user taps, the bot responds with an inline notification: "只有發送人可以確認" (only the sender can confirm)
- FR-4: Admin command `/promo add {name}` adds a promo to the active list (e.g., `/promo add 女神節`)
- FR-5: Admin command `/promo remove {name}` removes a promo from the active list
- FR-6: Admin command `/promo list` shows all currently active promos
- FR-7: Promo commands are restricted to a configurable admin Telegram user ID — other users get "無權限" (no permission)
- FR-8: Active promo list is persisted to a JSON file on disk so it survives bot restarts
- FR-9: All pending orders (parsed but not yet confirmed) are persisted to a JSON file on disk
- FR-10: On bot startup, pending orders are loaded from disk and their confirmation cards remain actionable
- FR-11: Pending orders older than 1 hour are auto-expired on startup (stale data, staff should re-post)

### Non-Functional Requirements

- NFR-1: Disk persistence writes should be non-blocking — don't slow down the bot's message handling
- NFR-2: JSON files should be human-readable (pretty-printed) for debugging
- NFR-3: Promo commands should respond within 1 second

## Scope

### In Scope

- Post-confirmation reply message with full order summary and audit trail
- Post-cancellation reply message
- Poster-only confirmation restriction (Telegram user ID check)
- `/promo add`, `/promo remove`, `/promo list` admin commands
- Admin restriction by Telegram user ID (env var)
- Disk persistence for active promos (JSON file)
- Disk persistence for pending orders (JSON file)
- Startup recovery of pending orders from disk
- Auto-expiry of stale pending orders (>1 hour)

### Out of Scope

- Order stats commands (deferred — separate enhancement)
- Daily summary auto-post (deferred — separate enhancement)
- Order edit/amendment after confirmation
- Multi-admin support (single admin user ID is sufficient)
- Database storage (JSON files are sufficient for this data volume)

## UI/UX Notes

### Confirmed order reply message:

```
✅ 已寫入 Google Sheet

📋 訂單 (Order ID: 🆔 4082858)
📅 11 March 2026
🌍 HK
👤 Hung Lam
📞 85293422260
📍 元朗大棠路紅棗田村148号

📦 [女神節]3HMG (HOMEGA 3樽) — HK$1,650 | PV 630
💰 HK$1,600 | 🚚 SF COD

📣 Ad: 清貨特價
💊 Pain Point: 血壓高，食緊血壓藥

確認人: @staffusername
確認時間: 11 March 2026, 10:15 PM
```

### Cancelled order reply message:

```
❌ 已取消

📋 訂單 (Order ID: 🆔 4082858)
👤 Hung Lam — HK$1,600

取消人: @staffusername
取消時間: 11 March 2026, 10:15 PM
```

### Wrong person taps confirm:

Inline callback answer (toast notification, not a message): `只有發送人可以確認`

### Promo commands:

```
/promo list
───────────
🏷️ 目前優惠:
  1. [女神節]

/promo add 中秋
───────────
✅ 已新增優惠: [中秋]

/promo remove 女神節
───────────
✅ 已移除優惠: [女神節]
```

## Technical Notes

- This enhancement builds on top of whatever REQ-051 base implementation exists. It modifies the confirmation flow, adds command handlers, and adds a persistence layer.
- Persistence files should be stored in a configurable data directory (e.g., `./data/promos.json`, `./data/pending-orders.json`). The Dockerfile should create this directory and ensure it's writable. For Coolify, this directory should be a Docker volume so it survives container rebuilds.
- The admin Telegram user ID should be an env var (`ADMIN_TELEGRAM_USER_ID`) so it doesn't require a code change to transfer admin rights.

## Open Questions

None.