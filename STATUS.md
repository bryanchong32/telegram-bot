# STATUS.md — Telegram Bots

## Current Phase: Phase 2 — Todo Module (COMPLETE)

---

### Session 2 — 2026-02-24 13:00 MYT (Phase 2: Todo Module)

**Completed:**
- [x] Intent engine (src/bot1/intentEngine.js): Claude Haiku classification into ADD_TODO, COMPLETE_TODO, LIST_TODOS, UPDATE_TODO, UNKNOWN. System prompt with dynamic date injection, JSON parsing with code fence stripping.
- [x] Stream router (src/bot1/streamRouter.js): Keyword → stream mapping with confidence scoring. Shared module for todos and notes.
- [x] ADD_TODO handler → Notion Master Tasks: Parses task/stream/urgency/due_date/energy/notes, creates page in Notion, falls back to pending_sync queue on failure.
- [x] COMPLETE_TODO handler: Fuzzy search on task titles, presents top match with inline confirm/cancel buttons (callback_query), marks task Done on confirmation.
- [x] LIST_TODOS handler: Filters (today/inbox/waiting/upcoming/all), grouped by urgency with emoji indicators. /today and /inbox commands bypass Claude.
- [x] UPDATE_TODO handler: Fuzzy search + field updates (due_date, urgency, status, stream, energy, notes). Notes always appended, never overwritten (GET before PATCH).
- [x] Router (src/bot1/router.js): Full intent routing — text → classifyIntent → switch/case dispatch. Callback query routing for complete:* buttons. UNKNOWN fallback with conversational Haiku reply.
- [x] Notion CRUD (src/bot1/todo/notion.js): createTask, queryTasks (5 filter modes), searchTasks (fuzzy scoring), updateTask (with notes append), completeTask. All wrapped in withRetry().
- [x] queryDatabase helper (src/utils/notion.js): Raw REST API call for database queries — workaround for @notionhq/client v5.x removing databases.query().
- [x] Dev startup robustness (src/index.js): Bryan added startBotWithRetry (409 conflict retry), deleteWebhook before polling, drop_pending_updates.
- [x] Integration tested from Telegram: ADD_TODO, COMPLETE_TODO, LIST_TODOS (/today, /inbox), UPDATE_TODO — all confirmed working. Tasks appear correctly in Notion Master Tasks database.

**Next Up (Phase 3 — Quick Notes Module):**
- [ ] Draft buffer state machine (SQLite persistence)
- [ ] 5s silence → static draft preview with Save/Discard inline buttons
- [ ] Intent shift detection (continues_draft vs new intent)
- [ ] Save: Claude generates title + type + stream → Notion Quick Notes DB
- [ ] SET_REMINDER intent → unified scheduler
- [ ] LIST_NOTES intent (filter by type, stream, date)
- [ ] PROMOTE_TO_TASK intent (Note → Master Tasks, mark Promoted)

**Not needed yet:**
- Google OAuth credentials (Phase 5/6)
- OpenAI API key for Whisper (deferred voice notes)
- VPS deployment — still testing locally

---

### Session 1 — 2026-02-24 12:15 MYT (Phase 1: Foundation)

**Completed:**
- [x] Project scaffolding: package.json, folder structure per ARCHITECTURE.md, .env, .env.example, .gitignore
- [x] Dependencies installed (all latest): grammy 1.40.0, better-sqlite3 12.6.2, @notionhq/client 5.9.0, node-cron 4.2.1, @anthropic-ai/sdk 0.78.0, dotenv 17.3.1, express 5.2.1
- [x] Shared modules: config.js (env loader with required/optional), auth.js (user ID whitelist middleware), db.js (SQLite with 3 tables), logger.js (structured JSON logging, no sensitive content)
- [x] Bot 1 (Personal Assistant): grammY setup, router with /start, /health, text echo, file/photo/callback_query placeholders
- [x] Bot 2 (Receipt Tracker): grammY setup, router with /start, /health, receipt/text placeholders
- [x] Health check: HTTP GET /health endpoint (JSON), Telegram /health command (both bots), checks SQLite + Notion + Anthropic + pending_sync queue
- [x] Entry point (src/index.js): Express on port 3003, long polling (dev) vs webhook (production), graceful shutdown (SIGTERM/SIGINT), background workers started
- [x] Notion databases created via API: Master Tasks (9 properties, all select options) + Quick Notes (8 properties, all select options) — under "Todo telegram" parent page
- [x] PM2 ecosystem.config.js + Nginx server block template (nginx/telegram-bots.conf)
- [x] Utility scripts: scripts/create-notion-dbs.js, scripts/set-webhooks.js
- [x] Utils: notion.js (retry with exponential backoff), anthropic.js (Haiku/Sonnet routing), dates.js (MYT helpers)
- [x] Scheduler + pending sync workers (placeholder loops, ready for Phase 4)
- [x] Git repo initialized on `dev` branch, initial commit made
- [x] Startup verified: both bots connect, SQLite tables created, Express listens on 3003

