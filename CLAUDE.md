# CLAUDE.md — Project Context
# Telegram Bots | Owner: Bryan
# Last Updated: 2026-02-28 MYT | Updated By: Claude Code

---

## HOW INSTRUCTIONS ARE ORGANIZED

Three systems govern how this project is built. Do not duplicate their responsibilities:

1. **Superpowers plugin** — handles HOW to build: brainstorming, task planning, testing, code review, verification. Follow Superpowers methodology for all implementation work.
2. **This CLAUDE.md** — provides WHO you're building for, project context, and project-specific rules.
3. **Reference docs** — SCHEMA.md (database/Notion schema), ARCHITECTURE.md (system structure), DECISIONS.md (design rationale), DEPLOY.md (VPS deployment guide).

If Superpowers and this file conflict on a project-specific rule, this file takes priority.

All timestamps use format: YYYY-MM-DD HH:MM MYT (Malaysia Time)

---

## PROJECT OVERVIEW

**Project Name:** Telegram Bots — Personal Assistant + Receipt Tracker
**Owner:** Bryan (personal project)
**Project Started:** 2026-02-24
**What This System Does:** Two Telegram bots on a single VPS. Bot 1 is a personal assistant — captures todos, quick notes, reminders, and sends daily/weekly briefings via Notion. Bot 2 is a receipt tracker — receipt photo/PDF → OCR/Vision extraction → Google Sheets log + Google Drive storage. Both bots are single-user (Bryan only).
**VPS:** Hetzner (same server as ECOMWAVE CRM — 5.223.49.206)
**Domain:** bryan-bots.duckdns.org

---

## WHO I AM WORKING FOR

Bryan is the sole user. He has a business and finance background, not a technical one.

Bryan's role: product decisions, QA testing, documentation review.
My role (Claude Code): building, coding, deployment, and maintaining all technical documentation.

When I make technical decisions, I must explain them clearly enough that Bryan can understand and audit them.

---

## DECISION-MAKING RULES

**Routine decisions** (standard patterns, clear best practices): Build it the right way and document in DECISIONS.md. No need to stop and ask.

**Significant decisions** (architecture, integrations, anything hard to reverse): STOP before building. Present to Bryan in plain English: what the decision is, options with pros/cons, your recommendation, and effort to reverse. Wait for approval.

When in doubt, ask. Bryan would rather be consulted one too many times than have a hard-to-reverse decision made without him.

Always explain like a senior consultant — not just "I did X" but "I did X because Y, and the alternative was Z which I ruled out because W."

---

## TECH STACK

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js | Single runtime for both bots |
| Bot Framework | grammY v1.40.0 | Telegram Bot API wrapper |
| Database (local) | SQLite via better-sqlite3 | Draft buffer, scheduler, fallback queue |
| Database (primary) | Notion API via @notionhq/client | Master Tasks DB + Quick Notes DB — source of truth |
| AI — Intent & Text | Google Gemini 2.0 Flash via @google/genai | Intent parsing, title generation, stream inference |
| AI — OCR | Google Cloud Vision API | Receipt image text extraction |
| File Storage | Google Drive API via googleapis | Task reference files + receipt images |
| Expense Log | Google Sheets API via googleapis | Receipt data rows (Bot 2) |
| Scheduler | node-cron | Trigger check every 60s against scheduled_jobs table |
| Process Manager | PM2 | Runs under `deploy` user (NOT root) |
| Reverse Proxy | Nginx | Webhook endpoint, HTTPS via Let's Encrypt |
| Hosting | Hetzner VPS (5.223.49.206) | Shared with ECOMWAVE CRM |

Do not introduce any technology outside this stack without flagging it to Bryan first. If an external library or tool is needed, explain: what it does, why it's needed, what the alternative is, and your recommendation with reasoning. Wait for Bryan's approval before adding it.

---

## PROJECT-SPECIFIC RULES

These are rules specific to this project that Superpowers doesn't know about:

**Security — always enforce:**
- All secrets in environment variables — never hardcoded
- `.env` excluded from git
- Telegram user ID whitelist — silently ignore all messages from non-whitelisted users
- HTTPS for webhook endpoint
- No sensitive message content in logs (messages may contain personal/financial info)

**Dependencies:**
- Keep external dependencies minimal
- Before adding any npm package: can this be done natively or with what we already have?
- If added, document in ARCHITECTURE.md with reason and date

