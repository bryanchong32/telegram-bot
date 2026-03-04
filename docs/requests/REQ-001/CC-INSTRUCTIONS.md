# CLAUDE CODE INSTRUCTIONS

## Objective

Add five capabilities to Bot 3 (Request Agent): new project-prefixed ID format, `/unscoped` command, scoped-file-replaces-existing logic, custom project code prompt, and a one-time Notion migration script.

## Context

Bot 3 runs as a separate PM2 process (`request-agent`, port 3004). Key files:

- `src/bot3/router.js` — message routing, quick request flow, document processing pipeline
- `src/bot3/notion.js` — `createRequestEntry`, `createQuickEntry`, `getNextRequestId`
- `src/bot3/parser.js` — YAML frontmatter parsing + validation, section splitting
- `src/bot3/projects.js` — project config registry (repo, branch, Notion DB ID, docs path)
- `data/custom-projects.json` — persisted custom project names (currently string array)

Current quick request flow: text → project buttons → type buttons → priority buttons → `createQuickEntry` → Notion page with Status: Unscoped.

Current scoped file flow: `.md` file → parse frontmatter → validate project → split sections → commit to GitHub → `createRequestEntry` → Notion page with Status: Scoped.

Notion database has these relevant properties: `Request ID` (rich_text), `Status` (select: Unscoped/Scoped), `Project` (select), all URL link fields (`PRD Link`, `Decision Notes Link`, `CC Instructions Link`).

## Technical Specification

### 1. Project Code Configuration

**`src/bot3/projects.js`** — add `code` field to each project:

```
ecomwave-crm → code: 'ECW'
telegram-bot → code: 'TGB'
```

**`data/custom-projects.json`** — change format from string array to object array:

```json
[
  { "name": "some-project", "code": "SMP" }
]
```

On load, detect old format (string array) and migrate to new format automatically. If old format is found and no code exists, those legacy custom projects should still work but won't have a code until Bryan re-adds them. Log a warning.

**`router.js`** — update `loadCustomProjects`, `saveCustomProject`, `getAllProjectKeys` to handle new format. Add `getProjectCode(projectKey)` helper that checks hardcoded projects first, then custom projects, returns the code string.

### 2. New Request ID Format

**Format:** `{CODE}-REQ-{NNN}` where `NNN` is zero-padded to 3 digits.

**`src/bot3/notion.js` → `getNextRequestId`:**
- Accept a `projectCode` parameter (e.g., `'ECW'`)
- Query Notion filtering by Project, look at Request ID values
- Match against pattern `{CODE}-REQ-(\d+)` to find highest number
- Return next sequential ID: `{CODE}-REQ-{next}`
- Must also handle legacy `REQ-\d+` entries during transition — ignore them when counting for the new format

**`src/bot3/parser.js`:**
- Update `request_id` validation regex to accept both `REQ-\d+` (legacy) and `[A-Z]{2,4}-REQ-\d+` (new format)
- All other validation unchanged

**`src/bot3/router.js`:**
- Quick request flow: after priority is selected, call `getNextRequestId` with the project code
- Scoped file flow: no change to ID generation (ID comes from frontmatter)

### 3. `/unscoped` Command

**`src/bot3/router.js`** — register `/unscoped` command:

Step 1: Show inline buttons for each known project (hardcoded + custom). Callback data: `unscoped:project:{key}`.

Step 2: On project selection, query Notion database for pages where `Status = Unscoped` AND `Project = {selected project}`. Sort by Date Logged descending.

Step 3: Format and reply. Each item on its own line: `{Request ID} — {title} ({priority}, {date})`. If no results: "No unscoped requests for {project}."

**`src/bot3/notion.js`** — add `getUnscopedRequests(notionDatabaseId, project)`:
- Query Notion with filter: Status equals "Unscoped" AND Project equals `{project}`
- Sort by Date Logged descending
- Return array of `{ requestId, title, priority, date }`
- Handle pagination (loop through all pages)

### 4. Scoped File Replaces Existing Entry

**`src/bot3/notion.js`** — add `findRequestById(notionDatabaseId, requestId)`:
- Query Notion with filter: Request ID rich_text equals `{requestId}`
- Return `{ pageId, status, title }` if found, `null` if not
- This is used by the router to check for duplicates before filing

**`src/bot3/notion.js`** — add `updateRequestEntry({ pageId, meta, githubUrls })`:
- Calls `notion.pages.update` on the existing page
- Updates: Status → Scoped, all frontmatter fields (type, priority, effort, source, date), all three GitHub URL fields
- Does NOT update: Request Title (keep the original or update? — update it from the scoped file since the title may have been refined during scoping), Project (should match), Request ID (same)
- Actually: update Request Title too, since scoping may refine the title

**`src/bot3/router.js` → `handleDocument`:**

After parsing frontmatter and validating project (existing Steps 1–4), insert a new step:

