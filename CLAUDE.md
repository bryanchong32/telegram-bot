# CLAUDE.md — Project Context & Standards
# Telegram Bots | Owner: Bryan
# Last Updated: 2026-02-24 14:00 MYT | Updated By: Claude Code (Session 3)

---

## ABOUT THIS FILE

This file is my persistent memory. Read it fully at the start of every session before doing anything. Update the relevant sections at the end of every session. Never delete historical decisions — append to them.

All timestamps use format: YYYY-MM-DD HH:MM MYT (Malaysia Time)

---

## PROJECT OVERVIEW

**Project Name:** Telegram Bots — Personal Assistant + Receipt Tracker
**Owner:** Bryan (Minionions Marketing)
**Project Started:** 2026-02-24
**What This System Does:** Two Telegram bots on a single VPS. Bot 1 is a personal assistant — captures todos, quick notes, reminders, and sends daily/weekly briefings. All data persists to Notion (Master Tasks + Quick Notes databases). Bot 2 is a receipt tracker — receipt photo/PDF → Claude Vision extraction → Google Sheets log + Google Drive storage. Both bots are single-user (Bryan only).
**Existing Systems to Integrate:** Notion API (todos + notes), Google Drive (task files + receipts), Google Sheets (expense log), Anthropic API (intent parsing + vision)
**Hard Deadlines / Constraints:** None — personal project, ship when ready
**VPS:** Hetzner (same server as ECOMWAVE CRM — 5.223.49.206)

---

## WHO I AM WORKING FOR

Bryan is the sole user and architect. He has a business and finance background, not a technical one. He wrote the specs (PRD, module specs) and made all architectural decisions.

Bryan's role: architect, product decisions, QA testing, documentation review.
My role (Claude Code): building, coding, deployment, and maintaining all technical documentation.

Bryan bridges design and implementation. When I make technical decisions, I must explain them clearly enough that Bryan can understand and audit them.

---

## REFERENCE DOCUMENTS

Read these before building. They are the canonical specs:

| File | What It Covers |
|---|---|
| PRD.md | Product requirements, phasing, success criteria |
| docs/telegram-bots-plan.md | Master plan — both bots, integrations, message flow, security |
| docs/notion-todo-spec.md | Todo module — Master Tasks DB, intents, file handling, recurring tasks, briefings |
| docs/notion-quicknotes-spec.md | Quick Notes module — draft buffer, voice, reminders, promote-to-task |

---

## TECH STACK

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js | Single runtime for both bots |
| Bot Framework | grammY v1.40.0 | Telegram Bot API wrapper — chosen over node-telegram-bot-api for better modern JS support, built-in webhook adapter |
| Database (local) | SQLite via better-sqlite3 | Draft buffer, scheduler, fallback queue — NOT for primary data |
| Database (primary) | Notion API via @notionhq/client | Master Tasks DB + Quick Notes DB — source of truth for all tasks/notes |
| AI — Intent Parsing | Anthropic API (Haiku for simple, Sonnet for complex) | Intent classification, title generation, stream inference |
| AI — Vision | Anthropic API (Claude Vision) | Receipt data extraction (Bot 2) |
| File Storage | Google Drive API via googleapis | Task reference files + receipt images |
| Expense Log | Google Sheets API via googleapis | Receipt data rows (Bot 2) |
| Scheduler | node-cron | Trigger check every 60s against scheduled_jobs table |
| Process Manager | PM2 | Same as ECOMWAVE — runs under `deploy` user |
| Reverse Proxy | Nginx | Webhook endpoint, HTTPS via Let's Encrypt |
| Hosting | Hetzner VPS (5.223.49.206) | Shared with ECOMWAVE CRM |

**Phase 2 additions (not yet):**
- OpenAI Whisper API — voice note transcription (~$0.006/min). Deferred — not needed for MVP.
- Google Calendar API + Microsoft OAuth — calendar module.

**Do not introduce any technology outside this stack without flagging it to Bryan first.** If an external library or tool is needed, explain: what it does, why it's needed, what the alternative is, and your recommendation with reasoning. Wait for Bryan's approval before adding it.

---

## CODING STANDARDS — NON-NEGOTIABLE

