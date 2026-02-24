# SCHEMA.md — Telegram Bots Database Schema

**Last Updated:** 2026-02-24 00:00 MYT

Two data layers: SQLite (local, on VPS) for transient state, and Notion (cloud) as source of truth for tasks and notes.

---

## SQLite Tables (Local — `data/bot.db`)

### `draft_buffer`
Holds in-progress note drafts. Persisted on every message for crash safety.

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, autoincrement |
| chat_id | INTEGER | NOT NULL |
| messages | TEXT | JSON array of message strings |
| source | TEXT | 'Text' or 'Voice' |
| opened_at | DATETIME | NOT NULL |
| last_updated | DATETIME | NOT NULL |

**Notes:**
- At most one open draft per chat_id at any time
- On bot startup: check for open drafts → restore state → re-send buffer prompt to user
- Deleted after successful save or discard

---

### `scheduled_jobs`
Unified scheduler for recurring tasks, reminders, briefings, and weekly reviews.

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, autoincrement |
| type | TEXT | NOT NULL — 'recurring' / 'reminder' / 'briefing' / 'review' |
| payload | TEXT | JSON — task_name, stream, message, note_id, etc. |
| cron_expr | TEXT | Nullable — for recurring jobs (e.g. '0 9 * * 1') |
| next_run_at | DATETIME | NOT NULL — worker checks: next_run_at ≤ now |
| chat_id | INTEGER | NOT NULL — Telegram chat to send to |
| last_triggered | DATETIME | Nullable — audit trail |
| active | INTEGER | DEFAULT 1 — soft delete / pause (1=true, 0=false) |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP |

**Worker logic (runs every 60s):**
1. `SELECT * FROM scheduled_jobs WHERE next_run_at <= NOW() AND active = 1`
2. Execute payload (create Notion task / send reminder / compose briefing)
3. If `cron_expr` exists: recalculate `next_run_at` from cron expression
4. If one-shot (reminder): set `active = 0`
5. Update `last_triggered`

**On startup:** Check for missed triggers (`last_triggered` < expected) from last 24hrs. Re-run if missed.

---

### `pending_sync`
Fallback queue when Notion or Google Drive is unreachable.

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, autoincrement |
| action | TEXT | NOT NULL — 'create_task' / 'update_task' / 'create_note' / 'upload_file' |
| payload | TEXT | JSON — full intent data needed to retry |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| retry_count | INTEGER | DEFAULT 0 |
| last_retry_at | DATETIME | Nullable |

**Worker logic (runs every 5 min):**
1. `SELECT * FROM pending_sync WHERE retry_count < 5 ORDER BY created_at ASC`
2. Attempt action
3. On success: delete row
4. On failure: increment `retry_count`, update `last_retry_at`
5. On 5th failure: notify Bryan via Telegram, stop retrying

---

## Notion Database: Master Tasks

**Database Name:** `Master Tasks`

| Property | Notion Type | Values / Notes |
|---|---|---|
| Task | Title | Main task name |
| Status | Select | `Inbox` / `Todo` / `In Progress` / `Waiting` / `Done` |
| Urgency | Select | `Urgent` / `Less Urg` / `No Urgency` |
| Stream | Select | `Minionions` / `KLN` / `Overdrive` / `Personal` / `Property` |
| Due Date | Date | Date + optional time |
| Energy | Select | `High` / `Low` |
| Notes | Rich Text | Task context — always appended, never overwritten |
| File Links | Rich Text | Google Drive URLs (one per line, labelled). Separate from Notes. |
| Recurring | Checkbox | Flag only — schedule config in SQLite `scheduled_jobs` |
| Created | Created time | Auto-populated by Notion |

**Views:**

