#!/usr/bin/env python3
"""NEXUS Gemini 3.1 Pro fallback for pipeline driver decisions.

Called when ORACLE (Claude Code brain) is unavailable (tokens exhausted).
Uses Antigravity proxy (localhost:8080) to query Gemini — this is FREE.
"""

import json
import re
import sys
import urllib.request


ANTIGRAVITY_URL = "http://127.0.0.1:8080/v1/messages"


def call_gemini(prompt: str, max_tokens: int = 2048) -> str:
    """Call Gemini 3.1 Pro via Antigravity proxy."""
    body = json.dumps({
        "model": "gemini-3.1-pro-high",
        "max_tokens": max_tokens,
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

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")

    return text


def extract_json(text: str) -> dict | None:
    """Extract JSON object from Gemini response text."""
    # Strip markdown fences
    text = re.sub(r'```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```', '', text)
    text = text.strip()

    brace_start = text.find('{')
    brace_end = text.rfind('}')
    if brace_start >= 0 and brace_end > brace_start:
        try:
            return json.loads(text[brace_start:brace_end + 1])
        except json.JSONDecodeError:
            pass

    # Try smaller blocks
    for match in re.finditer(r'\{[^{}]*\}', text):
        try:
            d = json.loads(match.group())
            if 'spawn_bravo' in d or 'spawn_charlie' in d or 'spawn_alpha' in d:
                return d
        except json.JSONDecodeError:
            continue

    return None


def main():
    if len(sys.argv) < 5:
        print("Usage: gemini-fallback.py <alpha_running> <bravo_running> <charlie_running> <open_tasks_file>",
              file=sys.stderr)
        print("")
        sys.exit(0)

    alpha_running = sys.argv[1]
    bravo_running = sys.argv[2]
    charlie_running = sys.argv[3]
    open_tasks_file = sys.argv[4]

    try:
        with open(open_tasks_file, 'r') as f:
            open_tasks = f.read().strip()
    except FileNotFoundError:
        open_tasks = "No OPEN tasks found"

    prompt = f"""You are NEXUS, the Pipeline Driver. Decide which Claude Code agent sessions to spawn.

Current state:
- ALPHA (supervisor) tmux running: {alpha_running}
- BRAVO (builder 1) tmux running: {bravo_running}
- CHARLIE (builder 2) tmux running: {charlie_running}

OPEN/WORKING tasks from taskboard:
{open_tasks}

Rules:
1. If tmux=no for an agent, spawn them with a task
2. If tmux=yes, do NOT spawn (they're already working)
3. ALPHA should ALWAYS be running — if tmux=no, always spawn ALPHA
4. ALPHA's prompt must start with: "Read .collab/alpha/IDENTITY.md first."
5. BRAVO's prompt must start with: "Read .collab/bravo/IDENTITY.md first."
6. CHARLIE's prompt must start with: "Read .collab/charlie/IDENTITY.md first."
7. Be SPECIFIC in prompts: tell the agent exactly which files to read, what to create, step by step
8. Tell BRAVO and CHARLIE to EXIT when done. Tell ALPHA to stand by after supervision.
9. Agent working directory is /home/brans/ai-agent-pipeline
10. Collab files are in /home/brans/ai-agent-pipeline/.collab/
11. BRAVO handles: execution path (T19, T20, T21, T24, T25, T27)
12. CHARLIE handles: verification path (T22, T23, T26, T28)

Reply with ONLY a JSON object, no markdown fences:
{{"spawn_alpha": true/false, "alpha_prompt": "exact prompt", "spawn_bravo": true/false, "bravo_prompt": "exact prompt", "spawn_charlie": true/false, "charlie_prompt": "exact prompt", "reasoning": "brief explanation"}}"""

    try:
        response_text = call_gemini(prompt)
        decision = extract_json(response_text)
        if decision and ('spawn_bravo' in decision or 'spawn_charlie' in decision or 'spawn_alpha' in decision):
            print(json.dumps(decision))
        else:
            print("", end="")
    except Exception as e:
        print(f"NEXUS Gemini fallback error: {e}", file=sys.stderr)
        print("", end="")


if __name__ == '__main__':
    main()
