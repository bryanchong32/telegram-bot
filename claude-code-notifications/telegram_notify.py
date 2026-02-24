#!/usr/bin/env python3
"""Claude Code hook: sends Telegram notifications on Stop, Notification, and question events."""

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

BOT_TOKEN = "8607806363:AAF6bmWqSIkp4iX3hW8hvIkq4G2alSyAyo8"
CHAT_ID = "873921891"

# Only read the last N bytes of transcript to keep hook execution fast
TAIL_BYTES = 50000


def format_duration(seconds):
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes, secs = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {secs}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m"


def read_transcript_tail(transcript_path):
    if not transcript_path:
        return []
    try:
        file_size = os.path.getsize(transcript_path)
        with open(transcript_path, "r", encoding="utf-8") as f:
            if file_size > TAIL_BYTES:
                f.seek(file_size - TAIL_BYTES)
                f.readline()
            return f.readlines()
    except OSError:
        return []


def get_project_name(cwd):
    if not cwd:
        return None
    return os.path.basename(os.path.normpath(cwd))


def get_project_from_transcript(lines, fallback_cwd):
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("type") != "assistant":
            continue
        content = entry.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "tool_use":
                continue
            input_data = item.get("input", {})
            file_path = input_data.get("file_path") or input_data.get("path") or ""
            if not file_path:
                continue
            normalized = os.path.normpath(file_path)
            parts = normalized.replace("/", os.sep).split(os.sep)
            for i, part in enumerate(parts):
                if part.lower() == "desktop" and i + 1 < len(parts):
                    return parts[i + 1]
    return get_project_name(fallback_cwd)


def get_task_duration(lines):
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("type") != "user":
            continue
        content = entry.get("message", {}).get("content", [])
        if isinstance(content, list) and any(
            isinstance(c, dict) and c.get("type") == "text" for c in content
        ):
            ts_str = entry.get("timestamp")
            if not ts_str:
                return None
            try:
                ts = ts_str.replace("Z", "+00:00")
                start = datetime.fromisoformat(ts)
                elapsed = (datetime.now(timezone.utc) - start).total_seconds()
                return format_duration(elapsed) if elapsed >= 0 else None
            except ValueError:
                return None
    return None



def main():
    # Hook mode: read stdin, build message, spawn background sender
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(1)

    event = data.get("hook_event_name", "")
    is_question = event == "PreToolUse" and data.get("tool_name") == "AskUserQuestion"

    if event == "Stop":
        prefix = "\u2705"
        message = data.get("last_assistant_message", "")
        for sep in [".\n", ". ", "\n"]:
            idx = message.find(sep)
            if idx != -1:
                message = message[:idx + 1]
                break
        if len(message) > 80:
            message = message[:77] + "..."
    elif event == "Notification":
        prefix = "\u23f3"
        message = data.get("message", "")
    elif is_question:
        prefix = "\u2753"
        tool_input = data.get("tool_input", {})
        questions = tool_input.get("questions", [])
        if questions:
            message = questions[0].get("question", "Claude is asking a question")
        else:
            message = "Claude is asking a question"
        if len(message) > 80:
            message = message[:77] + "..."
    else:
        prefix = "\u2139\ufe0f"
        message = data.get("message", "") or data.get("last_assistant_message", "")

    transcript_lines = read_transcript_tail(data.get("transcript_path", ""))

    msg_lines = []

    project = get_project_from_transcript(transcript_lines, data.get("cwd", ""))
    if project:
        msg_lines.append(f"\ud83d\udcc2 {project}")

    msg_lines.append(f"{prefix} {message}" if message else f"{prefix} Claude Code event: {event}")

    if not is_question:
        duration = get_task_duration(transcript_lines)
        if duration:
            msg_lines.append(f"\u23f1\ufe0f {duration}")

    text = "\n".join(msg_lines)

    # Spawn a detached background process to send the Telegram message
    # This lets the hook exit immediately so Claude Code isn't blocked
    # Uses inline python -c to avoid path resolution issues with __file__
    CREATE_NO_WINDOW = 0x08000000
    send_code = (
        "import urllib.request,json;"
        f"urllib.request.urlopen(urllib.request.Request("
        f"'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',"
        f"data=json.dumps({{'chat_id':'{CHAT_ID}','text':{json.dumps(text)}}}).encode(),"
        f"headers={{'Content-Type':'application/json'}}),timeout=10)"
    )
    subprocess.Popen(
        [sys.executable, "-c", send_code],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=CREATE_NO_WINDOW,
    )


if __name__ == "__main__":
    main()
