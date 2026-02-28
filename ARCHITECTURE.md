# ARCHITECTURE.md — Telegram Bots

**Last Updated:** 2026-02-25 01:00 MYT

---

## System Overview

Three Telegram bots on a Hetzner VPS. Bot 1 (Personal Assistant) and Bot 2 (Receipt Tracker) run as a single Node.js process. Bot 3 (Request Agent) runs as a separate PM2 process. Bot 1 uses Notion as its primary data store and SQLite for local state. Bot 2 uses Google Sheets + Google Drive. Both use the Anthropic API for AI capabilities. Bot 3 receives `.md` documents, commits them to GitHub, and creates corresponding Notion entries.

```
Telegram Servers
  │
  ▼ (webhook POST)
Nginx (port 443, HTTPS)
  ├── /webhook/bot1 → Bot 1 handler
  ├── /webhook/bot2 → Bot 2 handler
  └── /webhook/request-agent → Bot 3 handler
  │
  ▼
Node.js Process (PM2: telegram-bots, port 3003)
  ├── Bot 1 — Personal Assistant
  │     ├── Message Router (auth → type → buffer check → intent engine)
  │     ├── Intent Engine (Anthropic API — Haiku/Sonnet)
  │     ├── Todo Module → Notion Master Tasks DB
  │     ├── Notes Module → Notion Quick Notes DB
  │     │     └── Draft Buffer → SQLite (draft_buffer)
  │     ├── File Module → Google Drive (/TaskRefs/{stream}/)
  │     └── Scheduler Worker → SQLite (scheduled_jobs)
  │           ├── Daily Briefing (08:00 MYT)
  │           ├── Weekly Review (Sun 20:00 MYT)
  │           ├── Recurring Tasks → Notion
  │           └── Reminders → Telegram
  │
  └── Bot 2 — Receipt Tracker
        ├── Claude Vision → extract receipt data
        ├── Google Sheets → append expense row
        └── Google Drive → store receipt image (/receipts/YYYY/MM/)

Node.js Process (PM2: request-agent, port 3004)
  └── Bot 3 — Request Agent
        ├── Parser → extract YAML frontmatter + markdown sections
        ├── GitHub API → commit .md file to project repo
        └── Notion API → create page in project database

Fallback: pending_sync (SQLite) retries failed Notion/Drive writes every 5min (Bot 1/2 only)
```

---

## VPS Deployment Details

| Item | Value |
|---|---|
| Server IP | 5.223.49.206 |
| VPS Provider | Hetzner |
| App location | /home/deploy/telegram-bots/ |
| PM2 process name | telegram-bots |
| Internal port | 3003 |
| PM2 user | deploy (NEVER run PM2 as root — shared VPS with ECOMWAVE CRM) |
| Nginx config | Location blocks in /etc/nginx/sites-available/ecomwave |
| Webhook URL (Bot 1) | https://ecomwave.duckdns.org/webhook/bot1 |
| Webhook URL (Bot 2) | https://ecomwave.duckdns.org/webhook/bot2 |
| Webhook URL (Bot 3) | https://ecomwave.duckdns.org/webhook/request-agent |
| SSL | Let's Encrypt (auto-renew) |
| SQLite DB | /home/deploy/telegram-bots/data/bot.db |
| Timezone | Asia/Kuala_Lumpur (UTC+8) |

**Port allocation on this VPS:**

| Service | Port | PM2 Process Name |
|---|---|---|
| ECOMWAVE CRM (production) | 3001 | ecomwave-crm |
| ECOMWAVE CRM (staging) | 3002 | ecomwave-crm-staging |
| Telegram Bots (Bot 1 + 2) | 3003 | telegram-bots |
| Request Agent (Bot 3) | 3004 | request-agent |

**Note:** Webhooks use the existing ecomwave.duckdns.org domain (already has SSL). Location blocks added to the same Nginx config — no separate domain needed. Only Telegram servers hit these URLs.

---

## Message Flow — Bot 1

