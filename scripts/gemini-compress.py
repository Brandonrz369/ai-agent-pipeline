#!/usr/bin/env python3
"""NEXUS Gemini — State compression and fallback decisions.

Two modes:
  compress <state_file>  — Compress full system state into a focused brainstorm prompt
  decide <alpha> <bravo> <charlie> <tasks_file> — Gemini decides alone (fallback)

Tries Antigravity proxy first (free), falls back to OpenRouter (paid).
Tracks API costs in /tmp/pipeline-driver/cost-tracker.json.
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ANTIGRAVITY_URL = "http://127.0.0.1:8080/v1/messages"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash")
COST_FILE = Path("/tmp/pipeline-driver/cost-tracker.json")

# OpenRouter pricing per 1M tokens (as of March 2026)
PRICING = {
    "google/gemini-2.5-flash": {"input": 0.15, "output": 0.60},
    "google/gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "google/gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "google/gemini-2.5-flash-preview": {"input": 0.15, "output": 0.60},
}


def log(msg: str):
    print(f"gemini-compress: {msg}", file=sys.stderr)


def track_cost(input_tokens: int, output_tokens: int, model: str, caller: str):
    """Track cumulative OpenRouter API costs."""
    try:
        COST_FILE.parent.mkdir(parents=True, exist_ok=True)
        state = json.loads(COST_FILE.read_text()) if COST_FILE.exists() else {
            "total_cost": 0.0, "total_input_tokens": 0, "total_output_tokens": 0,
            "calls": 0, "started": datetime.now(timezone.utc).isoformat(), "by_caller": {}
        }

        pricing = PRICING.get(model, {"input": 0.15, "output": 0.60})
        cost = (input_tokens / 1_000_000 * pricing["input"]) + (output_tokens / 1_000_000 * pricing["output"])

        state["total_cost"] = round(state.get("total_cost", 0) + cost, 6)
        state["total_input_tokens"] = state.get("total_input_tokens", 0) + input_tokens
        state["total_output_tokens"] = state.get("total_output_tokens", 0) + output_tokens
        state["calls"] = state.get("calls", 0) + 1
        state["last_call"] = datetime.now(timezone.utc).isoformat()
        state["model"] = model

        by_caller = state.get("by_caller", {})
        if caller not in by_caller:
            by_caller[caller] = {"cost": 0.0, "calls": 0}
        by_caller[caller]["cost"] = round(by_caller[caller]["cost"] + cost, 6)
        by_caller[caller]["calls"] += 1
        state["by_caller"] = by_caller

        COST_FILE.write_text(json.dumps(state, indent=2))
    except Exception as e:
        log(f"Cost tracking failed: {e}")


def call_antigravity(prompt: str, max_tokens: int = 8192) -> str:
    """Call Gemini via Antigravity proxy (free)."""
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

    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())

    # Check for quota exhaustion
    if data.get("type") == "error":
        raise Exception(data.get("error", {}).get("message", "Antigravity error"))

    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")

    return text


def call_openrouter(prompt: str, max_tokens: int = 8192, caller: str = "unknown") -> str:
    """Call Gemini via OpenRouter (paid, with cost tracking)."""
    if not OPENROUTER_API_KEY:
        raise Exception("OPENROUTER_API_KEY not set")

    body = json.dumps({
        "model": OPENROUTER_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    })

    req = urllib.request.Request(
        OPENROUTER_URL,
        data=body.encode('utf-8'),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": "https://github.com/brans/ai-agent-pipeline",
            "X-Title": "AI Agent Pipeline",
        },
    )

    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read())

    # Extract text from OpenAI-format response
    choices = data.get("choices", [])
    if not choices:
        raise Exception(f"No choices in response: {json.dumps(data)[:200]}")

    text = choices[0].get("message", {}).get("content", "")

    # Track usage/cost
    usage = data.get("usage", {})
    input_tokens = usage.get("prompt_tokens", 0)
    output_tokens = usage.get("completion_tokens", 0)
    model = data.get("model", OPENROUTER_MODEL)
    track_cost(input_tokens, output_tokens, model, caller)

    log(f"OpenRouter: {input_tokens} in + {output_tokens} out tokens (model: {model})")

    return text


def call_gemini(prompt: str, max_tokens: int = 8192, caller: str = "unknown") -> str:
    """Try Antigravity first, fall back to OpenRouter."""
    # Try Antigravity (free)
    try:
        result = call_antigravity(prompt, max_tokens)
        if result.strip():
            log("Used Antigravity (free)")
            return result
    except Exception as e:
        log(f"Antigravity failed: {e}")

    # Fall back to OpenRouter (paid)
    try:
        result = call_openrouter(prompt, max_tokens, caller)
        if result.strip():
            return result
    except Exception as e:
        log(f"OpenRouter failed: {e}")

    return ""


def extract_json(text: str) -> dict | None:
    """Extract JSON object from Gemini response text."""
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

    for match in re.finditer(r'\{[^{}]*\}', text):
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            continue

    return None


def compress_state(state_file: str) -> None:
    """Compress full system state into a focused brainstorm prompt for Claude."""
    try:
        with open(state_file, 'r') as f:
            full_state = f.read()
    except FileNotFoundError:
        print("Error: State file not found", file=sys.stderr)
        print("")
        sys.exit(1)

    prompt = f"""You are NEXUS, the autonomous body for the AI Agent Pipeline. Your job is to compress the following full system state into a focused, strategic question for the brain (Claude Code).

