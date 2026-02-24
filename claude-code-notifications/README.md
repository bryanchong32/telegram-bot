# Claude Code Telegram Notification Hook

## Overview

A Python script that sends Telegram messages when Claude Code fires **Stop** or **Notification** events, so Bryan gets pinged on his phone when Claude finishes a task or needs input.

## Files

| File | Purpose |
|------|---------|
| `~/.claude/telegram_notify.py` | Python script that reads hook JSON from stdin and sends a Telegram message |
| `~/.claude/settings.json` | Claude Code config that wires Stop and Notification events to the script |

## Telegram Bot Details

- **Bot token**: `8607806363:AAF6bmWqSIkp4iX3hW8hvIkq4G2alSyAyo8`
- **Chat ID**: `873921891` (Bryan Chong / @bryanchong32)
- **API endpoint**: `https://api.telegram.org/bot{TOKEN}/sendMessage`

## How It Works

1. Claude Code fires a hook event and pipes JSON to the script's stdin
2. The script reads the JSON and extracts the relevant message field
3. It determines the project name by reading the transcript JSONL backwards for recent file paths, falling back to `cwd` if none found
4. For Stop events, it extracts only the first sentence (capped at 80 chars) from `last_assistant_message`
5. It calculates task duration by reading the transcript JSONL to find the last user prompt timestamp
6. It prefixes the message with an emoji based on event type
7. It sends a multi-line message to Telegram via the bot HTTP API (plain text, no parse_mode)

## Hook Event Payloads

Claude Code passes different JSON fields depending on the event:

### Stop Event
```json
{
  "hook_event_name": "Stop",
  "last_assistant_message": "I've completed the task...",
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "stop_hook_active": true
}
```
- **Key field**: `last_assistant_message` — Claude's final response text
- **Prefix**: ✅

### Notification Event
```json
{
  "hook_event_name": "Notification",
  "message": "Claude needs your permission to run: npm install",
  "title": "Permission needed",
  "notification_type": "permission_prompt",
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory"
}
```
- **Key field**: `message` — the notification text
- **Other useful fields**: `title`, `notification_type` (`permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`)
- **Prefix**: ⏳

### Common Fields (all events)
- `session_id` — current session identifier
- `transcript_path` — path to conversation JSONL file (also used to parse file paths and timestamps)
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
✅ I finished refactoring the auth module.
⏱️ 4m 32s
```

- **Line 1**: Project name — detected from recent file paths in transcript, fallback to `cwd`
- **Line 2**: Event message — prefixed with ✅ (Stop, first sentence only) or ⏳ (Notification)
- **Line 3**: Task duration — time from user's last prompt to now (parsed from transcript JSONL)

## Current Behavior

- Stop messages show first sentence only, capped at 80 chars (splits on `. `, `.\n`, or `\n`)
- **Project detection**: reads transcript JSONL backwards, finds the most recent `tool_use` with a `file_path` or `path` input, extracts the project folder name by looking for the directory after `Desktop` in the path. Falls back to `cwd` if no file paths found. This is needed because in multi-root VSCode workspaces, `cwd` is always the primary folder even when work was done in a different project
- Task duration is calculated by reading the transcript JSONL backwards to find the last user message with `"type":"text"` content, then comparing its `timestamp` to the current time
- Duration format: `42s`, `3m 12s`, or `1h 15m`
- Sends plain text (no `parse_mode`) — avoids HTML parsing issues with `<` and `&` in messages
- No external dependencies — uses only Python stdlib (`urllib`, `json`, `os`, `time`, `datetime`)
- Exits with code 1 on failure (malformed JSON or network error)

## Settings.json Structure

The hooks in `settings.json` use empty `matcher` strings (match everything). If other settings exist in this file (permissions, etc.), the `hooks` key must be merged without overwriting them.

```json
{
  "hooks": {
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "python ~/.claude/telegram_notify.py" }] }],
    "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "python ~/.claude/telegram_notify.py" }] }]
  }
}
```

## Platform Notes

- Windows 11 — uses `python` (not `python3`)
- Script has a `#!/usr/bin/env python3` shebang but that's only relevant on Unix
- The `~/.claude/` path expands correctly in the hook command on Windows via Git Bash

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

## Feature Ideas / Possible Improvements

- Add more hook events (e.g., `PreToolUse`, `PostToolUse`) for finer-grained notifications
- Add rate limiting to avoid spam during rapid Stop/Notification cycles
- Support Telegram markdown formatting for code blocks in messages
- Add a quiet hours / do-not-disturb schedule
- Log failed sends to a local file for debugging
- Map folder names to friendly display names (e.g., `mom-crm-webapp` → `EcomWave CRM`)
