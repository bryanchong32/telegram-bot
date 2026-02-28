# Request Agent Bot — Design Document

| Field | Value |
|---|---|
| Date | 2026-02-28 |
| Spec | REQ-001-Request-Agent-CC-Instructions.md |
| Status | Draft |

## Overview

A new Telegram bot module ("Request Agent") within the `telegram-bot` repo. Receives a single markdown file via Telegram, parses frontmatter + three document sections, commits the three documents to the correct GitHub project repo, creates a Notion database entry, and confirms completion via Telegram.

Runs as a **separate PM2 process** (port 3004), fully independent from the existing Bot 1 (Nami) and Bot 2 (Scannko).

## Key Architecture Decisions

### 1. Separate PM2 process (not shared process)

The Request Agent runs as its own Node.js process with its own Express server, webhook endpoint, and PM2 entry. This means:

- **Own config loader** — cannot reuse `src/shared/config.js` because that file `required()`s env vars for Bot 1/2 (Gemini, Google OAuth, etc.) that the Request Agent doesn't need. Importing it would crash on startup.
- **Own logger, notion client, auth middleware** — these depend on `src/shared/config.js`, so bot3 re-implements the same patterns with its own config. The code is small (~30-50 lines each) and the duplication is the correct trade-off for process isolation.
- **Own Express server** on port 3004 with `/webhook/request-agent` route.
- **Own PM2 entry** in `ecosystem.config.js`.
- **Own Nginx location block** proxying to 3004.

### 2. Raw fetch for GitHub API (no Octokit)

Uses the GitHub Git Data API (trees/blobs/commits) via native `fetch()`. Only 5 API calls per commit — a thin wrapper module is sufficient.

### 3. gray-matter for frontmatter parsing

One new dependency. Battle-tested YAML frontmatter parser. The rest of the pipeline is string splitting.

### 4. Reuse existing @notionhq/client

Already installed. Bot3 creates its own `Client` instance pointed at the same `NOTION_TOKEN`.

## File Structure

```
src/
  bot3/
    index.js        ← Entry point (Express + webhook/polling + graceful shutdown)
    config.js       ← Environment variable loader (bot3-specific)
    bot.js          ← grammY Bot instance + auth middleware + router registration
    router.js       ← /start, /help commands + document message handler
    parser.js       ← Frontmatter extraction (gray-matter) + 3-section splitting
    github.js       ← GitHub Git Data API wrapper (create multi-file commit)
    notion.js       ← Notion page creation for request tracking databases
    projects.js     ← Project config mapping { project_key → github_repo, notion_db_id, ... }
```

## Module Details

### config.js

Follows the same `required()` / `optional()` pattern as `src/shared/config.js` but only loads what bot3 needs:

```
REQUEST_AGENT_BOT_TOKEN  (required)
ALLOWED_TELEGRAM_USER_ID (required)
NOTION_TOKEN             (required)
GITHUB_TOKEN             (required — NEW)
NODE_ENV                 (optional, default 'development')
PORT                     (optional, default 3004)
TZ                       (optional, default 'Asia/Kuala_Lumpur')
```

### bot.js

Identical pattern to `src/bot2/bot.js`:
- Creates grammY `Bot` instance with `REQUEST_AGENT_BOT_TOKEN`
- Inlines auth middleware (same whitelist logic, ~10 lines — not worth importing shared/config chain)
- Registers router
- Sets bot commands menu
- Global error handler

### router.js

Handles:
- `/start` — welcome message explaining what the bot does
- `/help` — usage instructions
- `message:document` — main pipeline (validate → parse → GitHub → Notion → confirm)
- `message` (anything else) — friendly "send me a .md file" nudge

The document handler orchestrates the full pipeline with step-by-step error tracking.

### parser.js

Two functions:
1. **parseFrontmatter(content)** — uses `gray-matter` to extract frontmatter object + body. Validates all 8 required fields are present. Returns `{ meta, body }` or throws with list of missing fields.
2. **splitSections(body)** — splits body into 3 sections by detecting `# PRD`, `# DECISION NOTES`, `# CLAUDE CODE INSTRUCTIONS` headers. Strips `---` separators between sections. Validates each section has content. Returns `{ prd, decisionNotes, ccInstructions }`.

### github.js

Single main function: `commitFiles({ owner, repo, branch, files, message })`