These apply to every file, every session, without exception:

**Readability**
- Write clean, readable code — prioritize clarity over cleverness
- Every function and every major code block must have a comment explaining what it does and why
- Use clear, descriptive variable and function names — no cryptic abbreviations

**Dependencies**
- Keep external dependencies minimal
- Before adding any npm package, ask: can this be done natively or with what we already have?
- If a dependency is added, document it in ARCHITECTURE.md with the reason and date

**Error Handling**
- Every function that can fail must handle the failure gracefully
- User-facing errors (Telegram replies) must be clear, plain-English messages — never expose raw error codes
- All errors must be logged server-side for debugging
- Follow the self-healing matrix in the module specs: retry logic, fallback queues, graceful degradation

**Security — always enforce without being asked:**
- All secrets (API keys, bot tokens, OAuth credentials) in environment variables — never hardcoded
- `.env` file excluded from any git repository
- Telegram user ID whitelist — silently ignore all messages from non-whitelisted users
- HTTPS for webhook endpoint
- No sensitive message content in logs (messages may contain personal/financial info)

**Notion API Specifics**
- Always GET before PATCH on rich_text fields (Notion replaces, doesn't append)
- Process file attachments sequentially to avoid race conditions on File Links field
- Handle 429 rate limits with exponential backoff
- Use Notion-Version: 2022-06-28 header

**Cost Awareness**
- Use Haiku for simple classification tasks (intent parsing, intent shift detection)
- Use Sonnet only for complex tasks (title generation, stream inference with full context)
- Zero API calls during note buffering — this is a core design principle
- One Claude call per note save, always

---

## HOW I MAKE DECISIONS — BRYAN'S INSTRUCTIONS

Bryan is not deeply technical. He needs to understand decisions, not just have them made for him. Follow this approach:

**For routine decisions** (standard patterns, common implementations, clear best practices): build it the right way and document the decision in DECISIONS.md with a brief explanation. No need to stop and ask.

**For significant decisions** (architecture choices, third-party integrations, anything hard to change later, anything with meaningful tradeoffs): STOP before building. Present to Bryan:
- What the decision is, in plain English
- Option A and Option B (or more) — pros and cons in plain English
- Your recommendation and why
- What happens if we choose wrong and need to undo it (effort and risk level)

Then wait for Bryan's go-ahead before proceeding.

**When in doubt:** ask. Bryan would rather be consulted one too many times than have a hard-to-reverse decision made without him.

**Always explain like a senior consultant** — not just "I did X" but "I did X because Y, and the alternative was Z which I ruled out because W."

---

## BUILD PHASES — ALWAYS FOLLOW THIS ORDER

Never build everything at once. Complete and confirm each phase before starting the next.

| Phase | What Gets Built | Bryan's Role |
|---|---|---|
| 1. Foundation | Project setup, folder structure, SQLite schema, Notion DB creation (via MCP), Telegram webhook, auth (user ID whitelist), PM2 + Nginx config, Git + GitHub | Test: does bot respond? Does user whitelist work? |
| 2. Todo Module | ADD_TODO, COMPLETE_TODO, LIST_TODOS, UPDATE_TODO, stream routing, Notion integration | Test: add/complete/list tasks from Telegram |
| 3. Quick Notes Module | Draft buffer, save/discard, intent shift, reminders, promote-to-task (NO voice yet) | Test: send notes, promote to task |
| 4. Scheduler & Briefings | Unified scheduler, recurring tasks, daily briefing (08:00), weekly review (Sun 20:00) | Test: do briefings arrive on time? Recurring tasks created? |
| 5. File Handling | Google Drive upload, Office→PDF conversion, ATTACH_FILE intent, file linking to tasks | Test: send file, verify in Drive + Notion |
| 6. Bot 2 — Receipts | Claude Vision extraction, Google Sheets logging, Drive storage, expense queries | Test: send receipt photo, verify in Sheets + Drive |
| 7. Polish & Hardening | Error handling edge cases, health check command, crash recovery, security audit | Does everything survive a VPS restart? |

At the end of each phase: update STATUS.md with timestamp, commit to GitHub with a clear message, confirm with Bryan before proceeding to the next phase.

---

## GITHUB — BRANCH STRATEGY

**Repository:** https://github.com/bryanchong32/telegram-bot.git

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Live production code | Never commit directly. Only receives merges from `dev` after Bryan's sign-off |
| `dev` | Active development | All day-to-day building happens here |
| `feature/[name]` | Individual features | Branch off `dev`, merge back to `dev` when complete |

**The flow:**
`feature/[name]` → `dev` → `main` (production)

No staging branch needed — single-user personal tool. Bryan tests on dev, approves, merge to main.

**Commit message format:** `[type]: [short description]`
Types: `feat`, `fix`, `docs`, `security`, `refactor`, `deploy`
Examples: `feat: add draft buffer with SQLite persistence` / `fix: intent shift detection false positives` / `docs: update schema after adding scheduled_jobs`

---

## VPS PORT ALLOCATION

| Service | Port | PM2 Process Name |
|---|---|---|
| ECOMWAVE CRM (production) | 3001 | ecomwave-crm |
| ECOMWAVE CRM (staging) | 3002 | ecomwave-crm-staging |
| **Telegram Bots** | **3003** | **telegram-bots** |

Do not use ports 3001 or 3002 — they are taken by the CRM app.

---

## DOCUMENTATION — MAINTAINED FILES

Update the relevant file at the end of every session. All entries must include a timestamp.

| File | What Goes In It | Updated When |
|---|---|---|
| CLAUDE.md | This file — project context, stack, standards, status | Every session |
| DECISIONS.md | Every significant decision, alternatives, reasoning | When a decision is made |
| SCHEMA.md | SQLite tables + Notion DB schemas | When schema changes |
| STATUS.md | What's done, in progress, next, blockers | Every session |
| ARCHITECTURE.md | System structure, folder guide, dependencies | When structure changes |

---

## SESSION RITUAL — START OF EVERY SESSION

Before writing any code:
1. Read this entire CLAUDE.md
2. Read STATUS.md to understand where we left off
3. Confirm to Bryan:

*"I've read the project context. Here's my understanding:*
*— Last session ([YYYY-MM-DD HH:MM MYT]): [what was done]*
*— Current phase: [phase]*
*— Today's goal: [what Bryan has asked for]*
*— My plan: [brief step-by-step of what I'll do]*

*Shall I proceed, or would you like to adjust anything?"*

4. Wait for Bryan to confirm before writing any code.

---

## SESSION RITUAL — END OF EVERY SESSION

When today's goal is complete, I must remind Bryan to close the session properly. Say:

---

*"Today's work is done. Before we close, I need a few minutes to update the project docs and commit everything to GitHub. Shall I go ahead?"*

---

Once Bryan confirms, execute in this order:

1. Commit all changes to GitHub with a descriptive commit message
2. Update STATUS.md with timestamp — mark completed, update in-progress, list next steps
3. Update DECISIONS.md with timestamp if any decisions were made this session
4. Update SCHEMA.md with timestamp if the database changed
5. Update ARCHITECTURE.md with timestamp if the system structure changed
6. Update the "Last Updated" timestamp at the top of this CLAUDE.md

Then summarise to Bryan:

*"All done. Here's the session wrap-up ([YYYY-MM-DD HH:MM MYT]):*
*— Completed: [list]*
*— Committed to GitHub: [commit message(s)]*
*— Docs updated: [list of files updated]*
*— Next session: [what's coming up]*
*— Pending your decision: [list or 'none']*"*

---

## CURRENT PROJECT STATUS

*(Updated by Claude Code each session with timestamp — never manually edited by Bryan)*

**Phase:** Phase 3 Complete — ready for Phase 4 (Scheduler & Briefings)
**Last Updated:** 2026-02-24 14:00 MYT

**Completed:**
- 2026-02-24 — Specs written: telegram-bots-plan.md, notion-todo-spec.md, notion-quicknotes-spec.md
- 2026-02-24 — Cross-doc audit completed: 10 conflicts identified, 10 architectural decisions made
- 2026-02-24 — PRD finalized (v1.0)
- 2026-02-24 — Project docs created: CLAUDE.md, DECISIONS.md, SCHEMA.md, STATUS.md, ARCHITECTURE.md
- 2026-02-24 — GitHub repo created: https://github.com/bryanchong32/telegram-bot.git
- 2026-02-24 — Telegram bots created via @BotFather (tokens ready, not yet in .env)
- 2026-02-24 — Notion integration created (internal, workspace: Bryan's Notion)
- 2026-02-24 12:15 — Phase 1 Foundation complete: scaffolding, all deps (latest), SQLite (3 tables), both bots running (grammY + Express), health check, Notion DBs created, PM2/Nginx configs, Git initialized on `dev` branch
- 2026-02-24 13:00 — Phase 2 Todo Module complete: intent engine (Haiku), stream router, all 4 todo handlers (ADD/COMPLETE/LIST/UPDATE), Notion CRUD, queryDatabase helper, dev startup robustness (409 retry). All intents tested from Telegram.
- 2026-02-24 14:00 — Phase 3 Quick Notes Module complete: draft buffer (SQLite, 5s timer, 1hr timeout, intent shift detection), notes handlers (ADD_NOTE, SET_REMINDER, LIST_NOTES, PROMOTE_TO_TASK), Notion Quick Notes CRUD, draft Save/Discard callbacks. UX: persistent reply keyboard (6 buttons), /help command, setMyCommands, /ideas + /reminders shortcuts. Tested from Telegram.

**In Progress:**
- None

**Next Up:**
- Phase 4: Scheduler & Briefings — unified scheduler worker, recurring tasks, daily briefing (08:00), weekly review (Sun 20:00), reminder delivery with Done/Snooze buttons

**Pending Bryan's Action:**
- Set up Notion Board view in Master Tasks database (manual — Notion API doesn't create views)

**Known Issues / Blockers:**
- Google OAuth credentials needed for Drive + Sheets (deferred to Phase 5/6)
- Voice notes (Whisper) deferred — no OpenAI API key needed yet
- VPS deployment deferred until ready for production testing (Nginx domain + SSL setup needed)

---

## KEY DECISIONS LOG

*(Append only — never delete. Most recent at top.)*

| Timestamp (MYT) | Decision | Alternatives Considered | Reason Chosen | Effort to Reverse |
|---|---|---|---|---|
| 2026-02-24 14:00 | Intent shift only after 5s preview shown | Check on every message | Within 5s rapid-fire → just append (zero cost). After preview shown → Haiku shift check. Safe fallback: assume continues_draft on failure. | Low |
| 2026-02-24 14:00 | Persistent reply keyboard for UX | Text-only interface | 6-button keyboard + setMyCommands + /help. Bryan found features hard to discover. Zero API cost for button taps. | Low |
| 2026-02-24 13:00 | Raw REST for Notion database queries | Use @notionhq/client dataSources.query() | @notionhq/client v5.x removed databases.query(). Built queryDatabase() helper calling POST /databases/{id}/query via fetch. | Low |
| 2026-02-24 13:00 | 409 conflict retry on dev startup | Crash on conflict | Telegram keeps stale polling connections ~30s. Added deleteWebhook + startBotWithRetry (5 attempts, 5s delay). | Low |
| 2026-02-24 13:00 | Haiku for UNKNOWN intent fallback | Sonnet | Only needs 1-3 sentences of suggestions. No complex reasoning. Keeps costs minimal. | Low |
| 2026-02-24 12:10 | grammY as bot framework | node-telegram-bot-api | More actively maintained, built-in webhook adapter, first-class callback_query support. Bryan approved. | Low |
| 2026-02-24 12:10 | Notion DB creation via API script (not MCP) | MCP server, manual creation | Direct API script simpler for a one-time operation. Script saved in scripts/ for reference. | Low |
| 2026-02-24 | Defer voice notes (Whisper) to Phase 2 | Include in Phase 1 MVP | Not a core need right now. Saves an OpenAI API key setup and dependency. Can add later by adding openai package + OPENAI_API_KEY env var. Notes module keeps Voice as a type — just not triggered yet. | Low |
| 2026-02-24 | Node.js as single runtime | Python, mixed stack | Specs lean Node (better-sqlite3, @notionhq/client, node-cron all referenced). Telegram bot ecosystem mature in Node. Single runtime = one process, simpler VPS. | Medium |
| 2026-02-24 | Draft buffer takes priority over global intent engine | Global intent engine first | Natural UX — mid-note, you don't want "remind me" swallowed by global router. Buffer checks first, releases to global only on intent shift. | Low |
| 2026-02-24 | Unified scheduled_jobs table | Separate recurring_tasks + reminders + briefing tables | One table, one worker, one query. Type column distinguishes job kind. cron_expr for recurring, one-shot for reminders. Simpler than 3 workers checking 3 tables. | Low |
| 2026-02-24 | Save/Discard as Telegram callback_query, not Claude intents | Classify as intents via Claude | These are button taps, not natural language. Callback_query is instant, free (no API call), and keeps intent engine clean for NLP-only classification. | Low |
| 2026-02-24 | Shared streamRouter module | Separate routing in each module | One keyword→stream map, one confidence threshold. Todos default to Personal on low confidence; Notes leave blank. Router returns {stream, confidence}, caller decides fallback. | Low |
| 2026-02-24 | Composable daily briefing | Monolithic briefing function | Each module contributes a section. Calendar placeholder returns empty until Phase 2 spec is written. Extensible without rewriting. | Low |
| 2026-02-24 | Port 3003 for Telegram Bots | Other ports | 3001 and 3002 taken by ECOMWAVE CRM (prod + staging). 3003 is next sequential, easy to remember. | Low |
| 2026-02-24 | 2-branch Git strategy (dev + main) | 4-branch (ECOMWAVE style with staging) | Single-user personal tool — no client UAT needed. Bryan tests on dev, approves, merges to main. Feature branches off dev as needed. | Low |
| 2026-02-24 | Notion DB creation via MCP (not manual) | Create manually in Notion UI | Claude Code can create both databases programmatically with all properties, select options, and views matching SCHEMA.md exactly. Faster and less error-prone. | Low |

---

## DATABASE SCHEMA

**Last Updated:** 2026-02-24 00:00 MYT
**Overview:** Local SQLite for draft buffer, scheduler, and fallback queue. Notion as source of truth for tasks and notes.

**SQLite Tables (3):** draft_buffer, scheduled_jobs, pending_sync
**Notion Databases (2):** Master Tasks, Quick Notes

**Full schema detail:** See SCHEMA.md

---

## ENVIRONMENT VARIABLES REQUIRED

**Last Updated:** 2026-02-24 00:00 MYT
*(Variable names only — never put actual values in this file)*

```
# Telegram
TELEGRAM_BOT1_TOKEN=          # From @BotFather (Bryan has these ready)
TELEGRAM_BOT2_TOKEN=          # From @BotFather (Bryan has these ready)
ALLOWED_TELEGRAM_USER_ID=     # Bryan's Telegram user ID (get via @userinfobot)

# Notion
NOTION_TOKEN=                 # From notion.so/my-integrations (internal integration)
NOTION_TASKS_DB_ID=           # Created via API script — Session 1 (2026-02-24)
NOTION_QUICKNOTES_DB_ID=      # Created via API script — Session 1 (2026-02-24)

# Anthropic (Claude)
ANTHROPIC_API_KEY=            # Already exists (shared with ECOMWAVE)

# Google (Drive + Sheets — needed from Phase 5 onwards)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GDRIVE_TASK_REFS_FOLDER_ID=
GDRIVE_RECEIPTS_FOLDER_ID=
GSHEETS_EXPENSE_LOG_ID=

# App
NODE_ENV=
PORT=3003
TZ=Asia/Kuala_Lumpur
```

---

## ARCHITECTURE & FOLDER STRUCTURE

**Last Updated:** 2026-02-24 00:00 MYT

```
telegram-bots/                # Project root
├── CLAUDE.md                 # This file — persistent project context
├── PRD.md                    # Product requirements document
├── DECISIONS.md              # Architectural decisions log
├── SCHEMA.md                 # Full database + Notion schema reference
├── STATUS.md                 # Build status and session log
├── ARCHITECTURE.md           # System structure and dependency registry
├── .env                      # Never committed to GitHub
├── .env.example              # Committed — shows required variables without values
├── .gitignore
├── package.json
├── docs/                     # Original spec documents
│   ├── telegram-bots-plan.md
│   ├── notion-todo-spec.md
│   └── notion-quicknotes-spec.md
├── src/
│   ├── index.js              # Entry point — initialise both bots + scheduler
│   ├── bot1/                 # Personal Assistant
│   │   ├── bot.js            # Telegram bot setup + webhook
│   │   ├── router.js         # Master message router (auth → type → buffer/intent)
│   │   ├── intentEngine.js   # Claude intent classification
│   │   ├── streamRouter.js   # Shared keyword → stream mapping
│   │   ├── todo/
│   │   │   ├── handlers.js   # ADD_TODO, COMPLETE_TODO, LIST_TODOS, UPDATE_TODO
│   │   │   └── notion.js     # Notion Master Tasks DB read/write
│   │   ├── notes/
│   │   │   ├── handlers.js   # ADD_NOTE, LIST_NOTES, PROMOTE_TO_TASK
│   │   │   ├── buffer.js     # Draft buffer state machine
│   │   │   └── notion.js     # Notion Quick Notes DB read/write
│   │   ├── files/
│   │   │   ├── handlers.js   # ATTACH_FILE intent
│   │   │   ├── drive.js      # Google Drive upload
│   │   │   └── convert.js    # Office → PDF conversion (LibreOffice)
│   │   └── briefing/
│   │       ├── daily.js      # 08:00 morning briefing composer
│   │       └── weekly.js     # Sunday 20:00 weekly review composer
│   ├── bot2/                 # Receipt & Expense Tracker
│   │   ├── bot.js            # Telegram bot setup + webhook
│   │   ├── router.js         # Message router
│   │   ├── vision.js         # Claude Vision receipt extraction
│   │   ├── sheets.js         # Google Sheets append
│   │   └── drive.js          # Google Drive receipt upload
│   ├── shared/
│   │   ├── db.js             # SQLite connection (better-sqlite3)
│   │   ├── scheduler.js      # Unified scheduler worker (checks every 60s)
│   │   ├── pendingSync.js    # Fallback queue retry worker
│   │   ├── auth.js           # User ID whitelist check
│   │   └── config.js         # Environment variables + constants
│   └── utils/
│       ├── notion.js         # Notion API helpers (retry, rate limit)
│       ├── anthropic.js      # Claude API wrapper (Haiku/Sonnet routing)
│       ├── dates.js          # Date formatting, timezone helpers
│       └── logger.js         # Structured logging (no sensitive content)
└── data/
    └── bot.db                # SQLite database file (gitignored)
```

**Full dependency detail:** See ARCHITECTURE.md

---

## NOTES & MISCELLANEOUS

*(Anything that doesn't fit above — edge cases, things to remember)*

- 2026-02-24 — VPS is shared with ECOMWAVE CRM. PM2 runs under `deploy` user — NEVER run PM2 as root. Use separate PM2 process names. This project = `telegram-bots` on port 3003.
- 2026-02-24 — Timezone is UTC+8 (Asia/Kuala_Lumpur) everywhere. All cron expressions, all date comparisons, all briefing triggers.
- 2026-02-24 — Notion API replaces rich_text on PATCH — always GET first, append, then PATCH. Process file attachments sequentially.
- 2026-02-24 — Stream routing: Todos default to Personal on low confidence. Notes leave stream blank on low confidence. Same router module, different fallback behavior.
- 2026-02-24 — Save/Discard buttons are Telegram callback_query events (data: `draft:save`, `draft:discard`), NOT Claude-classified intents.
- 2026-02-24 — Calendar module deferred to Phase 2. Daily briefing has a placeholder section that returns empty until calendar spec is written.
- 2026-02-24 — Voice notes (Whisper) deferred to Phase 2. Notes module keeps Voice as a type but no transcription pipeline yet. When ready: add `openai` npm package + `OPENAI_API_KEY` env var.
- 2026-02-24 — Anthropic API key can be reused from ECOMWAVE CRM — same key works.