| View Name | Type | Filter | Group By | Sort |
|---|---|---|---|---|
| Board | Board | — | Stream (cols), Urgency (rows) | — |
| Today Tasks | Table | Due = today OR Status = In Progress | Stream | Urgency |
| Inbox | Table | Status = Inbox | — | Created desc |
| Upcoming | Table | Due in next 7 days, Status ≠ Done | — | Due Date asc |
| Waiting | Table | Status = Waiting | — | Due Date |
| Overall | Table | — | — | — |

---

## Notion Database: Quick Notes

**Database Name:** `Quick Notes`

| Property | Notion Type | Values / Notes |
|---|---|---|
| Title | Title | Claude-generated summary (never raw first line) |
| Content | Rich Text | Full concatenated note body |
| Type | Select | `Idea` / `Meeting` / `Voice` |
| Stream | Select | `Minionions` / `KLN` / `Overdrive` / `Personal` / `Property` |
| Remind At | Date | Optional, with time |
| Promoted | Checkbox | True if converted to Master Tasks |
| Source | Select | `Text` / `Voice` |
| Created | Created time | Auto-populated by Notion |

**Notes on Stream:** Optional — only populated when clearly inferable from content keywords. If ambiguous, leave blank (do NOT default to Personal like todos).

**Notes on Voice:** The `Voice` type and `Voice` source remain in the schema for future use. Voice transcription (Whisper) is deferred to Phase 2 — no voice handling in MVP.

**Views:**

| View Name | Type | Filter | Sort |
|---|---|---|---|
| All Notes | Table | — | Created desc |
| Ideas | Table | Type = Idea | Created desc |
| Meetings | Table | Type = Meeting | Created desc |
| Reminders | Table | Remind At is not empty, Promoted = false | Remind At asc |
| Promoted | Table | Promoted = true | Created desc |

---

## Unified Intent Registry

Single source of truth for all Claude-classified intents.

| Intent | Module | Source | Example Trigger |
|---|---|---|---|
| ADD_TODO | Todos | Claude NLP | "add todo: submit invoice by Friday" |
| COMPLETE_TODO | Todos | Claude NLP | "done with KLN report" |
| LIST_TODOS | Todos | Claude NLP | "show today's tasks" / "what am I waiting on?" |
| UPDATE_TODO | Todos | Claude NLP | "push Solasta deadline to March 1" |
| ATTACH_FILE | Todos | Claude NLP + File | Send PDF with caption referencing a task |
| ADD_NOTE | Notes | Claude NLP | "idea: tiered pricing for OD" |
| SET_REMINDER | Notes | Claude NLP | "remind me Friday 9am check lease" |
| LIST_NOTES | Notes | Claude NLP | "show my meeting notes" |
| PROMOTE_TO_TASK | Cross-module | Claude NLP | Reply "promote" to note confirmation |
| ADD_CALENDAR_EVENT | Calendar (Phase 2) | Claude NLP | "dentist Tuesday 3pm" |
| READ_CALENDAR | Calendar (Phase 2) | Claude NLP | "what's on tomorrow?" |
| UNKNOWN | Core | Fallback | "hey what's up" — conversational reply |

**Not intents (handled as Telegram callback_query):**
- `draft:save` — ✅ Save button tap
- `draft:discard` — 🗑 Discard button tap
- `reminder:done` — ✅ Done on reminder notification
- `reminder:snooze` — ⏩ Snooze on reminder notification

---

## Stream Routing Keywords

Shared module: `src/bot1/streamRouter.js`

| Keywords | Inferred Stream |
|---|---|
| SVO, supplement, Minionions, ads, dashboard, inventory | Minionions |
| KLN, consultant, client, report, north | KLN |
| Overdrive, OD, event, pickleball, freelance | Overdrive |
| Solasta, renovation, contractor, rental, property, ID, VP | Property |
| Anything else | (depends on caller) |

**Fallback behavior:**
- Todos: default to `Personal`, append flag in reply
- Notes: leave `Stream` blank (do not guess)

Router returns: `{ stream: string | null, confidence: 'high' | 'low' }`
