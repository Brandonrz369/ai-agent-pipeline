#!/usr/bin/env python3
"""Usage tracker for AI Agent Pipeline.

Monitors agent session sizes and turn counts, sends Discord notifications
at configurable thresholds (every 15% by default).

Usage:
    usage-tracker.py check           — Check all active agent sessions
    usage-tracker.py summary         — Weekly summary of total usage
    usage-tracker.py reset-alerts    — Clear notification state (e.g., after credit reset)

Reads session IDs from /tmp/pipeline-driver/{agent}-session-id.txt
Stores notification state in /tmp/pipeline-driver/usage-state.json

Environment:
    MAX_TURNS_PER_SESSION  — Budget per agent session (default: 100)
    NOTIFY_INTERVAL        — Percentage interval for notifications (default: 15)
    DISCORD_WEBHOOK_URL    — Discord webhook for direct notifications
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


PIPELINE_DIR = "/home/brans/ai-agent-pipeline"
SESSION_DIR = Path.home() / ".claude" / "projects" / "-home-brans-ai-agent-pipeline"
DRIVER_DIR = Path("/tmp/pipeline-driver")
STATE_FILE = DRIVER_DIR / "usage-state.json"
LOG_FILE = Path.home() / ".openclaw" / "logs" / "pipeline-driver.log"
MESSAGES_FILE = Path(PIPELINE_DIR) / ".collab" / "shared" / "MESSAGES.md"

AGENTS = ["alpha", "bravo", "charlie"]
MAX_TURNS = int(os.environ.get("MAX_TURNS_PER_SESSION", "100"))
NOTIFY_INTERVAL = int(os.environ.get("NOTIFY_INTERVAL", "15"))


def log(msg: str):
    line = f"{datetime.now().isoformat()} USAGE: {msg}\n"
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(line)
    except Exception:
        pass
    print(msg, file=sys.stderr)


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {"notified": {}, "cumulative_turns": {}, "last_reset_check": None}


def save_state(state: dict):
    DRIVER_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, default=str))


def get_session_id(agent: str) -> str | None:
    sid_file = DRIVER_DIR / f"{agent}-session-id.txt"
    if sid_file.exists():
        sid = sid_file.read_text().strip()
        if sid:
            return sid
    return None


def count_turns(session_id: str) -> dict:
    """Count assistant turns and estimate tokens for a session."""
    jsonl_path = SESSION_DIR / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return {"assistant_turns": 0, "user_turns": 0, "total_lines": 0, "file_size_kb": 0}

    assistant_turns = 0
    user_turns = 0
    total_lines = 0
    tool_calls = 0

    with open(jsonl_path) as f:
        for line in f:
            total_lines += 1
            try:
                d = json.loads(line)
                t = d.get("type", "")
                if t == "assistant":
                    assistant_turns += 1
                    # Count tool use blocks
                    msg = d.get("message", {})
                    if isinstance(msg, dict):
                        for block in msg.get("content", []):
                            if isinstance(block, dict) and block.get("type") == "tool_use":
                                tool_calls += 1
                elif t == "user":
                    user_turns += 1
            except json.JSONDecodeError:
                pass

    file_size_kb = jsonl_path.stat().st_size / 1024

    return {
        "assistant_turns": assistant_turns,
        "user_turns": user_turns,
        "tool_calls": tool_calls,
        "total_lines": total_lines,
        "file_size_kb": round(file_size_kb, 1),
    }


def send_notification(title: str, message: str):
    """Send notification via discord-notify.py."""
    try:
        subprocess.run(
            [sys.executable, f"{PIPELINE_DIR}/scripts/discord-notify.py", title, message],
            timeout=30,
            capture_output=True,
        )
    except Exception as e:
        log(f"Notification failed: {e}")

    # Always write to MESSAGES.md as backup
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    try:
        with open(MESSAGES_FILE, "a") as f:
            f.write(f"\n[{ts}] USAGE-TRACKER: **{title}**\n- {message}\n")
    except Exception:
        pass


def check_agents():
    """Check all active agent sessions and send notifications at thresholds."""
    state = load_state()
    notified = state.get("notified", {})
    cumulative = state.get("cumulative_turns", {})
    any_alert = False

    for agent in AGENTS:
        session_id = get_session_id(agent)
        if not session_id:
            continue

        stats = count_turns(session_id)
        turns = stats["assistant_turns"]
        pct = round((turns / MAX_TURNS) * 100) if MAX_TURNS > 0 else 0

        # Track cumulative
        cumulative[agent] = cumulative.get(agent, 0)
        # Update with latest from this session
        key = f"{agent}:{session_id}"

        # What threshold have we already notified for?
        last_notified_pct = notified.get(key, 0)

        # Find the next threshold
        next_threshold = last_notified_pct + NOTIFY_INTERVAL

        if pct >= next_threshold and pct > last_notified_pct:
            # Determine severity
            if pct >= 90:
                severity = "CRITICAL"
                color_word = "red"
            elif pct >= 75:
                severity = "WARNING"
                color_word = "orange"
            elif pct >= 50:
                severity = "MODERATE"
                color_word = "yellow"
            else:
                severity = "INFO"
                color_word = "blue"

            title = f"{severity}: {agent.upper()} at {pct}% usage"
            message = (
                f"Agent {agent.upper()} has used {turns}/{MAX_TURNS} turns "
                f"({pct}%) in session {session_id[:8]}. "
                f"File size: {stats['file_size_kb']}KB, "
                f"Tool calls: {stats['tool_calls']}."
            )

            if pct >= 90:
                message += " Agent may exhaust usage soon — consider pausing or switching to Sonnet."

            log(f"{title} — {message}")
            send_notification(title, message)

            # Update notification state to current threshold bucket
            notified[key] = (pct // NOTIFY_INTERVAL) * NOTIFY_INTERVAL
            any_alert = True

        # Update cumulative
        cumulative[agent] = turns

    state["notified"] = notified
    state["cumulative_turns"] = cumulative
    state["last_check"] = datetime.now(timezone.utc).isoformat()
    save_state(state)

    if not any_alert:
        # Print status summary to stderr
        for agent in AGENTS:
            sid = get_session_id(agent)
            if sid:
                stats = count_turns(sid)
                pct = round((stats["assistant_turns"] / MAX_TURNS) * 100) if MAX_TURNS > 0 else 0
                log(f"{agent.upper()}: {stats['assistant_turns']}/{MAX_TURNS} turns ({pct}%), {stats['file_size_kb']}KB")
            else:
                log(f"{agent.upper()}: no active session")

    return state


def weekly_summary():
    """Generate a weekly usage summary across all sessions."""
    total_turns = 0
    total_size_kb = 0
    agent_stats = {}

    # Count all sessions from the past 7 days
    now = datetime.now()
    week_ago = now.timestamp() - (7 * 24 * 3600)

    if SESSION_DIR.exists():
        for jsonl in SESSION_DIR.glob("*.jsonl"):
            if jsonl.stat().st_mtime >= week_ago:
                stats = count_turns(jsonl.stem)
                total_turns += stats["assistant_turns"]
                total_size_kb += stats["file_size_kb"]

                # Try to identify agent
                try:
                    with open(jsonl) as f:
                        content = f.read(5000)
                    for agent in AGENTS:
                        if agent.upper() in content:
                            agent_stats[agent] = agent_stats.get(agent, 0) + stats["assistant_turns"]
                            break
                except Exception:
                    pass

    title = "Weekly Pipeline Usage Summary"
    lines = [
        f"Total turns this week: {total_turns}",
        f"Total session data: {round(total_size_kb / 1024, 1)}MB",
    ]
    for agent in AGENTS:
        if agent in agent_stats:
            lines.append(f"  {agent.upper()}: {agent_stats[agent]} turns")

    # Count sessions
    session_count = 0
    if SESSION_DIR.exists():
        session_count = sum(1 for f in SESSION_DIR.glob("*.jsonl") if f.stat().st_mtime >= week_ago)
    lines.append(f"Active sessions this week: {session_count}")

    message = "\n".join(lines)
    log(f"Weekly summary: {message}")
    send_notification(title, message)
    return message


def reset_alerts():
    """Clear notification state — call when credits reset."""
    state = load_state()
    state["notified"] = {}
    state["last_reset"] = datetime.now(timezone.utc).isoformat()
    save_state(state)
    log("Alert state cleared — notifications will re-trigger from 0%")
    send_notification("Usage Reset", "Alert state cleared. Fresh notification cycle starting.")


def main():
    if len(sys.argv) < 2:
        print("Usage: usage-tracker.py <check|summary|reset-alerts>", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "check":
        check_agents()
    elif cmd == "summary":
        weekly_summary()
    elif cmd == "reset-alerts":
        reset_alerts()
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
