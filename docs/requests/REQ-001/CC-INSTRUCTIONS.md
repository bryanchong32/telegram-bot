# CLAUDE CODE INSTRUCTIONS

## 1. Objective

Build a new Telegram bot module ("Request Agent") within the existing `telegram-bot` repo. The bot receives a single markdown file via Telegram, parses it, commits three separate documents to the correct GitHub project repository, creates a Notion database entry with all properties populated, and confirms completion via Telegram.

## 2. Context

- **This is a new module in an existing multi-bot repo.** The `telegram-bot` repo already contains multiple bot modules (Nami for notes/tasks, Scannko for receipt scanning, notification logic). Inspect the existing repo structure — particularly `src/`, `ecosystem.config.js`, and `ARCHITECTURE.md` — and follow the same patterns for organizing, deploying, and running the Request Agent.
- **User flow:** Bryan finishes a scoping session in Claude Chat → downloads a single `.md` file → sends it to the Request Agent Telegram bot → bot files everything → Bryan picks up the build later in Claude Code.
- **Reference the existing Scannko bot** as the closest architectural parallel — it also receives file input (receipt photos), processes content, and writes to external APIs (Google Drive + Sheets). The Request Agent follows the same pattern but targets GitHub API + Notion API instead.

## 3. Technical Specification

### 3a. Input Format

The bot receives a markdown file with YAML frontmatter and three document sections. See the PRD section above for the full format specification.

**Frontmatter fields (all required):**

| Field | Type | Valid Values |
|---|---|---|
| request_id | string | Format: REQ-XXX |
| project | string | Must match a key in project config |
| title | string | Free text |
| type | string | Bug, Feature, Enhancement, UX/Polish, Refactor |
| priority | string | P1 Critical, P2 Important, P3 Backlog |
| effort | string | Small, Medium, Large |
| source | string | Own Testing, Client Feedback, Claude Chat Session, Code Review, User Report |
| date | string | YYYY-MM-DD |

### 3b. File Splitting Logic

Split by detecting top-level `#` headers:
- `# PRD` → content until `---` separator or `# DECISION NOTES`
- `# DECISION NOTES` → content until `---` separator or `# CLAUDE CODE INSTRUCTIONS`
- `# CLAUDE CODE INSTRUCTIONS` → content to end of file

Strip `---` separators between sections. Each output file starts with its header.

### 3c. Project Configuration

Create a config file for project mappings. Match whatever config format the existing repo uses.

```yaml
projects:
  ecomwave-crm:
    github_repo: bryanchong32/mom-crm-webapp
    github_branch: main
    notion_database_id: "<placeholder>"
    docs_path: "docs/requests"
  telegram-bot:
    github_repo: bryanchong32/telegram-bot
    github_branch: main
    notion_database_id: "<placeholder>"
    docs_path: "docs/requests"
```

Leave `notion_database_id` values as placeholders.

### 3d. GitHub Integration

Use GitHub REST API (or Octokit if already a dependency) to commit files.

**Per request, create three files in one commit:**
- `{docs_path}/{request_id}/PRD.md`
- `{docs_path}/{request_id}/DECISION-NOTES.md`
- `{docs_path}/{request_id}/CC-INSTRUCTIONS.md`

**Commit message:** `docs: add {request_id} - {title}`

**Auth:** `GITHUB_TOKEN` env var with `repo` scope. Must have access to all repos in config.

**Important:** The bot commits to OTHER repos (e.g., `mom-crm-webapp`), not just its own.

### 3e. Notion Integration

Use Notion API to create a database page.

| Notion Property | Type | Value |
|---|---|---|
| Request Title | title | `title` |
| Request ID | rich_text | `request_id` |
| Type | select | `type` |
| Priority | select | `priority` |
| Effort | select | `effort` |
| Status | select | Always "Scoped" |
| Source | select | `source` |
| Date Logged | date | `date` as ISO 8601 |
| PRD Link | url | GitHub URL to PRD.md |
| Decision Notes Link | url | GitHub URL to DECISION-NOTES.md |
| CC Instructions Link | url | GitHub URL to CC-INSTRUCTIONS.md |

**GitHub URL format:** `https://github.com/{github_repo}/blob/{github_branch}/{docs_path}/{request_id}/PRD.md`

Allow Notion API to create select options on the fly.

### 3f. Telegram Bot

Needs its own bot token: `REQUEST_AGENT_BOT_TOKEN` (or follow existing naming convention).

- Accept only `.md` files
- Pipeline: validate → parse → split → GitHub → Notion → confirm
- Confirmation format: ✅ with request ID, title, project, priority, effort, status
- Error format: ❌ with failed step, error detail, partial success report

### 3g. Environment Variables

Add to existing `.env` and `.env.example`:
```
REQUEST_AGENT_BOT_TOKEN=<telegram bot token>
GITHUB_TOKEN=<personal access token with repo scope>
NOTION_TOKEN=<notion integration token>
```

Reuse existing vars if they overlap.

### 3h. Processing Pipeline

1. Receive file from Telegram
2. Validate `.md` extension
3. Parse frontmatter, validate all required fields
4. Validate `project` exists in config
5. Split into three documents
6. Validate all three sections have content
7. Commit to GitHub (target project repo)
8. Construct GitHub URLs
9. Create Notion entry with properties + URLs
10. Send Telegram confirmation

On failure: stop, report failed step, report any successful steps.

### 3i. Deployment

Add as new process in `ecosystem.config.js` following existing pattern. Should run alongside other bots without disrupting them.

## 4. Constraints

- **Follow existing repo patterns.** Inspect structure, style, dependencies, and deployment BEFORE writing code.
- Secrets in env vars only
- Meaningful error messages returned via Telegram
- Minimal new dependencies — prefer what's already in the repo

## 5. Acceptance Criteria

- AC-1: Valid `.md` file → three files appear in correct GitHub repo under `docs/requests/{request_id}/`
- AC-2: Valid `.md` file → Notion entry created with all properties correct
- AC-3: Notion entry GitHub URLs link to actual committed files
- AC-4: Missing frontmatter field → specific validation error naming the missing field(s)
- AC-5: Invalid project name → error listing valid project names
- AC-6: Non-`.md` file → friendly rejection message
- AC-7: GitHub success + Notion failure → partial success report
- AC-8: Response within 10 seconds
- AC-9: Handles files up to 50KB
- AC-10: Runs in ecosystem.config.js alongside existing bots without disruption

## 6. Out of Scope

- Do NOT build `/status` or `/update` commands
- Do NOT build auto-incrementing request IDs
- Do NOT add AI/LLM processing
- Do NOT integrate with Google Drive
- Do NOT build web dashboard
- Do NOT add batch file processing
- Do NOT modify existing bot modules (Nami, Scannko, notifications)

## 7. Deliverables

- New Request Agent module following existing structural patterns
- Updated `ecosystem.config.js` with new bot process
- Updated `.env.example` with new environment variables
- Project config file with placeholder entries
- Example `.md` input file for testing
- Updated `ARCHITECTURE.md` to document the new module