#!/usr/bin/env python3
"""Claude Code hook: sends Telegram notifications on Stop and Notification events."""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

BOT_TOKEN = "8607806363:AAF6bmWqSIkp4iX3hW8hvIkq4G2alSyAyo8"
CHAT_ID = "873921891"


def format_duration(seconds):
    """Format seconds into a human-readable duration string."""
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes, secs = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {secs}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m"


def get_project_name(cwd):
    """Extract the last folder name from the working directory path."""
    if not cwd:
        return None
    # Normalize both Windows and Unix paths
    return os.path.basename(os.path.normpath(cwd))


def get_project_from_transcript(transcript_path, fallback_cwd):
    """Determine the actual project by looking at recent file operations in the transcript.

    In multi-root VSCode workspaces, `cwd` is always the primary folder,
    even when work was done in a different project. This reads the transcript
    backwards to find the most recent file path from tool uses, then extracts
    the project folder from it.
    """
    if not transcript_path:
        return get_project_name(fallback_cwd)

    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        # Read backwards, find file paths from recent tool uses
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
                # Extract file_path from common tools (Read, Edit, Write, Glob, Grep)
                file_path = input_data.get("file_path") or input_data.get("path") or ""
                if not file_path:
                    continue

                # Normalize and extract project folder
                # Projects are under Desktop: C:\Users\user\Desktop\{project}\...
                normalized = os.path.normpath(file_path)
                parts = normalized.replace("/", os.sep).split(os.sep)
                for i, part in enumerate(parts):
                    if part.lower() == "desktop" and i + 1 < len(parts):
                        return parts[i + 1]

    except (OSError, KeyError, ValueError):
        pass

    return get_project_name(fallback_cwd)


def get_task_duration(transcript_path):
    """Calculate task duration from the last user prompt in the transcript."""
    if not transcript_path:
        return None
    try:
        # Read the transcript JSONL backwards to find the last real user message
        with open(transcript_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        last_user_prompt_time = None
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Look for user messages with actual text content (not tool results)
            if entry.get("type") != "user":
                continue
            content = entry.get("message", {}).get("content", [])
            if isinstance(content, list) and any(
                isinstance(c, dict) and c.get("type") == "text" for c in content
            ):
                last_user_prompt_time = entry.get("timestamp")
                break

        if not last_user_prompt_time:
            return None

        # Parse the ISO 8601 timestamp
        # Handle both "2026-02-24T05:08:36.080Z" and without milliseconds
        ts = last_user_prompt_time.replace("Z", "+00:00")
        start = datetime.fromisoformat(ts)
        now = datetime.now(timezone.utc)
        elapsed = (now - start).total_seconds()
        if elapsed < 0:
            return None
        return format_duration(elapsed)
    except (OSError, KeyError, ValueError):
        return None


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(1)

    event = data.get("hook_event_name", "")

    if event == "Stop":
        prefix = "\u2705"
        message = data.get("last_assistant_message", "")
        # Extract first sentence only, capped at 80 chars
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
    else:
        prefix = "\u2139\ufe0f"
        message = data.get("message", "") or data.get("last_assistant_message", "")

    # Build the message lines
    lines = []

    project = get_project_from_transcript(
        data.get("transcript_path", ""), data.get("cwd", "")
    )
    if project:
        lines.append(f"\ud83d\udcc2 {project}")

    lines.append(f"{prefix} {message}" if message else f"{prefix} Claude Code event: {event}")

    duration = get_task_duration(data.get("transcript_path", ""))
    if duration:
        lines.append(f"\u23f1\ufe0f {duration}")

    text = "\n".join(lines)

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = json.dumps({"chat_id": CHAT_ID, "text": text}).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except urllib.error.URLError as e:
        print(f"Telegram send failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
