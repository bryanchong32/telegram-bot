# Telegram Bots Build Plan

## Overview
Two separate Telegram bots hosted on personal VPS.  
Estimated running cost: **~$2–5/month** (Anthropic API only, everything else free).

---

## Bot 1 — Personal Assistant

### Features
- **Todo List** — read, write, complete tasks in Notion
- **Quick Notes** — save notes to Notion with scheduled reminders
- **Google Calendar** (bryanchong32@gmail.com) — freelance/work events
- **Outlook Calendar** (bryanckl@hotmail.com) — personal events
- Both calendars: create events, read schedule, unified view on request
- **Daily morning briefing** — todos + calendar summary each morning
- **Weekly Sunday review** — incomplete todos + week ahead
- **Voice notes** — transcribe via Whisper API → save to Notion
- **Link forwarding** — summarize article/link → save to Notion reading list
- **Draft messages/emails** — compose via chat

### Future Add-ons (Phase 2)
- Habit tracker → Notion table
- Work log / timesheet → Notion
- Expense logging (light) → Notion
- Quick web search + article summarization
- Screenshot/whiteboard → extract text → save to Notion

---

## Bot 2 — Receipt & Expense Tracker

### Features
- Send receipt photo or PDF → Claude Vision extracts details
- Auto-logs to Google Sheets: merchant, date, amount, category, currency
- Uploads receipt image to Google Drive (organized by month/year)
- Expense summaries on demand ("show me this month's expenses")
- Category filtering ("total client entertainment this month")
- Multi-currency aware (MYR-based)

---

## Integrations Required

| Service | Purpose | Cost |
|---|---|---|
| Anthropic API | Claude AI + Vision + Whisper | ~$2–5/month |
| Telegram Bot API | Two bots via @BotFather | Free |
| Notion API | Todos, notes, reading list | Free |
| Google OAuth | Calendar + Sheets + Drive | Free |
| Microsoft OAuth | Outlook personal (Hotmail only) | Free |

### Google OAuth covers:
- Google Calendar (bryanchong32@gmail.com)
- Google Sheets (expense log)
- Google Drive (receipt storage)

### Microsoft OAuth covers:
- Outlook Calendar (bryanckl@hotmail.com)
- Personal Hotmail = standard consumer OAuth, no IT approval needed

> ⚠️ Company email (bryan.chong@klnorth.com) excluded — corporate O365 requires IT admin consent, not worth the friction.

---

## What to Prepare Before Building

1. **Anthropic API key** — platform.claude.com
2. **Telegram bot tokens** — create x2 bots via @BotFather (2 min each)
3. **Notion API key** + todo database structure (column names + property types)
4. **Google Cloud project** — enable Calendar, Sheets, Drive APIs + OAuth credentials
5. **Microsoft Azure app registration** — for Hotmail OAuth (~15 min setup)
6. **VPS details** — OS, stack preference (Node.js or Python), Docker setup if any

---

## Notes for Claude Code
- Both bots share the same VPS and Anthropic API key
- Use **Haiku** model for simple parsing tasks (cheapest), **Sonnet** for complex organizing
- Google OAuth setup covers 3 services in one auth flow
- Notion DB structure needed before bot can write todos correctly
- Receipt bot is fully independent — can be built and tested separately
- Timezone: UTC+8 (Kuala Lumpur) — hardcode in config

---

## How the Bot Logic Works

### Message Flow (Bot 1 example)
You send: *"add todo: submit invoice to client by Friday"*

```
You (Telegram app)
    ↓  send message
Telegram Servers
    ↓  webhook POST request
Your VPS (bot server)
    ↓  parse message
Claude API (understand intent)
    ↓  structured data
Notion API (write todo)
    ↓  confirmation
Your VPS
    ↓  reply
You (Telegram app) ← "✅ Added: Submit invoice to client, due Friday"
```

### Bot Server
A continuously running process on your VPS — a simple web server that listens for incoming messages from Telegram and responds.

```
Incoming message
    ↓
Is it from my Telegram user ID? → No → ignore silently
    ↓ Yes
What type of message is it?
    ├── Text → send to Claude to understand intent
    ├── Voice → transcribe with Whisper first, then Claude
    ├── Photo/PDF → send to Claude Vision first, then Claude
    └── Command (/summary, /today) → skip Claude, run directly
```

