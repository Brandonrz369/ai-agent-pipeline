#!/usr/bin/env python3
"""Parse Claude Code brain output — supports both actions[] and legacy formats.

Handles:
- New actions[] format from inverted brainstorm
- Legacy spawn_alpha/spawn_bravo/spawn_charlie format (backward compat)
- Outer JSON wrapper: {"type":"result","result":"..."}
- Markdown code fences: ```json ... ```
- Free-form Claude text with JSON embedded anywhere
- Nested braces in the decision JSON

Reads from a file (no heredoc/shell quoting issues).
"""

import json
import re
import sys


def convert_legacy_to_actions(legacy: dict) -> dict:
    """Convert legacy spawn format to actions[] format."""
    actions = []

    agent_map = {
        'alpha': ('spawn_alpha', 'alpha_prompt', 'alpha-supervisor'),
        'bravo': ('spawn_bravo', 'bravo_prompt', 'bravo-work'),
        'charlie': ('spawn_charlie', 'charlie_prompt', 'charlie-work'),
    }

    for agent, (spawn_key, prompt_key, session_name) in agent_map.items():
        if legacy.get(spawn_key):
            actions.append({
                'type': 'spawn_tmux',
                'session_name': session_name,
                'agent': agent,
                'prompt': legacy.get(prompt_key, f'Read .collab/{agent}/IDENTITY.md first. Then check TASKBOARD.md.'),
            })

    if not actions:
        actions.append({
            'type': 'noop',
            'reason': legacy.get('reasoning', 'No agents need spawning'),
        })

    return {
        'actions': actions,
        'reasoning': legacy.get('reasoning', 'Converted from legacy format'),
    }


def validate_action(action: dict) -> bool:
    """Validate that an action has required fields for its type."""
    action_type = action.get('type')
    if not action_type:
        return False

    required_fields = {
        'spawn_tmux': ['session_name', 'prompt'],
        'browser_navigate': ['url'],
        'browser_screenshot': ['output_path'],
        'browser_click': ['selector'],
        'shell_command': ['command'],
        'message': ['channel', 'text'],
        'write_file': ['path', 'content'],
        'noop': ['reason'],
    }

    required = required_fields.get(action_type, [])
    return all(action.get(f) for f in required)


def extract_decision(text: str) -> dict | None:
    """Extract the decision JSON from text that may contain markdown fences."""
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
                    if is_valid_decision(d):
                        return d
                except json.JSONDecodeError:
                    pass
                break

    # Strategy 2: Try each JSON-like block
    for match in re.finditer(r'\{[^{}]*\}', text):
        try:
            d = json.loads(match.group())
            if is_valid_decision(d):
                return d
        except json.JSONDecodeError:
            continue

    return None


def is_valid_decision(d: dict) -> bool:
    """Check if a dict looks like a valid decision (new or legacy format)."""
    # New actions format
    if 'actions' in d and isinstance(d['actions'], list):
        return True
    # Legacy format
    if any(k in d for k in ('spawn_alpha', 'spawn_bravo', 'spawn_charlie')):
        return True
    return False


def normalize_decision(d: dict) -> dict:
    """Normalize a decision to actions[] format, validating each action."""
    # Already in actions format
    if 'actions' in d and isinstance(d['actions'], list):
        # Validate each action
        valid_actions = [a for a in d['actions'] if validate_action(a)]
        if not valid_actions:
            valid_actions = [{'type': 'noop', 'reason': 'No valid actions after validation'}]
        return {
            'actions': valid_actions,
            'reasoning': d.get('reasoning', ''),
        }

    # Legacy format — convert
    if any(k in d for k in ('spawn_alpha', 'spawn_bravo', 'spawn_charlie')):
        return convert_legacy_to_actions(d)

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
            if is_valid_decision(outer):
                result = normalize_decision(outer)
                if result:
                    print(json.dumps(result))
                    return
    except json.JSONDecodeError:
        pass  # Not JSON, treat as plain text

    # Step 2: Extract decision from the text
    decision = extract_decision(text)
    if decision:
        result = normalize_decision(decision)
        if result:
            print(json.dumps(result))
            return

    # Failed to parse
    preview = text[:300].replace('\n', ' ')
    sys.stderr.write(f"parse-brain-output: Failed to extract decision. Preview: {preview[:200]}\n")
    print("", end="")


if __name__ == '__main__':
    main()
