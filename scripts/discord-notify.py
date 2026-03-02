#!/usr/bin/env python3
"""Send Discord notification via OpenClaw or direct webhook.

Used by pipeline-driver to notify the user when:
- Claude Code tokens are exhausted
- Critical errors occur
- Agents need human intervention

Tries multiple delivery methods:
1. Direct Discord webhook (if DISCORD_WEBHOOK_URL is set)
2. OpenClaw Discord skill (if available)
3. Gemini compose via Antigravity or OpenRouter + log to MESSAGES.md
"""

import json
import os
import subprocess
import sys
import urllib.request


ANTIGRAVITY_URL = "http://127.0.0.1:8080/v1/messages"
LOG_FILE = os.path.expanduser("~/.openclaw/logs/pipeline-driver.log")


def log(msg: str):
    """Append to driver log."""
    from datetime import datetime
    line = f"{datetime.now().isoformat()} DISCORD: {msg}\n"
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line)
    except:
        pass


def try_openclaw_discord(title: str, message: str) -> bool:
    """Try sending via OpenClaw's Discord integration."""
    try:
        # OpenClaw can send Discord messages through its gateway
        result = subprocess.run(
            ["openclaw", "run", "-m",
             f"Send a Discord message with title '{title}' and body: {message}"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            log(f"Sent via OpenClaw: {title}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return False


def try_webhook(title: str, message: str) -> bool:
    """Try sending via direct Discord webhook."""
    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL", "")
    if not webhook_url:
        return False

    try:
        payload = json.dumps({
            "embeds": [{
                "title": f"Pipeline Driver: {title}",
                "description": message,
                "color": 16744448,  # Orange
            }]
        })
        req = urllib.request.Request(
            webhook_url,
            data=payload.encode('utf-8'),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status in (200, 204):
                log(f"Sent via webhook: {title}")
                return True
    except Exception as e:
        log(f"Webhook failed: {e}")
    return False


def try_gemini_compose(title: str, message: str) -> bool:
    """Use Gemini to acknowledge the situation and log recommendations.
    Tries Antigravity first, falls back to OpenRouter."""
    prompt = f"""The OpenClaw Pipeline Driver has detected an issue:

Title: {title}
Details: {message}

Please compose a brief status update (2-3 sentences) acknowledging this situation.
Reply with just the status update text, no JSON."""

    text = ""

    # Try Antigravity (free)
    try:
        body = json.dumps({
            "model": "gemini-3.1-pro-high",
            "max_tokens": 256,
            "messages": [{"role": "user", "content": prompt}],
        })
        req = urllib.request.Request(
            ANTIGRAVITY_URL,
            data=body.encode('utf-8'),
            headers={
                "Content-Type": "application/json",
                "x-api-key": "pipeline",
                "anthropic-version": "2023-06-01",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        if data.get("type") != "error":
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text += block.get("text", "")
    except Exception as e:
        log(f"Antigravity compose failed: {e}")

    # Fall back to OpenRouter
    if not text.strip():
        openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
        openrouter_model = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash")
        if openrouter_key:
            try:
                body = json.dumps({
                    "model": openrouter_model,
                    "max_tokens": 256,
                    "messages": [{"role": "user", "content": prompt}],
                })
                req = urllib.request.Request(
                    "https://openrouter.ai/api/v1/chat/completions",
                    data=body.encode('utf-8'),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {openrouter_key}",
                    },
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
                choices = data.get("choices", [])
                if choices:
                    text = choices[0].get("message", {}).get("content", "")
                log("Used OpenRouter for compose")
            except Exception as e:
                log(f"OpenRouter compose failed: {e}")

    if text.strip():
        log(f"Gemini status: {text.strip()[:500]}")
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        msg_path = "/home/brans/ai-agent-pipeline/.collab/shared/MESSAGES.md"
        with open(msg_path, 'a') as f:
            f.write(f"\n[{ts}] OPENCLAW-DRIVER->ALPHA: **{title}**\n")
            f.write(f"- {text.strip()[:500]}\n")
        return True
    return False


def main():
    if len(sys.argv) < 3:
        print("Usage: discord-notify.py <title> <message>", file=sys.stderr)
        sys.exit(1)

    title = sys.argv[1]
    message = sys.argv[2]

    # Try delivery methods in order
    if try_webhook(title, message):
        return
    if try_openclaw_discord(title, message):
        return
    # Always try Gemini compose as last resort (writes to MESSAGES.md)
    try_gemini_compose(title, message)


if __name__ == '__main__':
    main()