**Notion API:**
- Always GET before PATCH on rich_text fields (Notion replaces, doesn't append)
- Process file attachments sequentially to avoid race conditions on File Links field
- Handle 429 rate limits with exponential backoff

**Cost Awareness:**
- Gemini 2.0 Flash is the only model used — cheap for all tasks
- Zero API calls during note buffering — core design principle
- One Gemini call per note save, always

**PM2 deployment:**
- PM2 runs under `deploy` user, NOT root
- Always deploy with `su - deploy -c 'pm2 restart telegram-bots'`
- Running PM2 as root creates a separate daemon that conflicts

---

## GIT & DEPLOYMENT

**Repository:** https://github.com/bryanchong32/telegram-bot.git

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Live production code | Never commit directly. Only merges from `dev` after Bryan's sign-off |
| `dev` | Active development | All day-to-day building happens here |
| `feature/[name]` | Individual features | Branch off `dev`, merge back to `dev` when complete |

**Flow:** `feature/[name]` → `dev` → `main` (production)

**Commit format:** `[type]: [short description]`
Types: `feat`, `fix`, `docs`, `security`, `refactor`, `deploy`

**VPS paths:**
- Production app: `/home/deploy/telegram-bots/`
- Port: 3003 internal, Nginx proxies 443 → 3003

---

## DOCUMENTATION FILES

Update relevant files at the end of every session with timestamps.

| File | Purpose | Updated When |
|---|---|---|
| CLAUDE.md | Project context (this file) | When context changes |
| DECISIONS.md | Significant decisions with reasoning | When decisions are made |
| SCHEMA.md | SQLite tables + Notion DB schemas | When schema changes |
| ARCHITECTURE.md | System structure, dependencies | When structure changes |
| DEPLOY.md | VPS deployment guide | When deploy process changes |

Full decisions history: see DECISIONS.md

---

## ENVIRONMENT VARIABLES

*(Names only — never put actual values here)*

```
# Telegram
TELEGRAM_BOT1_TOKEN=
TELEGRAM_BOT2_TOKEN=
ALLOWED_TELEGRAM_USER_ID=

# Notion
NOTION_TOKEN=
NOTION_TASKS_DB_ID=
NOTION_QUICKNOTES_DB_ID=

# Gemini (intent parsing, text tasks)
GEMINI_API_KEY=

# Google Cloud Vision (receipt OCR)
GOOGLE_CLOUD_API_KEY=

# Google (Drive + Sheets)
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

## ARCHITECTURE SUMMARY

Two Telegram bots sharing a single Node.js process. Bot 1 handles personal productivity (todos, notes, reminders, briefings via Notion). Bot 2 handles receipt tracking (OCR → Google Sheets + Drive). Bot 3 (Request Agent) runs as a separate PM2 process — handles scoped (.md file) and quick (text message) requests, logging to Notion with optional GitHub commits. Full detail in ARCHITECTURE.md.

```
telegram-bot/
├── CLAUDE.md, DECISIONS.md, SCHEMA.md, ARCHITECTURE.md, DEPLOY.md
├── ecosystem.config.js          # PM2 config
├── src/
│   ├── index.js                 # Entry point — initialise both bots + scheduler
│   ├── bot1/                    # Personal Assistant
│   │   ├── bot.js               # grammY bot setup + webhook
│   │   ├── router.js            # Message router (auth → type → buffer/intent)
│   │   ├── intentEngine.js      # Gemini intent classification
│   │   ├── streamRouter.js      # Keyword → stream mapping
│   │   ├── todo/                # handlers.js, notion.js
│   │   ├── notes/               # handlers.js, buffer.js, notion.js
│   │   ├── files/               # handlers.js, drive.js, convert.js, notionFiles.js
│   │   └── briefing/            # daily.js, weekly.js
│   ├── bot2/                    # Receipt & Expense Tracker
│   │   ├── bot.js, router.js    # grammY bot setup + routing
│   │   ├── vision.js            # Gemini Vision receipt extraction
│   │   ├── queries.js           # Expense query handling
│   │   ├── sheets.js            # Google Sheets append
│   │   └── drive.js             # Google Drive receipt upload
│   ├── shared/                  # db.js, scheduler.js, pendingSync.js, auth.js, config.js
│   └── utils/                   # gemini.js, ocr.js, google.js, notion.js, dates.js, health.js, logger.js
└── data/
    └── bot.db                   # SQLite database (gitignored)
```

---

## DATABASE SUMMARY

**SQLite Tables (3):** draft_buffer, scheduled_jobs, pending_sync
**Notion Databases (2):** Master Tasks, Quick Notes

Full schema: see SCHEMA.md

---

## PROJECT-SPECIFIC NOTES

*(Append only — never delete)*

- VPS is shared with ECOMWAVE CRM. PM2 runs under `deploy` user — NEVER run PM2 as root. This project = `telegram-bots` on port 3003.
- Timezone is UTC+8 (Asia/Kuala_Lumpur) everywhere. All cron expressions, all date comparisons, all briefing triggers.
- Notion API replaces rich_text on PATCH — always GET first, append, then PATCH. Process file attachments sequentially.
- Stream routing: Todos default to Personal on low confidence. Notes leave stream blank on low confidence. Same router module, different fallback behavior.
- Bot 3 quick requests support custom project names via "Other" button — custom names go to the shared Notion DB (`DEFAULT_NOTION_DB_ID` in router.js). `/cancel` command resets mid-flow state.
- Save/Discard buttons are Telegram callback_query events (data: `draft:save`, `draft:discard`), NOT Gemini-classified intents.
- AI stack migrated from Anthropic (Haiku/Sonnet) to Google Gemini 2.0 Flash + Cloud Vision OCR (Feb 2026). Old `anthropic.js` deleted.
- Receipt pipeline: Images → Cloud Vision OCR → Gemini text structuring. PDFs → Gemini multimodal directly.