```
Incoming message
    ↓
User ID in whitelist? → No → silently ignore
    ↓ Yes
Message type?
    ├── /command → Command handler (bypass Claude)
    │     /today, /inbox, /notes, /ideas, /reminders, /help, /health
    ├── File → ATTACH_FILE handler (Phase 5)
    └── Text ↓
            ↓
Keyboard button? (e.g. "📋 Today") → handle directly (zero API cost)
    ↓ No
Draft buffer open?
    ├── Yes, BUFFERING (within 5s) → append to buffer, reset timer (zero API cost)
    ├── Yes, PREVIEWING (after 5s) → Intent shift check (Haiku)
    │         ├── Continues draft → append to buffer, reset timer
    │         └── New intent → auto-save draft (Sonnet) → release to intent engine
    └── No → Intent engine (Haiku)
                ↓
          Route by intent:
            ├── ADD_TODO / COMPLETE / LIST / UPDATE → todo/handlers.js → Notion
            ├── ADD_NOTE → notes/buffer.js (open new draft, start 5s timer)
            ├── SET_REMINDER → notes/handlers.js → Notion + scheduler
            ├── LIST_NOTES → notes/handlers.js → Notion query
            ├── PROMOTE_TO_TASK → notes/handlers.js → Notion (both DBs)
            ├── ATTACH_FILE → files/handlers.js → Drive + Notion (Phase 5)
            └── UNKNOWN → conversational reply (Haiku)
                ↓
          Confirmation reply → Telegram
```

**Persistent reply keyboard:** 6 buttons always visible at bottom — Today, Inbox, My Notes, My Ideas, Reminders, Help. Routed before intent engine (zero cost).

**Note:** Voice notes deferred to Phase 2. When added, voice messages will go through Whisper API → transcribed text enters flow as regular text with source=Voice flag.

---

## Message Flow — Bot 2

```
Incoming message
    ↓
User ID in whitelist? → No → silently ignore
    ↓ Yes
Message type?
    ├── /command → Command handler (bypass Claude)
    │     /summary, /categories, /recent, /help, /health
    ├── Photo/PDF ↓
    │     Download from Telegram
    │         ↓
    │     Claude Vision (Haiku) → extract data + is_receipt + confidence
    │         ├── Not a receipt → reject: "This doesn't look like a receipt"
    │         ├── Low confidence (<0.5) → "Receipt hard to read, try clearer photo"
    │         └── Valid receipt ↓
    │               Upload to Google Drive /receipts/YYYY/MM/
    │               Append row to Google Sheets (with Logged By)
    │               Reply: "Logged: MYR 45.50 at Grab" + [Delete] button
    │
    ├── Callback: receipt:delete → Delete from Sheets + Drive
    │
    └── Text → Expense query (Haiku classification)
              ↓
        Query Google Sheets → format summary → reply
```

---

## Message Flow — Bot 3

```
Incoming message
    ↓
User ID in whitelist? → No → silently ignore
    ↓ Yes
Message type?
    ├── /command → Command handler
    │     /start, /help, /health
    ├── Document (.md file) ↓
    │     Download from Telegram
    │         ↓
    │     Validate file extension (.md only)
    │         ├── Not .md → reject: "Please send a .md file"
    │         └── Valid .md ↓
    │               Parse YAML frontmatter (gray-matter)
    │                   ↓
    │               Validate project field → match against projects.js registry
    │                   ├── Unknown project → reject: "Unknown project: {name}"
    │                   └── Valid project ↓
    │                         Split markdown body into sections
    │                             ↓
    │                         Commit .md file to GitHub repo (project-specific path)
    │                             ↓
    │                         Create Notion page in project database
    │                             ↓
    │                         Reply: confirmation with GitHub + Notion links
    │
    └── Text/Photo/Other → reject: "Send a .md document"
```

---

## Modules — Bot 3

| Module | File | Purpose |
|---|---|---|
| Config | `src/bot3/config.js` | Environment variables, port, webhook path |
| Projects | `src/bot3/projects.js` | Project registry — repo paths, Notion DB IDs, validation |
| Logger | `src/bot3/logger.js` | Structured logging with timestamps |
| Parser | `src/bot3/parser.js` | YAML frontmatter extraction, section splitting (gray-matter) |
| GitHub | `src/bot3/github.js` | GitHub API — commit files to project repos |
| Notion | `src/bot3/notion.js` | Notion API — create pages in project databases |
| Bot | `src/bot3/bot.js` | Grammy bot instance, webhook configuration |
| Router | `src/bot3/router.js` | Message handler — auth, validation, orchestration |
| Index | `src/bot3/index.js` | Express server, webhook endpoint, PM2 entry point |

---

## Folder Guide

| Folder | Purpose |
|---|---|
| `src/bot1/` | Bot 1 — Personal Assistant (router, intent engine, modules) |
| `src/bot1/todo/` | Todo module — handlers + Notion queries |
| `src/bot1/notes/` | Quick Notes module — buffer, handlers, Notion queries |
| `src/bot1/files/` | File handling — Drive upload, PDF conversion, Notion file links, ATTACH_FILE handler |
| `src/bot1/briefing/` | Daily briefing + weekly review composers |
| `src/bot2/` | Bot 2 — Receipt Tracker (router, vision, sheets, drive) |
| `src/bot3/` | Bot 3 — Request Agent (router, parser, GitHub, Notion) |
| `src/shared/` | Shared infra — SQLite, scheduler, auth, config |
| `src/utils/` | Helpers — Notion API, Anthropic API, Google API, dates, logging |
| `docs/` | Original spec documents |
| `data/` | SQLite database file (gitignored) |

