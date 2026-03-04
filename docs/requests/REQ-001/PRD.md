# PRD

## Problem Statement

Bryan uses Rekko's quick request feature to capture ideas on the go — short text messages that become Notion entries with status "Unscoped." Later, he scopes them properly in Claude Chat and sends the full `.md` file back to Rekko. Currently, this creates a duplicate entry instead of upgrading the existing one. Bryan also has no way to see which quick requests still need scoping, and the generic `REQ-XXX` numbering doesn't tell him which project an ID belongs to at a glance.

## Users & Stakeholders

- **Primary user:** Bryan (sole user of all three bots)
- **Requested by:** Bryan

## Success Criteria

1. Bryan can type `/unscoped`, pick a project, and see all Unscoped requests for that project
2. When Bryan sends a scoped `.md` file with a REQ-ID that already exists as Unscoped in Notion, the existing entry is updated (not duplicated) after confirmation
3. All new request IDs follow the format `{PROJECT_CODE}-REQ-{NNN}` (e.g., `ECW-REQ-001`)
4. Existing Notion entries are migrated to the new ID format
5. Custom projects prompt for a short project code during creation

## Requirements

### Functional Requirements

**FR-1:** `/unscoped` command shows inline buttons for each known project (hardcoded + custom). User taps a project. Bot replies with a numbered list of all Unscoped entries for that project (title, ID, priority, date logged). If none exist, reply "No unscoped requests for {project}."

**FR-2:** When a scoped `.md` file is received, before creating a new entry, query Notion for an existing page with the same Request ID. If found AND status is "Unscoped": show confirmation message ("ECW-REQ-003 exists as Unscoped. Replace with scoped version?") with Yes/No buttons. On Yes: update the existing Notion page (set Status → Scoped, add GitHub links, update all other fields from frontmatter). On No: cancel, no changes.

**FR-3:** If a scoped `.md` file matches an existing entry with status "Scoped" (already filed before): show a different warning ("ECW-REQ-003 is already Scoped. Overwrite?") with Yes/No buttons. On Yes: update. On No: cancel.

**FR-4:** If no existing entry is found for the REQ-ID: create new (current behavior).

**FR-5:** New ID format is `{PROJECT_CODE}-REQ-{NNN}` where `PROJECT_CODE` is a 2–4 uppercase letter code defined per project, and `NNN` is zero-padded to 3 digits, sequential per project. Examples: `ECW-REQ-001`, `TGB-REQ-003`.

**FR-6:** Each project in `projects.js` gains a `code` field. Initial codes: `ecomwave-crm` → `ECW`, `telegram-bot` → `TGB`.

**FR-7:** When creating a custom project via the "Other" flow, after the user types the project name, ask: "Short code for this project? (2–4 letters, e.g., ECW)". Validate: uppercase letters only, 2–4 characters, not already taken. Store alongside the custom project name.

**FR-8:** Quick requests auto-generate IDs using the new format. `getNextRequestId` queries Notion for the highest `{CODE}-REQ-XXX` number for that project code and increments.

**FR-9:** Scoped `.md` files use the new `request_id` format in frontmatter. Parser validation updated to accept `{CODE}-REQ-{NNN}` in addition to the old `REQ-{NNN}` format (backward compatible during migration).

**FR-10:** One-time migration: rename all existing `REQ-XXX` entries in Notion to their project-prefixed equivalents. Use the Project field to determine the correct code.

### Non-Functional Requirements

**NFR-1:** `/unscoped` query should handle paginated Notion results (some projects may accumulate many unscoped entries over time).

**NFR-2:** The confirmation flow for replace must be resilient — if Bryan doesn't tap Yes/No and sends another file instead, the pending confirmation should expire (same 5-minute TTL pattern as quick requests).

**NFR-3:** Notion update (replace) must be a single `pages.update` call, not delete + recreate, to preserve the page's creation date and any manual edits Bryan made to the Notion page.

## Scope

### In Scope

- `/unscoped` command with project selection and list display
- Scoped file detects existing Unscoped entry → confirmation → update
- Scoped file detects existing Scoped entry → warning → update
- New `{CODE}-REQ-{NNN}` ID format for all new entries
- Project code field in config + custom project code prompt
- Parser accepts both old and new ID formats
- Notion migration script for existing entries
- Updated `getNextRequestId` logic for new format

### Out of Scope

- Editing or deleting requests from Telegram (use Notion directly)
- Filtering `/unscoped` by priority or type
- Renaming GitHub folders for old REQ-XXX entries (Notion only migration)
- Bulk operations on requests
- Any changes to Bot 1 or Bot 2

## UI/UX Notes

- `/unscoped` follows the same two-step button pattern as quick requests: command → project buttons → result list
- Replace confirmation uses inline buttons (Yes / No) attached to a summary message showing what will be replaced
- When asking for a custom project code, it's a plain text prompt (same pattern as custom project name)
- Unscoped list format per item: `{ID} — {title} ({priority}, {date})`

## Technical Notes

- Affected modules: `router.js`, `notion.js`, `parser.js`, `projects.js`
- Notion database property `Request ID` is a rich_text field — queryable via filter
- Custom projects currently persist to `data/custom-projects.json` — needs to store project code alongside name
- Migration is a one-off script, not a runtime feature

## Open Questions

None — all decisions resolved during scoping session.