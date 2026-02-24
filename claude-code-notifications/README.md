# Claude Code Telegram Notification Hook

## Overview

A Python script that sends Telegram messages when Claude Code fires **Stop**, **Notification**, or **AskUserQuestion** events, so Bryan gets pinged on his phone when Claude finishes a task, needs permission, or asks a question.

## Files

| File | Purpose |
|------|---------|
| `~/.claude/telegram_notify.py` | Python script that reads hook JSON from stdin and sends a Telegram message |
| `~/.claude/settings.json` | Claude Code config that wires Stop, Notification, and PreToolUse events to the script |

## Telegram Bot Details

- **Bot token**: `8607806363:AAF6bmWqSIkp4iX3hW8hvIkq4G2alSyAyo8`
- **Chat ID**: `873921891` (Bryan Chong / @bryanchong32)
- **API endpoint**: `https://api.telegram.org/bot{TOKEN}/sendMessage`

## How It Works

1. Claude Code fires a hook event and pipes JSON to the script's stdin
2. The script reads the JSON and extracts the relevant message field
3. It reads only the **last 50KB** of the transcript JSONL (via `seek()`) for project detection and duration
4. It determines the project name from recent file paths in the transcript, falling back to `cwd`
5. For Stop events, it extracts only the first sentence (capped at 80 chars) from `last_assistant_message`
6. For question events, duration is skipped (task still in progress)
7. It prefixes the message with an emoji based on event type
8. It **spawns a detached background process** (`python -c "..."`) to send the HTTP request, then exits immediately so Claude Code isn't blocked

## Hook Events

### Stop Event — ✅
Fires when Claude finishes responding.
```json
{
  "hook_event_name": "Stop",
  "last_assistant_message": "I've completed the task...",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "stop_hook_active": true
}
```
- **Key field**: `last_assistant_message`

### Notification Event — ⏳
Fires for system notifications (permission prompts, idle, etc.).
```json
{
  "hook_event_name": "Notification",
  "message": "Claude needs your permission to run: npm install",
  "notification_type": "permission_prompt",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory"
}
```
- **Key field**: `message`
- **Note**: Does NOT fire for AskUserQuestion — that requires a separate PreToolUse hook

### PreToolUse (AskUserQuestion) Event — ❓
Fires when Claude is about to ask the user a question.
```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "AskUserQuestion",
  "tool_input": {
    "questions": [{"question": "Which approach do you prefer?", "header": "...", "options": [...]}]
  },
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory"
}
```
- **Key field**: `tool_input.questions[0].question`
- **Important**: PreToolUse hooks have a tight timeout — the script must exit fast. This is why we spawn a detached background process for the Telegram HTTP send.

### Common Fields (all events)
- `session_id` — current session identifier
- `transcript_path` — path to conversation JSONL file
- `cwd` — working directory (**unreliable in multi-root VSCode workspaces** — always the primary folder)
- `hook_event_name` — which event fired

### Transcript JSONL Format
Each line is a JSON object. Key entry types:
- **User messages**: `{"type": "user", "message": {"content": [{"type": "text", "text": "..."}]}, "timestamp": "..."}`
- **Tool results**: `{"type": "user", "message": {"content": [{"tool_use_id": "...", "type": "tool_result", ...}]}}`
- **Assistant tool use**: `{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": "..."}}]}}`

## Message Format

Each notification has up to 3 lines:
```
📂 mom-crm-webapp
✅ Updated the auth module with OAuth2 support.
⏱️ 4m 32s
```

- **Line 1**: Project name — detected from recent file paths in transcript, fallback to `cwd`
- **Line 2**: Event message — prefixed with ✅ (Stop), ⏳ (Notification), or ❓ (Question)
- **Line 3**: Task duration — time from user's last prompt to now (skipped for questions)

## Current Behavior

- Stop messages show first sentence only, capped at 80 chars (splits on `. `, `.\n`, or `\n`)
- Question messages show the question text, capped at 80 chars
- **Project detection**: reads last 50KB of transcript JSONL, finds the most recent `tool_use` with a `file_path` or `path` input, extracts the project folder name by looking for the directory after `Desktop` in the path. Falls back to `cwd` if no file paths found. This is needed because in multi-root VSCode workspaces, `cwd` is always the primary folder even when work was done in a different project
- **Performance**: only reads the tail of the transcript (last 50KB via `seek()`), not the full file. This keeps hook execution under the timeout limit
- **Non-blocking send**: spawns a detached `python -c "..."` process for the HTTP request, exits immediately. Required because PreToolUse hooks have a tight timeout and the Telegram API call can take seconds
- Task duration is calculated by reading the transcript JSONL backwards to find the last user message with `"type":"text"` content, then comparing its `timestamp` to the current time
- Duration format: `42s`, `3m 12s`, or `1h 15m`
- Sends plain text (no `parse_mode`) — avoids HTML parsing issues with `<` and `&` in messages
- No external dependencies — uses only Python stdlib (`urllib`, `json`, `os`, `subprocess`, `datetime`)

## Settings.json Structure

```json
{
  "hooks": {
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "python ~/.claude/telegram_notify.py" }] }],
    "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "python ~/.claude/telegram_notify.py" }] }],
    "PreToolUse": [{ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "python ~/.claude/telegram_notify.py" }] }]
  }
}
```

If other settings exist in this file (permissions, etc.), the `hooks` key must be merged without overwriting them.

## Platform Notes

- Windows 11 — uses `python` (not `python3`)
- Script has a `#!/usr/bin/env python3` shebang but that's only relevant on Unix
- The `~/.claude/` path expands correctly in the hook command on Windows via Git Bash
- Background process uses `CREATE_NO_WINDOW` (0x08000000) creation flag for Windows
- Uses inline `python -c "..."` for the background sender because `__file__` doesn't resolve correctly when the hook runs via `python ~/.claude/telegram_notify.py` (tilde path issue)

## Testing

Piping JSON through Git Bash can mangle Windows backslash paths. Use a Python test harness instead:

```python
# Save as test_hook.py and run with: python test_hook.py
import json, subprocess, sys, os, tempfile

script = os.path.expanduser("~/.claude/telegram_notify.py")
tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl")
tmp.close()

data = json.dumps({
    "hook_event_name": "Stop",
    "last_assistant_message": "Test message from hook harness.",
    "cwd": r"C:\Users\user\Desktop\mom-crm-webapp",
    "transcript_path": tmp.name
})

result = subprocess.run([sys.executable, script], input=data, capture_output=True, text=True)
print("exit:", result.returncode, "stderr:", result.stderr)
```

## Debugging

To enable debug logging, add this function and call it at the top of `main()`:

```python
def debug_log(data):
    log_path = os.path.expanduser("~/.claude/telegram_hook_debug.log")
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            from datetime import datetime
            f.write(f"[{datetime.now().isoformat()}] {json.dumps(data)}\n")
    except OSError:
        pass
```

## Feature Ideas / Possible Improvements

- Add rate limiting to avoid spam during rapid Stop/Notification cycles
- Support Telegram markdown formatting for code blocks in messages
- Add a quiet hours / do-not-disturb schedule
- Map folder names to friendly display names (e.g., `mom-crm-webapp` → `EcomWave CRM`)
