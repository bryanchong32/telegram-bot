# STATUS.md — Telegram Bots

## Current Phase: Pre-build (Specs & Planning Complete)

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

**Not started (Phase 1 — Foundation):**
- [ ] Project scaffolding (package.json, folder structure, .env.example, .gitignore)
- [ ] SQLite database setup (3 tables: draft_buffer, scheduled_jobs, pending_sync)
- [ ] Telegram Bot 1 webhook + user ID whitelist
- [ ] Notion databases creation via MCP (Master Tasks, Quick Notes) with all properties and views
- [ ] PM2 process + Nginx webhook config (port 3003)
- [ ] Health check command (/health)
- [ ] Basic message receipt + echo test

**Pending Bryan's Action:**
- [ ] Share a Notion page with the `telegram-bot` integration (for MCP database creation)
- [ ] Get Telegram user ID via @userinfobot
- [ ] Save bot tokens + Notion token into .env on VPS (during Phase 1)

**Not needed yet:**
- Google OAuth credentials (Phase 5/6)
- OpenAI API key for Whisper (Phase 2)

---

### Known Issues
- VPS shared with ECOMWAVE CRM — PM2 process names must not conflict. Use `telegram-bots` on port 3003.
- Nginx needs separate server block or path-based routing for bot webhooks
- Anthropic API key can be reused from ECOMWAVE CRM

### Build Phase Overview

| Phase | Status | Scope |
|---|---|---|
| 0. Planning | ✅ Complete | Specs, audit, decisions, docs |
| 1. Foundation | ⬜ Not started | Project setup, webhook, SQLite, Notion DBs, auth |
| 2. Todo Module | ⬜ Not started | ADD/COMPLETE/LIST/UPDATE_TODO, stream routing, Notion |
| 3. Quick Notes Module | ⬜ Not started | Buffer, save/discard, intent shift, reminders, promote (no voice) |
| 4. Scheduler & Briefings | ⬜ Not started | Unified scheduler, recurring, daily 08:00, weekly Sun 20:00 |
| 5. File Handling | ⬜ Not started | Drive upload, PDF conversion, ATTACH_FILE, task linking |
| 6. Bot 2 — Receipts | ⬜ Not started | Vision extraction, Sheets logging, Drive storage, queries |
| 7. Polish & Hardening | ⬜ Not started | Edge cases, crash recovery, health check, security audit |