**Notion Database IDs (created this session):**
- Master Tasks: `ea1b4dc4-3b01-4e23-b0af-fdee9eee9eb3`
- Quick Notes: `ad7580b5-1d84-4ac1-95d6-530146cf5ae4`

**Next Up (Phase 2 — Todo Module):**
- [ ] Intent engine (Claude Haiku classification)
- [ ] Stream router (shared keyword → stream mapping)
- [ ] ADD_TODO handler → Notion Master Tasks
- [ ] COMPLETE_TODO handler (fuzzy match + confirm)
- [ ] LIST_TODOS handler (filters: today/inbox/waiting/upcoming/all)
- [ ] UPDATE_TODO handler (field updates, notes always appended)
- [ ] Integration test: add/complete/list tasks from Telegram

**Not needed yet:**
- Google OAuth credentials (Phase 5/6)
- OpenAI API key for Whisper (Phase 2 voice notes)
- VPS deployment (Nginx + webhook setup) — deferred until ready for production testing

---

### Session 0 — 2026-02-24 (Planning & Architecture)

**Completed:**
- [x] Three spec documents written: telegram-bots-plan.md, notion-todo-spec.md, notion-quicknotes-spec.md
- [x] Cross-document audit: identified 10 conflicts/gaps across the 3 specs
- [x] 13 architectural decisions made and documented (see DECISIONS.md)
- [x] PRD finalized (v1.1) with phased build plan
- [x] Project documentation created: CLAUDE.md, DECISIONS.md, SCHEMA.md, STATUS.md, ARCHITECTURE.md
- [x] Unified intent registry defined (12 intents + 4 callback_query events)
- [x] Unified scheduler schema designed (replaces 3 separate tables)
- [x] Folder structure defined
- [x] Environment variables mapped
- [x] GitHub repo created: https://github.com/bryanchong32/telegram-bot.git
- [x] Telegram bots created via @BotFather (2 bots, tokens ready)
- [x] Notion integration created (internal, workspace: Bryan's Notion)
- [x] Voice notes (Whisper) deferred to Phase 2

---

### Known Issues
- VPS shared with ECOMWAVE CRM — PM2 process names must not conflict. Use `telegram-bots` on port 3003.
- Nginx config template needs domain placeholder replaced before deployment
- Anthropic API key reused from ECOMWAVE CRM
- punycode deprecation warning from Node.js 22+ — harmless, upstream dependency issue

### Build Phase Overview

| Phase | Status | Scope |
|---|---|---|
| 0. Planning | ✅ Complete | Specs, audit, decisions, docs |
| 1. Foundation | ✅ Complete | Project setup, webhook, SQLite, Notion DBs, auth |
| 2. Todo Module | ✅ Complete | ADD/COMPLETE/LIST/UPDATE_TODO, stream routing, Notion |
| 3. Quick Notes Module | ⬜ Not started | Buffer, save/discard, intent shift, reminders, promote (no voice) |
| 4. Scheduler & Briefings | ⬜ Not started | Unified scheduler, recurring, daily 08:00, weekly Sun 20:00 |
| 5. File Handling | ⬜ Not started | Drive upload, PDF conversion, ATTACH_FILE, task linking |
| 6. Bot 2 — Receipts | ⬜ Not started | Vision extraction, Sheets logging, Drive storage, queries |
| 7. Polish & Hardening | ⬜ Not started | Edge cases, crash recovery, health check, security audit |