### Intent Engine (Claude's job)
Every text message is sent to Claude with a system prompt that classifies it into a structured intent:

```
Intents: ADD_TODO, COMPLETE_TODO, LIST_TODOS, ADD_NOTE,
         SET_REMINDER, ADD_CALENDAR_EVENT, READ_CALENDAR,
         ADD_EXPENSE, UNKNOWN
```

Example — you say *"dentist appointment next Tuesday 3pm"*, Claude returns:

```json
{
  "intent": "ADD_CALENDAR_EVENT",
  "title": "Dentist appointment",
  "datetime": "2026-03-03T15:00:00",
  "calendar": "personal"
}
```

Bot code takes the JSON and calls the right API — no ambiguity.

### Routing Logic

```
Intent received
    ├── ADD_TODO / LIST_TODOS / COMPLETE_TODO → Notion API
    ├── ADD_NOTE / SET_REMINDER → Notion API + scheduler
    ├── ADD_CALENDAR_EVENT / READ_CALENDAR
    │       ├── "personal" or ambiguous → Outlook API (bryanckl@hotmail.com)
    │       └── "freelance" or "work" → Google Calendar API (bryanchong32@gmail.com)
    ├── ADD_EXPENSE → Claude Vision → Google Sheets + Google Drive
    └── UNKNOWN → Claude replies conversationally
```

### Reminders — How Scheduling Works
When you say *"remind me Friday 9am to check lease renewal"*:
1. Note saved to Notion immediately
2. Job written to scheduler table on VPS (`remind_at`, `chat_id`, `message`)
3. Background worker checks every minute — if `remind_at <= now`, send Telegram message

```
Scheduler table
┌─────────────────────┬─────────────┬──────────────────────────┐
│ remind_at           │ chat_id     │ message                  │
├─────────────────────┼─────────────┼──────────────────────────┤
│ 2026-02-27 09:00:00 │ 12345678    │ Check lease renewal      │
│ 2026-03-01 08:00:00 │ 12345678    │ Morning briefing         │
└─────────────────────┴─────────────┴──────────────────────────┘
```

### Receipt Bot Flow (Bot 2)

```
You send receipt photo
    ↓
Telegram → VPS (image file received)
    ↓
Download image from Telegram servers
    ↓
Send image to Claude Vision API
    ↓
Claude extracts:
  - Merchant, Date, Amount, Category (inferred), Currency
    ↓
Append row to Google Sheets
    ↓
Upload original image to Google Drive /receipts/2026/02/
    ↓
Reply: "✅ Logged RM45 at Grab, 23 Feb, Transport"
```

### Edge Cases
- Claude misreads intent → bot asks for clarification
- API is down → bot catches error and notifies you
- Ambiguous calendar → defaults to personal, or asks you

---

## Security

### How It's Secured

**Telegram side:**
- All messages encrypted in transit (TLS)
- Bot token is the only credential to operate the bot — store securely on VPS, never commit to code
- Bot username is unlisted — only you know it exists

**Your VPS side:**
- All API keys stored in environment variables, not in code
- User ID whitelist — bot silently ignores anyone who isn't you

**Whitelist implementation:**
```python
ALLOWED_USER_ID = 12345678  # your Telegram user ID

def handle_message(update):
    if update.from_user.id != ALLOWED_USER_ID:
        return  # silently ignore, don't even reply

    # proceed with normal logic
```

### Security Checklist (before going live)
- [ ] Bot token stored in `.env` file, not hardcoded
- [ ] `.env` file excluded from any git repository (`.gitignore`)
- [ ] Telegram user ID whitelist implemented in both bots
- [ ] All API keys (Anthropic, Notion, Google, Microsoft) in `.env`
- [ ] VPS firewall — only expose webhook port (443), close everything else
- [ ] Use HTTPS for webhook endpoint (Telegram requires this)
- [ ] Regularly rotate bot token if you suspect exposure
- [ ] Google + Microsoft OAuth tokens stored securely, refresh token handled in code

### Honest Caveats
- Messages pass through Telegram's servers momentarily — not end-to-end encrypted like Signal
- Receipt photos and calendar details are visible to Telegram infrastructure briefly in transit
- For personal productivity use, this is widely considered acceptable
- If handling highly sensitive corporate data, consider a self-hosted messaging alternative
