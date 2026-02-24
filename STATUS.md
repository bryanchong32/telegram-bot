# STATUS.md — Telegram Bots

## Current Phase: Phase 5 — File Handling (READY)

---

### Session 5 — 2026-02-24 16:00 MYT (Phase 5 Prep: GCP Setup)

**Completed:**
- [x] Google Cloud Platform setup: project created, Drive API + Sheets API enabled, OAuth consent screen configured.
- [x] OAuth 2.0 credentials obtained: Client ID, Client Secret, and Refresh Token via Google OAuth Playground.
- [x] Scopes: `https://www.googleapis.com/auth/drive.file` (Drive) + `https://www.googleapis.com/auth/spreadsheets` (Sheets).
- [x] Credentials added to .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
- [x] googleapis npm package installed (Google Drive v3 + Sheets v4 APIs).
- [x] Connection verified: Drive API test passed — authenticated as bryanchong32@gmail.com.

**Next Up (Phase 5 — File Handling):**
- [ ] Create Google Drive folders programmatically (TaskRefs root + stream subfolders, receipts/YYYY/MM)
- [ ] Create Google Sheets expense log → set GDRIVE_TASK_REFS_FOLDER_ID, GDRIVE_RECEIPTS_FOLDER_ID, GSHEETS_EXPENSE_LOG_ID
- [ ] Google Drive upload module (src/bot1/files/drive.js)
- [ ] Office → PDF conversion via LibreOffice (src/bot1/files/convert.js)
- [ ] ATTACH_FILE intent handler (src/bot1/files/handlers.js)
- [ ] File linking to Notion Master Tasks (File Links property)

**Not needed yet:**
- OpenAI API key for Whisper (deferred voice notes)
- VPS deployment — still testing locally

---

### Session 4 — 2026-02-24 15:00 MYT (Phase 4: Scheduler & Briefings)

**Completed:**
- [x] Scheduler worker fully implemented (src/shared/scheduler.js): executes 4 job types — briefing, review, reminder, recurring. Processes due jobs every 60s from scheduled_jobs table.
- [x] Daily briefing composer (src/bot1/briefing/daily.js): queries today's tasks (grouped by urgency), inbox count, and today's reminders. Formats morning briefing message. Calendar placeholder for Phase 2.
- [x] Weekly review composer (src/bot1/briefing/weekly.js): queries waiting items (with age in days), tasks completed this week (via last_edited_time proxy), and upcoming 7-day tasks. Formats Sunday review message.
- [x] Reminder delivery: fires one-shot reminders with inline Done/Snooze buttons (reminder:done:{id}, reminder:snooze:{id}). Done deactivates job, Snooze reschedules +1hr.
- [x] Recurring task creation: creates Notion Master Task with pre-filled fields on cron trigger, notifies Bryan via Telegram.
- [x] Cron-based rescheduling: recurring jobs auto-calculate next_run_at via cron-parser. One-shot reminders deactivated after firing.
- [x] Missed-trigger detection (checkMissedTriggers): on startup, finds active jobs whose next_run_at fell in the last 24hrs and re-executes them. Handles VPS restarts.
- [x] Router updated (src/bot1/router.js): reminder:done and reminder:snooze callback handlers. Replaces Phase 4 placeholder.
- [x] Entry point updated (src/index.js): passes bot1 reference to scheduler, added checkMissedTriggers on startup.
- [x] Date helpers updated (src/utils/dates.js): nextCronRun() (cron expression → next ISO datetime), startOfDayMYT() helper.
- [x] New dependency: cron-parser — calculates next occurrence from cron expressions with MYT timezone.
- [x] Seed script (scripts/seed-scheduler.js): idempotent seeder for default jobs. Creates daily briefing (0 8 * * *) and weekly review (0 20 * * 0).
- [x] SQLite seeded: daily briefing (next: 2026-02-25 08:00 MYT), weekly review (next: 2026-03-01 Sun 20:00 MYT).
- [x] Startup verified: clean boot, all modules load, scheduler starts, missed-trigger check passes, no regressions.

