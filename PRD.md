# PRD.md — Telegram Bots (Personal Assistant + Receipt Tracker)

**Version:** 1.1  
**Author:** Bryan  
**Date:** 2026-02-24  

---

## 1. Product Overview

Two Telegram bots hosted on a personal Hetzner VPS, powered by Claude AI for intent classification and natural language understanding.

**Bot 1 — Personal Assistant:** A single Telegram chat that manages todos, quick notes, reminders, and daily/weekly briefings. Data lives in Notion (Master Tasks + Quick Notes databases) and a local SQLite scheduler.

**Bot 2 — Receipt & Expense Tracker:** Send a receipt photo or PDF → Claude Vision extracts details → logs to Google Sheets → stores original in Google Drive. Expense summaries on demand.

**Target user:** Bryan only (single-user, personal productivity tool).  
**Estimated running cost:** ~$2–5/month (Anthropic API).

---

## 2. Goals & Success Criteria

| Goal | Measured By |
|---|---|
| Zero-friction task capture from phone | Todo added in ≤1 message, confirmation within 3s |
| No task/note ever lost | SQLite fallback queue, draft persistence, crash recovery |
| Morning awareness without opening multiple apps | Daily briefing covers tasks + reminders (+ calendar in Phase 2) |
| Receipt logging without manual data entry | Photo → Sheets row in ≤10s |

---

## 3. User Personas

**Bryan (sole user):** Business owner, manages multiple ventures (Minionions, KLN, Overdrive, Property, Personal). Uses Telegram constantly. Needs a single chat interface to capture tasks, ideas, meeting notes, and receipts without context-switching to Notion, Sheets, or Calendar apps.

---

## 4. Phase 1 — Core (MVP)

### Bot 1 — Personal Assistant

**4.1 Intent Engine**  
Every text message → Claude classifies into one of 12 intents (see SCHEMA.md for full registry). Commands (`/today`, `/inbox`, `/health`) bypass Claude and run directly.

**4.2 Todo Module**  
- ADD_TODO: Parse task, stream, urgency, due date, energy, notes → write to Notion Master Tasks DB
- COMPLETE_TODO: Fuzzy match → confirm → mark Done
- UPDATE_TODO: Fuzzy match → PATCH fields (notes always appended, never overwritten)
- LIST_TODOS: Filters — today / inbox / waiting / upcoming / all
- ATTACH_FILE: Upload to Google Drive `/TaskRefs/{stream}/`, link to Notion task. Office docs → PDF via LibreOffice.
- Stream routing: Shared keyword → stream mapping module. Todo defaults to Personal on low confidence.

**4.3 Quick Notes Module**  
- Draft buffer: Messages accumulate in SQLite. No API calls during buffering.
- 5s silence → static draft preview with Save/Discard inline buttons (Telegram callback_query, not Claude intents).
- Save triggers ONE Claude API call → generate title + type + stream → write to Notion Quick Notes DB.
- Intent shift detection: If new message arrives mid-draft, Claude checks if it continues or is new. New intent → auto-save draft, route new message to global intent engine.
- 1hr timeout ping: Fires once, draft stays open until resolved.
- SET_REMINDER: Save note + write to unified scheduler.
- LIST_NOTES: Filter by type, stream, date, or fullText search.
- PROMOTE_TO_TASK: Note → Master Tasks (Status = Inbox), mark note Promoted = true.

**4.4 Message Router (Buffer Priority)**  
When a draft is open, incoming messages go to the buffer's intent-shift detector FIRST. Only if `continues_draft = false` does the message pass to the global intent engine. No draft open → global intent engine directly.

**4.5 Unified Scheduler**  
Single `scheduled_jobs` SQLite table. One background worker checks `next_run_at <= now` every 60 seconds. Supports: recurring tasks, one-shot reminders, daily briefing, weekly review.

**4.6 Daily Briefing (08:00 MYT)**  
Composable — each module contributes a section:
- Tasks: Status = In Progress OR Due = today
- Reminders: remind_at = today
- Calendar: placeholder until Phase 2

**4.7 Weekly Review (Sunday 20:00 MYT)**  
- Waiting items with age
- Completed this week count
- Upcoming 7 days
- Unpromoted notes from this week

**4.8 Recurring Tasks**  
Config in `scheduled_jobs` with `cron_expr`. Worker creates Notion task + sends Telegram confirmation on trigger.

### Bot 2 — Receipt & Expense Tracker

**4.9 Receipt Processing**  
- Photo/PDF → Claude Vision → extract: merchant, date, amount, category (inferred), currency
- Append row to Google Sheets
- Upload original to Google Drive `/receipts/YYYY/MM/`
- Reply with confirmation

**4.10 Expense Queries**  
- "Show me this month's expenses" → query Sheets, format summary
- "Total client entertainment this month" → category filter
- Multi-currency aware (MYR-based)

---

## 5. Phase 2 — Future

| Feature | Module |
|---|---|
| Voice notes — Whisper transcription → save to Notion | Bot 1 |
| Google Calendar integration (bryanchong32@gmail.com) | Bot 1 |
| Outlook Calendar integration (bryanckl@hotmail.com) | Bot 1 |
| Unified calendar view + daily briefing section | Bot 1 |
| Link forwarding → summarize + save to reading list | Bot 1 |
| Habit tracker → Notion | Bot 1 |
| Work log / timesheet → Notion | Bot 1 |
| Light expense logging → Notion | Bot 1 |
| Quick web search + summarization | Bot 1 |
| Screenshot/whiteboard → OCR → Notion | Bot 1 |

---

## 6. Security

- Both bots enforce Telegram user ID whitelist — silently ignore all other users
- All API keys in `.env`, never committed
- Bot tokens stored securely, rotated if suspected exposure
- VPS firewall: only expose webhook port (443)
- HTTPS required for Telegram webhook
- No sensitive data logged (messages may contain personal/financial info)

---

## 7. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Response latency (simple intent) | < 3 seconds |
| Uptime | Best-effort (personal tool, no SLA) |
| Data durability | SQLite fallback for all writes; Notion/Sheets as source of truth |
| API cost | ≤ $5/month under normal personal use |
| Timezone | UTC+8 (Asia/Kuala_Lumpur) hardcoded |