- Call `findRequestById` with the request_id from frontmatter
- If found with status "Unscoped": store the pending replacement in a Map (keyed by chat ID), send confirmation message: `"{request_id} exists as Unscoped — replace with scoped version?\n\nExisting: {existing title}\nNew: {new title}"` with Yes/No inline buttons. Callback data: `replace:yes` / `replace:no`. Return (don't proceed with filing yet).
- If found with status "Scoped": same pattern but different message: `"{request_id} is already Scoped. Overwrite?\n\nExisting: {existing title}\nNew: {new title}"` with Yes/No buttons. Return.
- If not found: proceed with current create flow (no change).

Add callback handler for `replace:yes` and `replace:no`:
- `replace:yes`: retrieve pending data from Map, proceed with GitHub commit, then call `updateRequestEntry` instead of `createRequestEntry`. Send success message. Clear pending state.
- `replace:no`: reply "Cancelled." Clear pending state.
- Pending replace state expires after 5 minutes (same TTL pattern as quick requests).

### 5. Custom Project Code Prompt

**`src/bot3/router.js`** — modify the custom project flow:

Current flow: "Other" → "Type the project name:" → text input → type buttons → priority buttons → file.

New flow: "Other" → "Type the project name:" → text input → **"Short code for this project? (2–4 uppercase letters, e.g., SMP)"** → text input → validate (uppercase only, 2–4 chars, not already used by another project) → type buttons → priority buttons → file.

Add a new step value `custom_code` in the pending quick request state machine. After receiving the project name (current `custom_project` step), transition to `custom_code` instead of `type`.

Validation on code input:
- Must match `/^[A-Z]{2,4}$/`
- Must not match any existing project code (check both hardcoded and custom)
- On validation failure: reply with error and re-prompt

`saveCustomProject` updated to accept and store both name and code.

### 6. Migration Script

Create `scripts/migrate-request-ids.js`:

- Standalone Node.js script (not part of the bot runtime)
- Reads project config from `src/bot3/projects.js` to get project → code mapping
- Queries ALL pages in the Notion database
- For each page: read `Project` select value and `Request ID` rich_text
- If Request ID matches old format `REQ-\d+`: look up the project's code, construct new ID `{CODE}-REQ-{NNN}` keeping the same number, update the page's Request ID field
- If project has no code (unknown custom project): skip and log warning
- Dry-run mode by default (print changes without applying). Pass `--apply` flag to execute.
- Log every change: `REQ-001 → ECW-REQ-001 (page: {pageId})`

Run: `node scripts/migrate-request-ids.js` (dry run) then `node scripts/migrate-request-ids.js --apply`

## Constraints

- Notion API rate limits: use the existing `withRetry` pattern for all new Notion calls
- Do not add new npm dependencies — everything needed is already installed
- Bot 3 shares the same Notion token as Bot 1/2 (env: `NOTION_TOKEN`)
- The migration script must be safe to run multiple times (idempotent — skip entries already in new format)
- Maintain backward compatibility: parser must accept both old and new ID formats until all entries are migrated

## Acceptance Criteria

**AC-1:** Send `/unscoped` to Rekko → see project selection buttons → tap a project → see list of Unscoped requests for that project with ID, title, priority, and date. If none, see "No unscoped requests" message.

**AC-2:** Send a quick text request → go through project/type/priority flow → Notion entry created with new format ID (e.g., `ECW-REQ-004`). Counter is per-project and sequential.

**AC-3:** Send a scoped `.md` file with `request_id: ECW-REQ-004` where ECW-REQ-004 exists as Unscoped → Rekko shows confirmation with both titles → tap Yes → existing Notion entry updated to Status: Scoped with GitHub links populated. No duplicate entry created.

**AC-4:** Send a scoped `.md` file with a request_id that does NOT exist in Notion → normal create flow (current behavior, no confirmation needed).

**AC-5:** Send a scoped `.md` file with a request_id that exists as Scoped → Rekko shows overwrite warning → tap Yes → entry updated. Tap No → cancelled.

**AC-6:** During custom project creation ("Other"), after typing the project name, Rekko prompts for a 2–4 letter code. Invalid input (lowercase, too long, duplicate code) is rejected with re-prompt. Valid code is stored with the project.

**AC-7:** Run migration script in dry-run mode → see list of proposed changes (`REQ-001 → ECW-REQ-001`). Run with `--apply` → Notion entries updated. Run again → no changes (idempotent).

**AC-8:** Parser accepts both `REQ-001` (legacy) and `ECW-REQ-001` (new) in frontmatter `request_id` field without validation errors.

## Out of Scope

- Renaming GitHub folders from old `REQ-XXX` format — Notion only
- Edit/delete requests via Telegram
- Changes to Bot 1 or Bot 2
- Any UI in Notion (views, filters) — Bryan manages Notion layout manually
- Bulk operations on requests
- Auto-generating project codes from project names

## Deliverables

- Updated `src/bot3/router.js` — `/unscoped` command, replace logic, custom code prompt
- Updated `src/bot3/notion.js` — `getUnscopedRequests`, `findRequestById`, `updateRequestEntry`, updated `getNextRequestId`
- Updated `src/bot3/parser.js` — relaxed request_id regex
- Updated `src/bot3/projects.js` — `code` field on each project
- New `scripts/migrate-request-ids.js` — one-time migration script
- Updated `data/custom-projects.json` format handling (backward compatible load)