FULL SYSTEM STATE:
{full_state}

YOUR TASK:
1. Read ALL the state above — taskboard, agent statuses, git state, messages, browser state, everything
2. Identify what needs attention: idle agents, blocked tasks, new opportunities, risks
3. Compress this into a SINGLE focused brainstorm prompt that asks Claude Code (the brain) to make strategic decisions

OUTPUT FORMAT:
Write a focused prompt for Claude that includes:
- Current situation summary (2-3 sentences max)
- Which agents are running/idle (one line each)
- Key tasks that need assignment or attention
- Specific questions for Claude to answer
- End with: "Return a JSON object with an 'actions' array and 'reasoning' string. Each action has a 'type' field."

IMPORTANT:
- Do NOT make decisions yourself — compress state so Claude can decide
- Keep the prompt focused — Claude should be able to read it in under 30 seconds
- Include all relevant context — don't drop important details
- Reference the decision schema at templates/decision-schema.json

Write ONLY the brainstorm prompt, nothing else."""

    try:
        compressed = call_gemini(prompt, max_tokens=8192, caller="compress")
        if compressed.strip():
            print(compressed.strip())
        else:
            print("")
    except Exception as e:
        print(f"Gemini compression error: {e}", file=sys.stderr)
        print("")


def decide_alone(alpha_running: str, bravo_running: str, charlie_running: str, tasks_file: str) -> None:
    """Gemini decides alone — fallback when Claude is unavailable."""
    try:
        with open(tasks_file, 'r') as f:
            open_tasks = f.read().strip()
    except FileNotFoundError:
        open_tasks = "No OPEN tasks found"

    prompt = f"""You are NEXUS, the autonomous body for the AI Agent Pipeline. Claude Code (the brain) is unavailable — you must decide alone.

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

Reply with ONLY a JSON object using the actions[] format:
{{
  "reasoning": "brief explanation",
  "actions": [
    {{"type": "spawn_tmux", "session_name": "alpha-supervisor", "agent": "alpha", "prompt": "..."}},
    {{"type": "spawn_tmux", "session_name": "bravo-work", "agent": "bravo", "prompt": "..."}},
    {{"type": "spawn_tmux", "session_name": "charlie-work", "agent": "charlie", "prompt": "..."}}
  ]
}}

Only include spawn_tmux actions for agents where tmux=no. No markdown fences."""

    try:
        response_text = call_gemini(prompt, caller="decide")
        decision = extract_json(response_text)
        if decision and 'actions' in decision:
            print(json.dumps(decision))
        elif decision and any(k in decision for k in ('spawn_alpha', 'spawn_bravo', 'spawn_charlie')):
            actions = []
            for agent, spawn_key, prompt_key, sess in [
                ('alpha', 'spawn_alpha', 'alpha_prompt', 'alpha-supervisor'),
                ('bravo', 'spawn_bravo', 'bravo_prompt', 'bravo-work'),
                ('charlie', 'spawn_charlie', 'charlie_prompt', 'charlie-work'),
            ]:
                if decision.get(spawn_key):
                    actions.append({
                        'type': 'spawn_tmux',
                        'session_name': sess,
                        'agent': agent,
                        'prompt': decision.get(prompt_key, f'Read .collab/{agent}/IDENTITY.md first.'),
                    })
            if not actions:
                actions.append({'type': 'noop', 'reason': decision.get('reasoning', 'No agents to spawn')})
            print(json.dumps({'actions': actions, 'reasoning': decision.get('reasoning', '')}))
        else:
            print("", end="")
    except Exception as e:
        print(f"Gemini decide error: {e}", file=sys.stderr)
        print("", end="")


def main():
    if len(sys.argv) < 2:
        print("Usage:", file=sys.stderr)
        print("  gemini-compress.py compress <state_file>", file=sys.stderr)
        print("  gemini-compress.py decide <alpha> <bravo> <charlie> <tasks_file>", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1]

    if mode == "compress":
        if len(sys.argv) < 3:
            print("Usage: gemini-compress.py compress <state_file>", file=sys.stderr)
            sys.exit(1)
        compress_state(sys.argv[2])

    elif mode == "decide":
        if len(sys.argv) < 6:
            print("Usage: gemini-compress.py decide <alpha> <bravo> <charlie> <tasks_file>", file=sys.stderr)
            print("", end="")
            sys.exit(0)
        decide_alone(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])

    else:
        print(f"Unknown mode: {mode}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
