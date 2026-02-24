# Notion Quick Notes System — Tech Spec for Telegram Bot Integration
**Version:** 1.0
**Scope:** Quick Notes module for Bot 1 (Personal Assistant)
**Target builder:** Claude Code (fully autonomous implementation)
**Architect:** Bryan

---

## Design Philosophy
- Notes are captured with zero friction — no required fields, no mandatory structure
- Bot never fires API calls during message buffering — one API call per note save
- Every draft has exactly one resolution path: manual save, intent shift auto-save, or 1hr timeout ping
- Feedback loop is mandatory — every save has a confirmation reply

---

## Notion Database Structure

**Database Name:** `Quick Notes`

| Property | Type | Values / Notes |
|---|---|---|
| Title | Title | Claude-generated summary |
| Content | Rich Text | Full concatenated note body |
| Type | Select | `Idea` / `Meeting` / `Voice` |
| Stream | Select | `Minionions` / `KLN` / `Overdrive` / `Personal` / `Property` (optional — only when obvious) |
| Remind At | Date | Optional, with time |
| Promoted | Checkbox | True if converted to Master Tasks |
| Source | Select | `Text` / `Voice` |
| Created | Created time | Auto |

**Notes:**
- Stream is optional — only populated when clearly inferable from content keywords
- If stream is ambiguous, leave blank (do not default to Personal like todos)
- Title is always Claude-generated — never raw first line

---

## Notion Views to Create

| View Name | Type | Filter | Sort |
|---|---|---|---|
| All Notes | Table | — | Created desc |
| Ideas | Table | Type = Idea | Created desc |
| Meetings | Table | Type = Meeting | Created desc |
| Reminders | Table | Remind At is not empty, Promoted = false | Remind At asc |
| Promoted | Table | Promoted = true | Created desc |

---

## Bot Intents — Notes Module

### Intent List

```
ADD_NOTE
SET_REMINDER
LIST_NOTES
PROMOTE_TO_TASK
CONFIRM_DRAFT
DISCARD_DRAFT
```

### Intent JSON

**ADD_NOTE**
```json
{
  "intent": "ADD_NOTE",
  "title": "Overdrive tiered pricing idea",
  "content": "Full concatenated content from all buffered messages",
  "type": "Idea",
  "stream": "Overdrive",
  "remind_at": null,
  "source": "Text"
}
```

**SET_REMINDER (standalone)**
```json
{
  "intent": "SET_REMINDER",
  "message": "Check lease renewal",
  "remind_at": "2026-02-27T09:00:00"
}
```
Saves a minimal note entry + scheduler row. Stream not required.

**LIST_NOTES**
```json
{
  "intent": "LIST_NOTES",
  "filter": "ideas",
  "search_term": null
}
```
Accepted filter values: `all` / `ideas` / `meetings` / `voice` / `reminders` — or `search:{term}` for fullText Notion query.

**PROMOTE_TO_TASK**
```json
{
  "intent": "PROMOTE_TO_TASK",
  "note_title": "Overdrive tiered pricing idea",
  "stream": "Overdrive"
}
```
Triggered when user replies "promote" to a note confirmation message.

---

## Draft Buffer System

### Core Principle
**Zero API calls during buffering.** All messages are held in VPS memory. Claude is only called once — at save time — to generate title, type, and stream from the full concatenated content.

### Buffer State Machine

```
IDLE
  ↓ (first message arrives)
BUFFERING
  ├── New message arrives → append to buffer, reset 5s timer, stay BUFFERING
  ├── 5s silence → send static "Got it — anything to add? [✅ Save] [🗑 Discard]" (no API call)
  ├── ✅ Save tapped → SAVING (1 API call → Notion write → confirmation reply → IDLE)
  ├── 🗑 Discard tapped → clear buffer → IDLE
  ├── Intent shift detected → AUTO_SAVE_PENDING, open new draft (1 API call)
  └── 1hr no activity → push timeout ping → await response → SAVING or IDLE
```

### Static Buffer Prompt (no API call)
After 5s silence, bot echoes buffered content back to user:

```
📝 Draft so far:
"idea for Overdrive — three pricing tiers — maybe also a freemium entry point"

Anything to add? Or tap below:
[✅ Save]  [🗑 Discard]
```

Bot stays in BUFFERING state — no timeout, waits indefinitely for more messages or a resolution trigger.

### API Call Budget

| Event | API Calls |
|---|---|
| Single note, any number of messages | 1 |
| Note with intent shift | 2 (1 per note) |
| Note with voice transcription | 2 (Whisper + Claude) |
| Total per note regardless of message count | Always 1 Claude call |

---

## Intent Shift Detection

When a new message arrives while a draft is open, bot calls Claude to classify:

**System prompt:**
```
You have an open note draft: "{draft_content}"
New message received: "{new_message}"

Does the new message continue the same note, or is it a completely different topic/intent?
Respond with JSON only:
{
  "continues_draft": true/false,
  "reason": "brief explanation"
}
```

**If continues_draft = true:** append to buffer, reset timer, stay BUFFERING.