**Next Up (Phase 5 — File Handling):**
- [ ] Google OAuth setup (Drive + Sheets credentials)
- [ ] Google Drive upload module (src/bot1/files/drive.js)
- [ ] Office → PDF conversion via LibreOffice (src/bot1/files/convert.js)
- [ ] ATTACH_FILE intent handler (src/bot1/files/handlers.js)
- [ ] File linking to Notion Master Tasks (File Links property)

**Not needed yet:**
- OpenAI API key for Whisper (deferred voice notes)
- VPS deployment — still testing locally

---

### Session 3 — 2026-02-24 14:00 MYT (Phase 3: Quick Notes Module + UX)

**Completed:**
- [x] Notes Notion CRUD (src/bot1/notes/notion.js): createNote, queryNotes (5 filters), searchNotes (fuzzy), markNotePromoted. Quick Notes DB integration with all properties (Title, Content, Type, Stream, Remind At, Promoted, Source).
- [x] Draft buffer state machine (src/bot1/notes/buffer.js): SQLite persistence (crash-safe), 5s silence timer → static preview with Save/Discard, 1hr timeout ping, intent shift detection (Haiku — only after preview shown, not during rapid typing), title/type/stream generation (Sonnet — 1 call per save), VPS restart recovery (restoreOpenDrafts).
- [x] Notes handlers (src/bot1/notes/handlers.js): ADD_NOTE (opens buffer), SET_REMINDER (immediate save + scheduler entry), LIST_NOTES (filtered queries with relative times), PROMOTE_TO_TASK (note → Master Task, marks Promoted), handleDraftSave/Discard callbacks, autoSaveDraft (for intent shift).
- [x] Intent engine updated (src/bot1/intentEngine.js): 4 new intents — ADD_NOTE, SET_REMINDER, LIST_NOTES, PROMOTE_TO_TASK. Clear ADD_NOTE vs ADD_TODO distinction guidance. Valid intents list expanded.
- [x] Router updated (src/bot1/router.js): Draft buffer check before intent engine (Step 0), keyboard button shortcuts (Step 0b), all 4 notes intents routed, draft:save/discard callback handling, /notes /ideas /reminders commands.
- [x] Entry point updated (src/index.js): restoreOpenDrafts on startup, clearAllState on shutdown.
- [x] UX: Persistent reply keyboard (6 buttons — Today, Inbox, My Notes, My Ideas, Reminders, Help). Zero API cost for navigation.
- [x] UX: Telegram menu commands registered via setMyCommands API (src/bot1/bot.js).
- [x] UX: /help command with full feature guide and example trigger phrases.
- [x] UX: /ideas and /reminders shortcut commands (bypass Claude).
- [x] Startup verified: clean boot, all modules load, no regressions on Phase 2 todo features.

**Next Up (Phase 4 — Scheduler & Briefings):**
- [ ] Unified scheduler worker (execute pending jobs from scheduled_jobs table)
- [ ] Recurring task creation (cron_expr → Notion Master Tasks)
- [ ] Daily briefing (08:00 MYT) — tasks + inbox count + reminders
- [ ] Weekly review (Sun 20:00 MYT) — week summary + upcoming
- [ ] Reminder delivery (fire at remind_at → Telegram message with Done/Snooze buttons)

**Not needed yet:**
- Google OAuth credentials (Phase 5/6)
- OpenAI API key for Whisper (deferred voice notes)
- VPS deployment — still testing locally

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
| 3. Quick Notes Module | ✅ Complete | Buffer, save/discard, intent shift, reminders, promote (no voice) |
| 4. Scheduler & Briefings | ✅ Complete | Unified scheduler, recurring, daily 08:00, weekly Sun 20:00 |
| 5. File Handling | 🔧 GCP Ready | Drive upload, PDF conversion, ATTACH_FILE, task linking |
| 6. Bot 2 — Receipts | ⬜ Not started | Vision extraction, Sheets logging, Drive storage, queries |
| 7. Polish & Hardening | ⬜ Not started | Edge cases, crash recovery, health check, security audit |