---

## External Dependencies

| Package | Purpose | Why Not Native |
|---|---|---|
| grammy | Telegram Bot API wrapper | Handles webhook setup, message parsing, inline keyboards, callback queries. Chosen over node-telegram-bot-api for modern JS support. |
| @notionhq/client | Notion API client | Official SDK with typed methods, rate limit handling. |
| better-sqlite3 | SQLite for Node.js | Synchronous API is simpler for draft buffer (no async race conditions). Faster than node-sqlite3. |
| node-cron | Cron-style scheduler | Triggers the scheduler worker check every 60 seconds. Lightweight. |
| cron-parser | Cron expression → next occurrence | Calculates next_run_at from cron_expr for rescheduling recurring jobs. node-cron doesn't expose this. Added Phase 4. |
| googleapis | Google Drive + Sheets APIs | Official SDK. Single package covers Drive + Sheets + Calendar (Phase 2). Installed Phase 5 prep. OAuth verified (bryanchong32@gmail.com). |
| @anthropic-ai/sdk | Anthropic API client | Intent classification, title generation, vision (receipts). Already used across projects. |
| gray-matter | YAML frontmatter parser | Extracts structured metadata from .md documents. Used by Bot 3 (Request Agent). |

**Phase 2 additions (not yet):**
- `openai` — OpenAI Whisper API for voice transcription. Add when voice notes are needed.

**VPS system dependency:**
```bash
apt-get install libreoffice    # Office → PDF conversion (ATTACH_FILE)
```

**Note:** LibreOffice may already be installed for ECOMWAVE CRM. Verify before installing.

---

## API Cost Model

| Action | API | Model | Est. Cost |
|---|---|---|---|
| Intent classification | Anthropic | Haiku | ~$0.0003/call |
| Intent shift detection | Anthropic | Haiku | ~$0.0003/call |
| File caption parsing | Anthropic | Haiku | ~$0.0003/call |
| Note title/type/stream generation | Anthropic | Sonnet | ~$0.003/call |
| Receipt extraction | Anthropic | Haiku (vision) | ~$0.003/image |
| Expense query classification | Anthropic | Haiku | ~$0.0003/call |
| Conversational reply (UNKNOWN) | Anthropic | Sonnet | ~$0.003/call |

**Estimated monthly:** $2–5 under normal personal use.

---

## Self-Healing & Error Handling

| Failure | Detection | Self-Heal | User Notification |
|---|---|---|---|
| Notion API down | HTTP 5xx / timeout | Retry 3x exponential (1s, 3s, 9s) → queue to pending_sync | After 3rd fail: "⚠️ Notion unreachable. Queued locally." |
| Notion token expired | HTTP 401 | Halt Notion calls, log | "⚠️ Notion auth failed. Check NOTION_TOKEN." |
| Google Drive upload fail | HTTP error | Retry 2x → queue to pending_sync | "⚠️ Drive upload failed. File queued for retry." |
| PDF conversion fail | LibreOffice error | Upload original without conversion | "⚠️ Conversion failed. Original uploaded." |
| Claude title generation fail | API error | Use first 50 chars of content | Silent fallback |
| Intent shift classification fail | API error | Default continues_draft = true | Safe fallback — never loses content |
| Task not found (fuzzy match) | Empty results | Ask for correct task name | Always |
| Draft lost on VPS restart | SQLite persistence | Reload from draft_buffer on startup | "📝 Recovered unsaved draft — tap to review" |
| Scheduler missed triggers | last_triggered check on startup | Re-run missed from last 24hrs | "📋 Missed recurring task created: {name}" |
| pending_sync 5th failure | retry_count = 5 | Stop retrying | Notify Bryan via Telegram |
| Scheduler job execution fails | try/catch per job | Always reschedule (prevent retry loop) | Error logged |
| Unhandled promise rejection | process.on('unhandledRejection') | Log and continue (don't crash) | Error in PM2 logs |
| Uncaught exception | process.on('uncaughtException') | Log and exit → PM2 auto-restarts | Error in PM2 logs |
| Graceful shutdown hangs | 10s timeout | Force process.exit(1) | PM2 auto-restarts |