**If continues_draft = false:**
1. Auto-save current draft as a Notion note (1 API call for title/type/stream generation)
2. Notify: `"📝 Previous draft saved: '{title}' — reply 'promote' to convert to task"`
3. Open new buffer with the new message
4. Resume BUFFERING state

**Cost:** 1 extra classification call only when a new message arrives mid-draft. If user sends messages continuously without gaps, this never triggers.

---

## 1-Hour Timeout Ping

If draft stays in BUFFERING state for 60 minutes with no activity:

```
⏰ You have an unsaved note draft:

"idea for Overdrive — three pricing tiers..."

Tap to resolve:
[✅ Save]  [🗑 Discard]
```

**Behaviour:**
- Ping fires once at 60 minutes — no further automated action after that
- Draft remains open indefinitely until you resolve it — the [✅ Save] [🗑 Discard] buttons stay visible in chat history whenever you reopen the chat
- Timer is cancelled immediately if any resolution fires first (save, discard, or intent shift)
- No conflict with intent shift — only one resolution path can run; whichever fires first cancels the others

---

## Voice Note Handling

```
Bryan sends voice note
    ↓
Telegram → VPS (audio file received)
    ↓
Transcribe via Whisper API (1 API call)
    ↓
Transcribed text enters buffer as a normal message
    ↓
Bot replies: "🎙 Transcribed: '{text}' — anything to add? [✅ Save] [🗑 Discard]"
    ↓
Normal buffer flow resumes (source = "Voice" tagged on save)
```

---

## PROMOTE_TO_TASK Flow

```
Bot confirms note save
    ↓
Reply includes: "Reply 'promote' to convert to a task"
    ↓
Bryan replies: "promote"
    ↓
Bot creates entry in Master Tasks DB:
  - Title = note title
  - Notes = note content
  - Stream = from note (if set), else asks
  - Status = Inbox
  - Urgency/Due Date = not set (bot asks optionally)
    ↓
Mark note as Promoted = true in Quick Notes DB
    ↓
Reply: "✅ Promoted to task: {title} [Inbox · {Stream}]
        Set urgency or due date? (or reply 'skip')"
```

---

## LIST_NOTES — Search & Filter

**Supported queries:**
```
"show my ideas"              → Type = Idea
"KLN notes"                  → Stream = KLN
"notes from last week"       → Created date filter
"meeting notes"              → Type = Meeting
"search: lease renewal"      → Notion fullText search
"show reminders"             → Remind At is not empty
```

**Response format:**
```
📝 Your Ideas (4)

1. Overdrive tiered pricing idea — 2 days ago
2. SVO bundle campaign concept — 1 week ago
3. KLN retainer model — 3 weeks ago
4. Property co-investment idea — 2 months ago

Reply with a number to expand, promote, or set reminder.
```

**Limitation:** Notion search is keyword-based, not semantic. "pricing strategy" will not find a note titled "monetisation idea." For deep archival search, Notion UI is more reliable.

---

## Reminder Scheduling

When `remind_at` is set on a note, bot writes to the shared VPS scheduler table:

```sql
INSERT INTO reminders (remind_at, chat_id, message, note_id)
VALUES ('2026-02-27 09:00:00', 12345678, 'Check lease renewal', '{notion_page_id}');
```

Background worker fires Telegram message at scheduled time:
```
⏰ Reminder: Check lease renewal
[View in Notion] [✅ Done] [⏩ Snooze 1hr]
```

---

## Self-Healing & Error Handling

| Failure | Self-Heal | User Notification |
|---|---|---|
| Whisper transcription fail | Retry 2x | `"⚠️ Transcription failed. Send as text?"` |
| Notion write fail | Retry 3x exponential backoff | `"⚠️ Notion unreachable. Draft preserved locally, will sync when restored."` |
| Claude title generation fail | Use first 50 chars of content as title | Silent fallback, no interruption |
| Intent shift classification fail | Default to continues_draft = true | Safe fallback — never loses content |
| Draft lost on VPS restart | Persist buffer to SQLite immediately on each message | On restart, reload open drafts and notify: `"📝 Recovered unsaved draft — tap to review"` |

### Draft Persistence (VPS Restart Safety)

Buffer is written to SQLite on every new message — not just held in memory:

```sql
CREATE TABLE draft_buffer (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER,
  messages TEXT,        -- JSON array of message strings
  opened_at DATETIME,
  last_updated DATETIME
);
```

On bot startup: check for open drafts → restore state → re-send buffer prompt to user.

---

## Environment Variables Required

No new credentials needed beyond what's already in the main bot `.env`. Quick Notes uses the same:
```env
NOTION_TOKEN=secret_xxx
NOTION_QUICKNOTES_DB_ID=xxx   ← new DB ID to add
ANTHROPIC_API_KEY=xxx
TELEGRAM_BOT1_TOKEN=xxx
ALLOWED_TELEGRAM_USER_ID=xxx
```

---

## Dependencies

Same as main bot stack. No additional packages required.

**Node.js:** `@notionhq/client`, `better-sqlite3`, `node-cron`
**Python:** `notion-client`, `schedule`, `sqlite3 (stdlib)`

**Whisper:** Via Anthropic API (no separate setup needed if already using Anthropic SDK)
