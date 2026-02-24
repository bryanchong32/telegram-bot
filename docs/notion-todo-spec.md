# Notion Todo System — Tech Spec for Telegram Bot Integration
**Version:** 2.0  
**Scope:** Todo/Task module for Bot 1 (Personal Assistant)  
**Target builder:** Claude Code (fully autonomous implementation)  
**Architect:** Bryan  

---

## Design Philosophy
- Bryan is architect only — Claude Code handles all development
- Spec must be unambiguous enough for Claude Code to build without clarification
- All integrations must include error handling and self-healing logic
- Feedback loops must be explicit — every action must have a confirm/fail/retry path back to the user via Telegram

---

## Integration Stack

| Service | Purpose | Interface |
|---|---|---|
| Notion API v1 | Read/write tasks | REST API via `@notionhq/client` (Node) or `notion-client` (Python) |
| Notion MCP Server | Enable Claude Code to self-heal and inspect DB schema live | `@modelcontextprotocol/server-notion` |
| Google Drive API v3 | Store reference files | REST via `googleapis` SDK |
| Google OAuth 2.0 | Auth for Drive | Reuse same OAuth flow as Calendar integration |
| Anthropic API | Intent parsing, stream inference | Already in main bot plan |

### Notion MCP — Why It's Here
The Notion MCP server exposes Notion as a tool Claude Code can call directly during development and debugging:
- Claude Code can inspect the live DB schema without being told the structure
- Claude Code can validate that tasks are being written correctly by querying live data
- Claude Code can self-correct if property names drift or schema changes
- No manual intervention from Bryan needed for schema-related bugs

**MCP server:** `@modelcontextprotocol/server-notion`  
**Setup:** Add to Claude Code's MCP config with Notion integration token  
**Scope:** Read + write access to Master Tasks DB only

---

## Notion Database Structure

**Database Name:** `Master Tasks`

| Property Name | Notion Type | Values |
|---|---|---|
| Task | Title | Main task name |
| Status | Select | `Inbox` / `Todo` / `In Progress` / `Waiting` / `Done` |
| Urgency | Select | `Urgent` / `Less Urg` / `No Urgency` |
| Stream | Select | `Minionions` / `KLN` / `Overdrive` / `Personal` / `Property` |
| Due Date | Date | Date + optional time |
| Energy | Select | `High` / `Low` |
| Notes | Rich Text | Task context, "done" definition, relevant contacts |
| File Links | Rich Text | Google Drive URLs (one per line, labelled) |
| Recurring | Checkbox | Flagged for VPS scheduler to auto-recreate |
| Created | Created time | Auto-populated by Notion |

**Notes:**
- `File Links` is a dedicated field separate from Notes — bot appends links here without overwriting context
- `Urgency` maps to existing board grouping — no board rebuild needed
- `Recurring` is a flag only — schedule config lives in VPS scheduler table

---

## Notion Views to Create

| View Name | Type | Filter | Group By | Sort |
|---|---|---|---|---|
| Board (existing) | Board | — | Stream (cols), Urgency (rows) | — |
| Today Tasks | Table | Due = today OR Status = In Progress | Stream | Urgency |
| Inbox | Table | Status = Inbox | — | Created desc |
| Upcoming | Table | Due in next 7 days, Status ≠ Done | — | Due Date asc |
| Waiting | Table | Status = Waiting | — | Due Date |
| Overall | Table | — | — | — |

---

## Google Drive File Structure

```
My Drive/
└── TaskRefs/
    ├── Minionions/
    ├── KLN/
    ├── Overdrive/
    ├── Property/
    └── Personal/
```

**Rules:**
- Files organised by stream only — no date subfolders
- Files accessed via Notion task links, not by browsing Drive directly
- Stream folder inferred using same stream routing logic as tasks

### File Handling Flow

```
Bryan sends file to bot (Telegram)
    ↓
Bot receives file (image, PDF, doc, xlsx, etc.)
    ↓
Is file a non-PDF Office doc? (docx, xlsx, pptx)
    ├── Yes → convert to PDF via LibreOffice on VPS
    │         `libreoffice --headless --convert-to pdf {file}`
    └── No → use as-is
    ↓
Upload to Google Drive /TaskRefs/{stream}/
Filename format: YYYY-MM-DD_{original_filename}
    ↓
Set sharing: "Anyone with link can view"
Get shareable link
    ↓
Is bot attaching to an existing task?
    ├── Yes → append link to task's File Links field
    └── No → create new Inbox task, task name = filename, File Links = Drive URL
    ↓
Reply: "📎 Saved: {filename} → {stream} | Linked to: {task name or 'new Inbox task'}"
```