Uses the Git Data API (low-level, no working directory):
1. `GET /repos/:owner/:repo/git/ref/heads/:branch` → current commit SHA
2. `GET /repos/:owner/:repo/git/commits/:sha` → base tree SHA
3. `POST /repos/:owner/:repo/git/trees` → new tree with 3 file blobs (inline base64 content)
4. `POST /repos/:owner/:repo/git/commits` → new commit
5. `PATCH /repos/:owner/:repo/git/ref/heads/:branch` → update branch pointer

Includes a `githubFetch()` helper that handles auth headers, JSON parsing, and error formatting. No retry logic — GitHub API is reliable and failures should surface immediately to the user.

### notion.js

Single function: `createRequestEntry({ meta, githubUrls, projectConfig })`

Creates a Notion database page with properties mapped per the spec:
- title, rich_text, select, date, url property types
- Status always set to "Scoped"
- GitHub URLs constructed from committed file paths

Uses `@notionhq/client` `Client` with `withRetry()` pattern (same as existing `src/utils/notion.js`).

### projects.js

JS object (not YAML/JSON file — matches repo convention):

```js
module.exports = {
  'ecomwave-crm': {
    github_repo: 'bryanchong32/mom-crm-webapp',
    github_branch: 'main',
    notion_database_id: '<placeholder>',
    docs_path: 'docs/requests',
  },
  'telegram-bot': {
    github_repo: 'bryanchong32/telegram-bot',
    github_branch: 'main',
    notion_database_id: '<placeholder>',
    docs_path: 'docs/requests',
  },
};
```

### index.js

Entry point for the PM2 process. Mirrors `src/index.js` but simpler (no SQLite, no scheduler, no pending sync):

1. Create Express app with JSON body parsing
2. Health endpoint (`GET /health`)
3. Production: register webhook route (`POST /webhook/request-agent`)
4. Development: delete webhook, start long polling with 409 retry
5. Start Express server on configured port
6. Graceful shutdown handler (SIGTERM/SIGINT)
7. Process-level error handlers

## Environment Variables

Added to `.env` and `.env.example`:

```
# Request Agent
REQUEST_AGENT_BOT_TOKEN=
GITHUB_TOKEN=
```

`NOTION_TOKEN` already exists — reused.

## Deployment Changes

### ecosystem.config.js

Add second app entry:

```js
{
  name: 'request-agent',
  script: 'src/bot3/index.js',
  cwd: '/home/deploy/telegram-bots',
  env: {
    NODE_ENV: 'production',
    PORT: 3004,
    TZ: 'Asia/Kuala_Lumpur',
  },
  max_restarts: 10,
  min_uptime: '10s',
  restart_delay: 5000,
  error_file: '/home/deploy/telegram-bots/logs/request-agent-error.log',
  out_file: '/home/deploy/telegram-bots/logs/request-agent-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
  watch: false,
}
```

### Nginx

New location block in existing server config:

```nginx
location /webhook/request-agent {
    proxy_pass http://127.0.0.1:3004;
}
```

### Webhook registration

New script or extend existing `scripts/set-webhooks.js` to register bot3's webhook URL:
`https://ecomwave.duckdns.org/webhook/request-agent`

## Processing Pipeline (error handling)

Each step tracks success/failure. On failure:
- Report which step failed with clear error message
- Report any steps that already succeeded (partial success awareness)
- User can fix and resend

```
Step 1: Validate .md extension
Step 2: Download file from Telegram
Step 3: Parse frontmatter (report missing fields)
Step 4: Validate project exists in config (list valid projects)
Step 5: Split into 3 sections (report missing sections)
Step 6: Validate sections have content
Step 7: Commit to GitHub
Step 8: Create Notion entry
Step 9: Send confirmation
```

If Step 7 (GitHub) succeeds but Step 8 (Notion) fails → report partial success.

## Dependencies

- **New:** `gray-matter` (frontmatter parsing)
- **Existing:** `grammy`, `@notionhq/client`, `express`, `dotenv`

## Documentation Updates

- Update `ARCHITECTURE.md` — add Bot 3 section with system diagram
- Update `.env.example` — add new env vars
- Update `DEPLOY.md` — add request-agent PM2 process + Nginx config
- Create example `.md` input file for testing

## Out of Scope

Per spec: no status commands, no auto-incrementing IDs, no AI processing, no Google Drive, no web UI, no batch processing, no modifications to existing bot modules.
