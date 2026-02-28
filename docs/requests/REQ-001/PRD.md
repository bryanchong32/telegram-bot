# PRD

## 1. Problem Statement

Bryan runs multiple software projects and generates a high volume of feature requests, bug reports, and enhancements. After scoping each request with Claude Chat, he must manually create a Notion entry, upload three documents to the right locations, link them, and set properties. This admin work takes 5–10 minutes per request and is error-prone (missed links, wrong properties, forgotten entries). The friction discourages consistent tracking, which leads to lost context and poor prioritization.

## 2. Users & Stakeholders

- **Primary user:** Bryan — sends scoped requests to the bot after Claude Chat sessions
- **Stakeholder:** Bryan — project owner and sole operator

## 3. Success Criteria

- Bryan can file a fully scoped request (Notion entry + 3 GitHub docs) in under 30 seconds
- Zero manual Notion data entry required after sending to the bot
- Works across multiple projects from day one
- Bot confirms successful filing with a summary message in Telegram

## 4. Requirements

### 4a. Functional Requirements

**FR-1: Receive and parse a scoped request file.**
The bot receives a single markdown file via Telegram. The file contains YAML frontmatter (metadata) and three document sections separated by `# PRD`, `# DECISION NOTES`, and `# CLAUDE CODE INSTRUCTIONS` headers. The bot parses the frontmatter to extract: request_id, project, title, type, priority, effort, source, date.

**FR-2: Split the file into three separate documents.**
The bot splits the combined markdown file into three individual files:
- `PRD.md` — everything under `# PRD` until the next top-level header
- `DECISION-NOTES.md` — everything under `# DECISION NOTES` until the next top-level header
- `CC-INSTRUCTIONS.md` — everything under `# CLAUDE CODE INSTRUCTIONS` to end of file

**FR-3: Commit documents to the correct GitHub repository.**
The bot commits the three files to the GitHub repo mapped to the `project` field in the frontmatter. Files are placed at: `docs/requests/[request_id]/PRD.md`, `docs/requests/[request_id]/DECISION-NOTES.md`, `docs/requests/[request_id]/CC-INSTRUCTIONS.md`. The commit message should be: `docs: add [request_id] - [title]`.

**FR-4: Create a Notion database entry.**
The bot creates a new page in the Notion database mapped to the `project` field. Properties populated from frontmatter: Request Title, Request ID, Type, Priority, Effort, Status (always "Scoped"), Source, Date Logged, PRD Link, Decision Notes Link, CC Instructions Link.

**FR-5: Send confirmation message.**
After successful filing, the bot replies in Telegram with confirmation including request ID, title, project, priority, effort, and filing status.

**FR-6: Multi-project configuration.**
The bot maintains a project registry config file mapping project keys to their GitHub repo and Notion database ID. Adding a new project = adding a config entry. No code changes required.

**FR-7: Error handling and feedback.**
If any step fails, the bot sends a clear error message indicating which step failed. Partial successes reported (e.g., "GitHub ✅ but Notion ❌").

**FR-8: Validate frontmatter before processing.**
Validate all required fields present and project maps to a known config entry before making any API calls.

### 4b. Non-Functional Requirements

- Bot responds within 10 seconds of receiving a file
- Handles markdown files up to 50KB
- Secrets in environment variables only
- Deployed alongside existing bots using same infrastructure

## 5. Scope

**In Scope:** Single markdown file intake, frontmatter parsing, file splitting, GitHub commit to correct project repo, Notion entry creation, multi-project routing, error handling, Telegram confirmations.

**Out of Scope:** Status updates from Notion to Telegram, editing existing requests via bot, AI/LLM processing, web dashboard, auto Claude Code triggering, Google Drive integration.

## 6. UI/UX Notes

Telegram conversation only: user sends `.md` file, bot replies with confirmation or error. No menus, commands, or buttons for v1.

## 7. Technical Notes

- New module within existing `bryanchong32/telegram-bot` repo alongside Nami, Scannko, and notifications
- Follows same architectural patterns and deployment approach
- APIs: Telegram Bot API, GitHub REST API, Notion API
- Request docs committed to each project's OWN repo, not to telegram-bot repo

## 8. Open Questions

None.