### File Type Support

| Type | Notion Preview | Bot Handling |
|---|---|---|
| JPG, PNG, GIF, WebP | ✅ Inline image | Upload as-is |
| PDF | ✅ Inline PDF viewer | Upload as-is |
| Google Drive link | ✅ Embed preview | Native Notion integration |
| DOCX, XLSX, PPTX | ❌ Link only | Convert to PDF before upload |
| Other | ❌ Link only | Upload as-is, no conversion |

---

## Bot Intents — Todo Module

### Intent List

```
ADD_TODO
COMPLETE_TODO
LIST_TODOS
UPDATE_TODO
LIST_WAITING
ATTACH_FILE
```

### Intent JSON Output

**ADD_TODO**
```json
{
  "intent": "ADD_TODO",
  "task": "Follow up with John re Solasta contractor",
  "stream": "Property",
  "urgency": "Urgent",
  "due_date": "2026-02-27",
  "energy": "Low",
  "notes": "Full context from user input"
}
```

**COMPLETE_TODO**
```json
{
  "intent": "COMPLETE_TODO",
  "search_term": "KLN report"
}
```
→ Bot fuzzy-matches open tasks, presents top match for confirmation before marking Done

**LIST_TODOS**
```json
{
  "intent": "LIST_TODOS",
  "filter": "today"
}
```
Accepted filter values: `today` / `inbox` / `waiting` / `upcoming` / `all`

**UPDATE_TODO**
```json
{
  "intent": "UPDATE_TODO",
  "search_term": "Solasta contractor",
  "updates": {
    "due_date": "2026-03-01",
    "urgency": "Urgent",
    "notes": "Appended context — never overwrites existing"
  }
}
```

**ATTACH_FILE**
```json
{
  "intent": "ATTACH_FILE",
  "stream": "Property",
  "link_to_task": "Follow up with John re Solasta contractor"
}
```
Triggered when Bryan sends a file with or without text. If text accompanies file, extract task link hint from text.

---

## Stream Routing Logic

| Keywords | Inferred Stream |
|---|---|
| SVO, supplement, Minionions, ads, dashboard, inventory | Minionions |
| KLN, consultant, client, report, north | KLN |
| Overdrive, OD, event, pickleball, freelance | Overdrive |
| Solasta, renovation, contractor, rental, property, ID, VP | Property |
| Anything else | Personal |

If confidence is low → default to `Personal` and append: `"(Stream set to Personal — reply with correct stream to update)"`

---

## Recurring Tasks Logic

Config lives in VPS scheduler table:

```sql
CREATE TABLE recurring_tasks (
  id INTEGER PRIMARY KEY,
  task_name TEXT,
  stream TEXT,
  urgency TEXT,
  energy TEXT,
  frequency TEXT,        -- 'daily' | 'weekly' | 'monthly'
  trigger_day TEXT,      -- 'Monday' | '1' (day of month) | null
  trigger_time TEXT,     -- 'HH:MM' UTC+8
  last_triggered DATE
);
```

**Sample config:**

| task_name | stream | urgency | frequency | trigger_day | trigger_time |
|---|---|---|---|---|---|
| Weekly Sunday review | Personal | Urgent | weekly | Sunday | 20:00 |
| SVO inventory check | Minionions | Urgent | weekly | Monday | 09:00 |
| Monthly insurance review | Personal | Less Urg | monthly | 1 | 09:00 |
| Property buffer fund check | Property | Less Urg | monthly | 1 | 09:00 |

**Worker:** Background process checks every minute. On trigger:
1. Create task in Notion with all fields pre-filled, Status = `Todo`
2. Send Telegram: `"📋 Recurring task created: {task_name}"`
3. Update `last_triggered` in scheduler table

**Bot command to add recurring:**
- Input: `"add recurring: check SVO ads every Monday morning"`
- Bot creates Notion task + writes to scheduler table
- Reply: `"✅ Recurring task set: Check SVO ads — every Monday 09:00"`

---

## Daily Briefing — Todo Section

**Trigger:** 08:00 daily (UTC+8)  
**Query:** Status = `In Progress` OR Due Date = today, grouped by Urgency

```
📋 Today's Tasks — {date}

🔴 Urgent
• Send KLN report (due today) — KLN
• Follow up Solasta contractor — Property

🟡 In Progress
• Dashboard revamp — Minionions

📥 Inbox — 3 unprocessed
Reply "inbox" to review
```

---

## Sunday Weekly Review

**Trigger:** Sunday 20:00 (UTC+8)

