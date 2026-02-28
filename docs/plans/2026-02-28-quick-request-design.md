# Quick Request Feature — Design

## Problem

The Request Agent bot only accepts fully scoped `.md` files. Unscoped ideas/bugs can't be tracked without going through the full scoping process first.

## Solution

Accept plain text messages as "quick requests" — log them in Notion as **Unscoped** with minimal metadata collected via inline buttons.

## User Flow

1. User sends a text message (becomes the request title)
2. Bot replies with **project** inline buttons (ecomwave-crm / telegram-bot)
3. User taps project → bot replies with **type** buttons (Bug / Feature / Enhancement / UX/Polish / Refactor)
4. User taps type → bot replies with **priority** buttons (P1 Critical / P2 Important / P3 Backlog)
5. User taps priority → bot auto-generates next REQ-XXX ID, creates Notion entry, confirms

## Notion Entry (Unscoped)

| Field | Value |
|-------|-------|
| Request Title | The text message |
| Request ID | Auto-generated (REQ-XXX) |
| Type | Selected via button |
| Priority | Selected via button |
| Effort | _(empty — filled during scoping)_ |
| Status | Unscoped |
| Source | Quick Request |
| Project | Selected via button |
| Date Logged | Today |
| PRD Link | _(empty)_ |
| Decision Notes Link | _(empty)_ |
| CC Instructions Link | _(empty)_ |

## Technical Approach — In-Memory Conversation State

- `Map<chatId, pendingRequest>` in the router
- Each entry stores: `{ title, project, type, step, timestamp }`
- State expires after 5 minutes (same TTL as message dedup)
- Inline keyboard callbacks identified by prefix `qr:` (quick request)

## Auto-Generate Request ID

- Query Notion database for all existing Request ID values
- Parse highest REQ-XXX number, increment by 1
- Fallback to REQ-001 if database is empty

## Files to Change

- `src/bot3/router.js` — add text handler, callback query handler, conversation state
- `src/bot3/notion.js` — add `createQuickEntry()` and `getNextRequestId()` functions

## No GitHub Commit

Quick requests have no docs to commit. Only a Notion entry is created.
