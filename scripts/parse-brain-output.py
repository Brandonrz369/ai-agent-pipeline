#!/usr/bin/env python3
"""Parse Claude Code brain output from --output-format json.

Handles:
- Outer JSON wrapper: {"type":"result","result":"..."}
- Markdown code fences: ```json ... ```
- Unicode characters (em-dashes, smart quotes, etc.)
- Nested braces in the decision JSON
- Text before/after the JSON object

Reads from a file (no heredoc/shell quoting issues).
"""

import json
import re
import sys


def extract_decision(text: str) -> dict | None:
    """Extract the spawn decision JSON from text that may contain markdown fences."""
    # Strip markdown code fences
    text = re.sub(r'```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```', '', text)
    text = text.strip()

    # Strategy 1: Find outermost braces (handles nested objects)
    brace_start = text.find('{')
    if brace_start < 0:
        return None

    # Walk through to find the matching closing brace
    depth = 0
    in_string = False
    escape_next = False
    for i in range(brace_start, len(text)):
        c = text[i]
        if escape_next:
            escape_next = False
            continue
        if c == '\\' and in_string:
            escape_next = True
            continue
        if c == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                candidate = text[brace_start:i + 1]
                try:
                    d = json.loads(candidate)
                    if 'spawn_bravo' in d or 'spawn_charlie' in d or 'spawn_alpha' in d:
                        return d
                except json.JSONDecodeError:
                    pass
                break

    # Strategy 2: Try each JSON-like block
    for match in re.finditer(r'\{[^{}]*\}', text):
        try:
            d = json.loads(match.group())
            if 'spawn_bravo' in d or 'spawn_charlie' in d or 'spawn_alpha' in d:
                return d
        except json.JSONDecodeError:
            continue

    return None


def main():
    if len(sys.argv) < 2:
        print("", end="")
        sys.exit(0)

    filepath = sys.argv[1]
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            raw = f.read().strip()
    except (FileNotFoundError, IOError):
        print("", end="")
        sys.exit(0)

    if not raw:
        print("", end="")
        sys.exit(0)

    # Step 1: Try to parse the outer JSON wrapper from --output-format json
    text = raw
    try:
        outer = json.loads(raw)
        # Claude's --output-format json wraps in {"type":"result","result":"..."}
        if isinstance(outer, dict) and 'result' in outer:
            text = str(outer['result'])
        elif isinstance(outer, dict):
            # Maybe the decision IS the outer object
            if 'spawn_bravo' in outer or 'spawn_charlie' in outer or 'spawn_alpha' in outer:
                print(json.dumps(outer))
                return
    except json.JSONDecodeError:
        pass  # Not JSON, treat as plain text

    # Step 2: Extract decision from the text
    decision = extract_decision(text)
    if decision:
        print(json.dumps(decision))
    else:
        # Log what we got for debugging
        preview = text[:300].replace('\n', ' ')
        err = json.dumps({"error": "no_valid_json", "raw": preview})
        sys.stderr.write(f"parse-brain-output: Failed to extract decision. Preview: {preview[:200]}\n")
        print("", end="")


if __name__ == '__main__':
    main()