```
🗓 Weekly Review — {date}

⏳ Waiting ({n} items):
• Cloud documentation — KLN (waiting 5 days)
• Partner Contract with OD — Overdrive (waiting 12 days)

✅ Completed this week: {n} tasks
📋 Upcoming next 7 days: {n} tasks

Reply with new tasks or priorities for next week.
```

---

## Notion API Implementation Notes

**Base URL:** `https://api.notion.com/v1`  
**Auth:** `Authorization: Bearer {NOTION_TOKEN}`  
**Version header:** `Notion-Version: 2022-06-28`

**Today Tasks query:**
```json
{
  "filter": {
    "or": [
      { "property": "Due Date", "date": { "equals": "2026-02-24" } },
      { "property": "Status", "select": { "equals": "In Progress" } }
    ]
  },
  "sorts": [{ "property": "Urgency", "direction": "ascending" }]
}
```

**Append to File Links field (non-destructive):**
> ⚠️ Notion API replaces rich_text on PATCH — bot must GET existing content first, append new link, then PATCH.

```json
{
  "properties": {
    "File Links": {
      "rich_text": [
        {
          "text": {
            "content": "\n[filename.pdf] https://drive.google.com/...",
            "link": { "url": "https://drive.google.com/..." }
          }
        }
      ]
    }
  }
}
```

---

## Self-Healing & Feedback Loop Design

### Error Handling Matrix

| Failure | Detection | Self-Heal Action | User Notification |
|---|---|---|---|
| Notion API down | HTTP 5xx or timeout | Retry 3x exponential backoff (1s, 3s, 9s) | After 3rd fail: `"⚠️ Notion unreachable. Task queued locally, will sync when restored."` |
| Notion token expired | HTTP 401 | Halt Notion calls, log error | `"⚠️ Notion auth failed. Check NOTION_TOKEN in .env"` |
| Google Drive upload fail | HTTP error | Retry 2x, then queue to `/tmp/pending_uploads/` | `"⚠️ Drive upload failed. File queued for retry."` |
| PDF conversion fail | LibreOffice error | Upload original file without conversion | `"⚠️ Conversion failed. Original file uploaded instead."` |
| Task not found (COMPLETE/UPDATE) | Empty fuzzy match | Ask Bryan for correct task name | Always |
| Duplicate task | Fuzzy match >90% | Warn and ask to confirm | `"Similar task exists: '{match}'. Add anyway? (yes/no)"` |
| Stream low confidence | No keyword match | Default to Personal, flag in reply | Always |
| Due date in past | Date comparison | Flag and ask to confirm | `"Note: due date is in the past. Confirm? (yes/no)"` |
| Scheduler missed trigger | `last_triggered` check on startup | Re-run missed triggers from last 24hrs | `"📋 Missed recurring task created: {name}"` |

### Local Fallback Queue

When Notion or Drive is unreachable, bot writes to local SQLite queue:

```sql
CREATE TABLE pending_sync (
  id INTEGER PRIMARY KEY,
  action TEXT,          -- 'create_task' | 'update_task' | 'upload_file'
  payload TEXT,         -- JSON
  created_at DATETIME,
  retry_count INTEGER DEFAULT 0
);
```

Background worker retries every 5 minutes. On success: executes + deletes row. On 5th failure: notifies Bryan.

### Schema Drift Detection (via Notion MCP)

On bot startup, Claude Code should:
1. Query live Notion DB schema via MCP
2. Compare against expected schema in this spec
3. If mismatch → log warning + notify: `"⚠️ Notion schema mismatch: property '{name}' not found. Check DB setup."`
4. Degrade gracefully — do not crash, skip affected property only

### Health Check

Bot exposes `/health` endpoint:
- Notion API reachability
- Google Drive API reachability
- Scheduler worker running status
- Returns JSON status

Telegram command `/health` triggers check and replies with summary.

---

## Environment Variables Required

```env
NOTION_TOKEN=secret_xxx
NOTION_TASKS_DB_ID=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REFRESH_TOKEN=xxx
GDRIVE_TASK_REFS_FOLDER_ID=xxx
TELEGRAM_BOT1_TOKEN=xxx
ALLOWED_TELEGRAM_USER_ID=xxx
TZ=Asia/Kuala_Lumpur
```

---

## Dependencies

**Node.js:**
```
@notionhq/client
googleapis
@modelcontextprotocol/server-notion
node-cron
better-sqlite3
```

**Python:**
```
notion-client
google-api-python-client
google-auth-oauthlib
mcp
schedule
sqlite3 (stdlib)
```

**VPS system dependency (PDF conversion):**
```bash
apt-get install libreoffice
```
