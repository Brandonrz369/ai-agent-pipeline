#!/bin/bash
# NEXUS — OpenClaw Pipeline Driver (Inverted Brainstorm Architecture)
#
# NEXUS is the autonomous body — OpenClaw + Gemini 3.1 Pro.
# Claude Code is the brain — called via inverted brainstorm.
#
# Flow:
#   Step 1: Read ALL state files (no truncation)
#   Step 2: Compress state via Gemini into a focused question
#   Step 3: Call claude -p with compressed context (no token limit)
#   Step 4: Claude thinks strategically, returns actions[]
#   Step 5: NEXUS executes every action
#
# Agent Hierarchy:
#   NEXUS   = OpenClaw + Gemini 3.1 Pro (this script) — the body
#   ALPHA   = Claude Code supervisor + worker (persistent tmux)
#   BRAVO   = Claude Code builder 1 (spawned per-task)
#   CHARLIE = Claude Code builder 2 (spawned per-task)
#
# Fallback chain:
#   1. Inverted brainstorm (Claude thinks, NEXUS executes)
#   2. Gemini decides alone (same actions[] format)
#   3. Hardcoded fallback (spawn idle agents with IDENTITY.md prompts)

set -euo pipefail

PIPELINE_DIR="/home/brans/ai-agent-pipeline"

# Load secrets from .env (gitignored)
if [ -f "$PIPELINE_DIR/.env" ]; then
  set -a; source "$PIPELINE_DIR/.env"; set +a
fi
COLLAB_DIR="$PIPELINE_DIR/.collab"
STATE_FILE="$HOME/.openclaw/state/pipeline-driver.json"
LOCK_FILE="/tmp/pipeline-driver.lock"
LOG_FILE="$HOME/.openclaw/logs/pipeline-driver.log"
TMP_DIR="/tmp/pipeline-driver"
MCP_CONFIG="$PIPELINE_DIR/config/mcp-servers.json"
DECISION_SCHEMA="$PIPELINE_DIR/templates/decision-schema.json"
CDP_PORT=18800

# ─── Model Configuration ────────────────────────────────────────────
# BRAINSTORM_MODEL: Used for the strategic brain call (Step 3)
# ALPHA_MODEL: ALPHA is supervisor — benefits from Opus thinking
# WORKER_MODEL: BRAVO/CHARLIE are builders — Sonnet is fine
# To switch everyone to Opus: set all to ""
# To switch everyone to Sonnet: set all to "sonnet"
BRAINSTORM_MODEL=""          # empty = Opus for all
ALPHA_MODEL=""               # empty = Opus for all
WORKER_MODEL=""              # empty = Opus for all

# Gemini API key — loaded from environment, never hardcoded
export GEMINI_API_KEY="${GEMINI_API_KEY:-}"

# Permission prefix — prepended to all agent prompts
PERMISSION_PREFIX="${NEXUS_PERMISSION_PREFIX:-sudo}"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "0")
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "$(date -Iseconds) SKIP: Already running (PID $LOCK_PID)" >> "$LOG_FILE"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$LOG_FILE")" "$TMP_DIR"

log() {
  echo "$(date -Iseconds) NEXUS: $1" | tee -a "$LOG_FILE"
}

log "=== NEXUS Pipeline Driver Run (Inverted Brainstorm) ==="

# ─── Step 1: Read ALL state (no truncation) ──────────────────────────
log "Reading full system state..."

ALPHA_RUNNING=$(tmux has-session -t "alpha-supervisor" 2>/dev/null && echo "yes" || echo "no")
BRAVO_RUNNING=$(tmux has-session -t "bravo-work" 2>/dev/null && echo "yes" || echo "no")
CHARLIE_RUNNING=$(tmux has-session -t "charlie-work" 2>/dev/null && echo "yes" || echo "no")

log "State: ALPHA tmux=$ALPHA_RUNNING, BRAVO tmux=$BRAVO_RUNNING, CHARLIE tmux=$CHARLIE_RUNNING"

# If all three are running, nothing to do
if [ "$ALPHA_RUNNING" = "yes" ] && [ "$BRAVO_RUNNING" = "yes" ] && [ "$CHARLIE_RUNNING" = "yes" ]; then
  log "All agents running. Nothing to do."
  log "=== NEXUS run complete ==="
  exit 0
fi

# Build full state file — no truncation, let Gemini handle compression
{
  echo "=== SYSTEM STATE ($(date -Iseconds)) ==="
  echo ""
  echo "--- TMUX SESSIONS ---"
  echo "ALPHA (alpha-supervisor): $ALPHA_RUNNING"
  echo "BRAVO (bravo-work): $BRAVO_RUNNING"
  echo "CHARLIE (charlie-work): $CHARLIE_RUNNING"
  echo ""

  echo "--- TASKBOARD.md ---"
  cat "$COLLAB_DIR/shared/TASKBOARD.md" 2>/dev/null || echo "TASKBOARD not found"
  echo ""

  echo "--- ALPHA STATUS ---"
  cat "$COLLAB_DIR/alpha/STATUS.md" 2>/dev/null || echo "No status file"
  echo ""

  echo "--- BRAVO STATUS ---"
  cat "$COLLAB_DIR/bravo/STATUS.md" 2>/dev/null || echo "No status file"
  echo ""

  echo "--- CHARLIE STATUS ---"
  cat "$COLLAB_DIR/charlie/STATUS.md" 2>/dev/null || echo "No status file"
  echo ""

  echo "--- MESSAGES.md (last 50 lines) ---"
  tail -50 "$COLLAB_DIR/shared/MESSAGES.md" 2>/dev/null || echo "No messages"
  echo ""

  echo "--- ARCHITECTURE-SUMMARY.md ---"
  cat "$COLLAB_DIR/shared/ARCHITECTURE-SUMMARY.md" 2>/dev/null || echo "No summary"
  echo ""

  echo "--- GIT STATUS ---"
  cd "$PIPELINE_DIR" && git status --short 2>/dev/null || echo "Not a git repo or git unavailable"
  echo ""

  echo "--- GIT LOG (last 5) ---"
  cd "$PIPELINE_DIR" && git log --oneline -5 2>/dev/null || echo "No git log"
  echo ""

  echo "--- BROWSER STATUS (CDP port $CDP_PORT) ---"
  curl -s --connect-timeout 2 "http://localhost:$CDP_PORT/json/version" 2>/dev/null || echo "Browser not available"
  echo ""

  echo "--- PIPELINE DRIVER STATE ---"
  cat "$STATE_FILE" 2>/dev/null || echo "No prior state"
  echo ""
} > "$TMP_DIR/full-state.txt"

STATE_SIZE=$(wc -c < "$TMP_DIR/full-state.txt")
log "Full state collected: ${STATE_SIZE} bytes"

# ─── Step 2: Compress state via Gemini ───────────────────────────────
log "Compressing state via Gemini..."

BRAINSTORM_PROMPT=""
BRAINSTORM_PROMPT=$(python3 "$PIPELINE_DIR/scripts/gemini-compress.py" compress "$TMP_DIR/full-state.txt" 2>/dev/null || echo "")

if [ -z "$BRAINSTORM_PROMPT" ]; then
  log "WARN: Gemini compression failed, building manual prompt"
  # Manual fallback prompt
  BRAINSTORM_PROMPT=$(cat << MANUAL_END
You are the strategic brain for the AI Agent Pipeline. Decide what actions NEXUS should execute.

Current state:
- ALPHA (supervisor) tmux: $ALPHA_RUNNING
- BRAVO (builder 1) tmux: $BRAVO_RUNNING
- CHARLIE (builder 2) tmux: $CHARLIE_RUNNING

$(cat "$TMP_DIR/full-state.txt" | head -100)

Return a JSON object with an 'actions' array and 'reasoning' string. Each action has a 'type' field.
See templates/decision-schema.json for the schema. Action types: spawn_tmux, shell_command, browser_navigate, browser_screenshot, message, write_file, noop.

Rules:
1. If tmux=no, spawn the agent. If tmux=yes, leave it alone.
2. ALPHA should ALWAYS be running.
3. Prompts must start with: "Read .collab/{agent}/IDENTITY.md first."
4. Be VERY specific: exact file paths, step-by-step instructions.
5. Tell BRAVO and CHARLIE to EXIT when done. ALPHA stands by.
MANUAL_END
)
fi

log "Brainstorm prompt ready ($(echo "$BRAINSTORM_PROMPT" | wc -c) bytes)"

# ─── Step 3: Inverted brainstorm — Claude thinks ────────────────────
DECISION=""
TOKENS_EXHAUSTED="false"

log "Brainstorming with Claude..."

# Write brainstorm prompt to file to avoid shell escaping issues
cat > "$TMP_DIR/brainstorm-prompt.txt" << 'SCHEMA_HEADER'
You are the strategic brain for the AI Agent Pipeline. NEXUS (the body) has compressed the current system state and is asking you to think strategically about what to do next.

Read the situation below, think deeply, then return a JSON decision object.

DECISION FORMAT (actions[] — see templates/decision-schema.json):
{
  "reasoning": "brief strategic explanation",
  "actions": [
    {"type": "spawn_tmux", "session_name": "alpha-supervisor", "agent": "alpha", "prompt": "Read .collab/alpha/IDENTITY.md first. Then..."},
    {"type": "spawn_tmux", "session_name": "bravo-work", "agent": "bravo", "prompt": "Read .collab/bravo/IDENTITY.md first. Then..."},
    {"type": "shell_command", "command": "...", "timeout": 30},
    {"type": "message", "channel": "discord", "text": "..."},
    {"type": "noop", "reason": "..."}
  ]
}

ACTION TYPES:
- spawn_tmux: Spawn a Claude Code session in tmux. Required: session_name, prompt. Optional: agent.
- shell_command: Run a shell command. Required: command. Optional: timeout, cwd.
- browser_navigate: Navigate browser. Required: url.
- browser_screenshot: Screenshot browser. Required: output_path.
- browser_click: Click element. Required: selector.
- message: Send notification. Required: channel (discord|telegram|messages_md), text.
- write_file: Write content to file. Required: path, content.
- noop: No action needed. Required: reason.

RULES:
1. If an agent's tmux=no, spawn it. If tmux=yes, leave it alone.
2. ALPHA should ALWAYS be running — if tmux=no, always include a spawn_tmux for alpha-supervisor.
3. All spawn_tmux prompts MUST start with: "Read .collab/{agent}/IDENTITY.md first."
4. All spawn_tmux prompts MUST include: "Use list_keys + get_summary to load prior context from brain-context cache before starting. Before exiting, use store_context to save your findings."
5. Be SPECIFIC in prompts: exact file paths, step-by-step instructions, expected outcomes.
6. BRAVO and CHARLIE should EXIT when done. ALPHA stands by after supervision.
7. Working directory for all agents: /home/brans/ai-agent-pipeline

Think freely, then output ONLY the JSON decision object at the end. No markdown fences around the JSON.

--- SITUATION FROM NEXUS ---

SCHEMA_HEADER

echo "$BRAINSTORM_PROMPT" >> "$TMP_DIR/brainstorm-prompt.txt"

# Call Claude with 10 minute timeout, no --output-format json restriction
BRAINSTORM_MODEL_FLAG=""
if [ -n "$BRAINSTORM_MODEL" ]; then
  BRAINSTORM_MODEL_FLAG="--model $BRAINSTORM_MODEL"
fi
timeout 600 env -u CLAUDECODE claude -p "$(cat "$TMP_DIR/brainstorm-prompt.txt")" $BRAINSTORM_MODEL_FLAG > "$TMP_DIR/brain-raw.txt" 2>"$TMP_DIR/brain-stderr.txt" || true

# Check for token exhaustion
if grep -qi "out of extra usage\|rate limit\|quota exceeded\|tokens exhausted" "$TMP_DIR/brain-stderr.txt" "$TMP_DIR/brain-raw.txt" 2>/dev/null; then
  TOKENS_EXHAUSTED="true"
  log "Claude Code tokens EXHAUSTED. Will use Gemini fallback."
fi

# Parse Claude's response — extract actions[] JSON from free-form text
if [ -s "$TMP_DIR/brain-raw.txt" ] && [ "$TOKENS_EXHAUSTED" = "false" ]; then
  DECISION=$(python3 "$PIPELINE_DIR/scripts/parse-brain-output.py" "$TMP_DIR/brain-raw.txt" 2>/dev/null || echo "")
fi

if [ -n "$DECISION" ] && [ "$DECISION" != "" ]; then
  echo "$DECISION" > "$TMP_DIR/decision.json"
  log "Brainstorm decision: $(python3 -c "import json; d=json.load(open('$TMP_DIR/decision.json')); print(f\"{len(d.get('actions',[]))} actions — {d.get('reasoning','')[:200]}\")" 2>/dev/null || echo "unknown")"
else
  # ─── Fallback 2: Gemini decides alone ────────────────────────────
  log "Brainstorm unavailable. NEXUS falling back to Gemini 3.1 Pro..."

  # Extract open tasks for Gemini
  python3 -c "
lines = open('$COLLAB_DIR/shared/TASKBOARD.md').read().split('\n')
open_lines = [l.strip() for l in lines if 'OPEN' in l or 'WORKING' in l]
with open('$TMP_DIR/open-tasks.txt', 'w') as f:
    f.write('\n'.join(open_lines) if open_lines else 'No OPEN tasks found')
" 2>/dev/null || echo "No OPEN tasks found" > "$TMP_DIR/open-tasks.txt"

  DECISION=$(python3 "$PIPELINE_DIR/scripts/gemini-compress.py" \
    decide "$ALPHA_RUNNING" "$BRAVO_RUNNING" "$CHARLIE_RUNNING" "$TMP_DIR/open-tasks.txt" 2>/dev/null || echo "")

  if [ -n "$DECISION" ] && [ "$DECISION" != "" ]; then
    echo "$DECISION" > "$TMP_DIR/decision.json"
    log "Gemini fallback decision: $(echo "$DECISION" | head -c 400)"
  else
    # ─── Fallback 3: Hardcoded ─────────────────────────────────────
    log "Both brainstorm and Gemini failed. NEXUS using hardcoded fallback."
    DECISION=$(python3 -c "
import json
actions = []
if '$ALPHA_RUNNING' == 'no':
    actions.append({
        'type': 'spawn_tmux',
        'session_name': 'alpha-supervisor',
        'agent': 'alpha',
        'prompt': 'Read /home/brans/ai-agent-pipeline/.collab/alpha/IDENTITY.md first. Then check TASKBOARD.md. Supervise BRAVO and CHARLIE, review completed work, and work on any unassigned P1+ tasks yourself. Stand by after supervision.'
    })
if '$BRAVO_RUNNING' == 'no':
    actions.append({
        'type': 'spawn_tmux',
        'session_name': 'bravo-work',
        'agent': 'bravo',
        'prompt': 'Read /home/brans/ai-agent-pipeline/.collab/bravo/IDENTITY.md first. Then check TASKBOARD.md. Work on the first OPEN task assigned to you. Update .collab/bravo/STATUS.md when done. EXIT when finished.'
    })
if '$CHARLIE_RUNNING' == 'no':
    actions.append({
        'type': 'spawn_tmux',
        'session_name': 'charlie-work',
        'agent': 'charlie',
        'prompt': 'Read /home/brans/ai-agent-pipeline/.collab/charlie/IDENTITY.md first. Then check TASKBOARD.md. Work on the first OPEN task assigned to you. Update .collab/charlie/STATUS.md when done. EXIT when finished.'
    })
if not actions:
    actions.append({'type': 'noop', 'reason': 'All agents running'})
print(json.dumps({
    'actions': actions,
    'reasoning': 'NEXUS hardcoded fallback — spawning idle agents with identity-file prompts'
}))
")
    echo "$DECISION" > "$TMP_DIR/decision.json"
    log "Hardcoded fallback: $(echo "$DECISION" | head -c 300)"
  fi
fi

# ─── Step 4: Discord notification if tokens exhausted ────────────────
if [ "$TOKENS_EXHAUSTED" = "true" ]; then
  log "Sending Discord notification about token exhaustion..."
  python3 "$PIPELINE_DIR/scripts/discord-notify.py" \
    "Claude Code tokens exhausted" \
    "NEXUS detected that Claude Code tokens are exhausted. Agents are being driven by Gemini 3.1 Pro (via Antigravity) with limited decision quality. Tokens should reset at midnight." \
    2>/dev/null || log "WARN: Discord notification failed"
fi

# ─── Step 5: Execute actions ─────────────────────────────────────────
# Write decision to file so we don't lose it across subshells
echo "$DECISION" > "$TMP_DIR/decision.json"
ACTION_COUNT=$(python3 -c "import json; print(len(json.load(open('$TMP_DIR/decision.json')).get('actions',[])))" 2>/dev/null || echo "0")
log "Executing $ACTION_COUNT actions..."

# MCP config flag for Gemini tools via Antigravity
MCP_FLAG=""
if [ -f "$MCP_CONFIG" ]; then
  MCP_FLAG="--mcp-config $MCP_CONFIG"
fi

# Post decision to MESSAGES.md
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%MZ")
REASONING=$(python3 -c "import json; print(json.load(open('$TMP_DIR/decision.json')).get('reasoning','Auto'))" 2>/dev/null || echo "Auto")

{
  echo ""
  echo "[$TIMESTAMP] NEXUS→ALL: **Automated assignment (inverted brainstorm)**"
  echo "- $REASONING"
  echo "- ALPHA tmux: $ALPHA_RUNNING | BRAVO tmux: $BRAVO_RUNNING | CHARLIE tmux: $CHARLIE_RUNNING"
} >> "$COLLAB_DIR/shared/MESSAGES.md"

# Process each action — write to file first, then iterate (avoids pipe subshell)
python3 -c "
import json
decision = json.load(open('$TMP_DIR/decision.json'))
with open('$TMP_DIR/actions.jsonl', 'w') as f:
    for action in decision.get('actions', []):
        f.write(json.dumps(action) + '\n')
" 2>/dev/null

while IFS= read -r ACTION_JSON; do
  ACTION_TYPE=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('type','unknown'))" 2>/dev/null || echo "unknown")

  case "$ACTION_TYPE" in

    spawn_tmux)
      SESSION_NAME=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('session_name',''))" 2>/dev/null)
      AGENT=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('agent',''))" 2>/dev/null)
      PROMPT=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('prompt',''))" 2>/dev/null)

      if [ -z "$SESSION_NAME" ] || [ -z "$PROMPT" ]; then
        log "WARN: spawn_tmux missing session_name or prompt, skipping"
        continue
      fi

      # Prepend permission prefix + write prompt to file
      echo "${PERMISSION_PREFIX} ${PROMPT}" > "$TMP_DIR/${AGENT:-agent}-prompt.txt"

      # Pick model: ALPHA gets ALPHA_MODEL, BRAVO/CHARLIE get WORKER_MODEL
      AGENT_MODEL_FLAG=""
      if [ "$AGENT" = "alpha" ]; then
        [ -n "$ALPHA_MODEL" ] && AGENT_MODEL_FLAG="--model $ALPHA_MODEL"
        SPAWN_MODEL="${ALPHA_MODEL:-opus}"
      else
        [ -n "$WORKER_MODEL" ] && AGENT_MODEL_FLAG="--model $WORKER_MODEL"
        SPAWN_MODEL="${WORKER_MODEL:-opus}"
      fi

      # Session persistence: track session IDs per agent so we can --resume
      SESSION_ID_FILE="$TMP_DIR/${AGENT:-agent}-session-id.txt"
      RESUME_FLAG=""
      if [ -f "$SESSION_ID_FILE" ]; then
        PREV_SESSION_ID=$(cat "$SESSION_ID_FILE" 2>/dev/null)
        if [ -n "$PREV_SESSION_ID" ]; then
          RESUME_FLAG="--resume $PREV_SESSION_ID"
          log "Resuming previous session $PREV_SESSION_ID for $AGENT"
        fi
      fi

      # Check if tmux session already exists and agent is still running
      if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        log "SKIP: $SESSION_NAME already running"
        continue
      fi

      log "Spawning $SESSION_NAME ($AGENT) [model=$SPAWN_MODEL]..."
      tmux new-session -d -s "$SESSION_NAME" \
        "cd $PIPELINE_DIR && env -u CLAUDECODE claude -p \"\$(cat $TMP_DIR/${AGENT:-agent}-prompt.txt)\" $AGENT_MODEL_FLAG $MCP_FLAG $RESUME_FLAG 2>&1 | tee -a $LOG_FILE; echo '${SESSION_NAME} SESSION ENDED at '\$(date) >> $LOG_FILE; sleep 10" 2>/dev/null \
        && log "STARTED: $SESSION_NAME" \
        || log "WARN: $SESSION_NAME spawn failed"

      # Capture the session ID for future --resume
      # Claude prints session ID in output; also check the project sessions dir
      LATEST_SESSION=$(ls -t ~/.claude/projects/-home-brans-ai-agent-pipeline/*.jsonl 2>/dev/null | head -1 | xargs -I{} basename {} .jsonl)
      if [ -n "$LATEST_SESSION" ]; then
        echo "$LATEST_SESSION" > "$SESSION_ID_FILE"
        log "Saved session ID: $LATEST_SESSION"
      fi
      ;;

    shell_command)
      COMMAND=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('command',''))" 2>/dev/null)
      CMD_TIMEOUT=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('timeout', 30))" 2>/dev/null)
      CMD_CWD=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('cwd','$PIPELINE_DIR'))" 2>/dev/null)

      if [ -n "$COMMAND" ]; then
        log "Running shell command: $(echo "$COMMAND" | head -c 100)..."
        cd "$CMD_CWD" && timeout "${CMD_TIMEOUT}s" bash -c "$COMMAND" >> "$LOG_FILE" 2>&1 \
          && log "Shell command succeeded" \
          || log "WARN: Shell command failed or timed out"
      fi
      ;;

    browser_navigate)
      URL=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('url',''))" 2>/dev/null)
      if [ -n "$URL" ]; then
        log "Browser navigate: $URL"
        # CDP navigate via DevTools protocol
        curl -s "http://localhost:$CDP_PORT/json/new?$URL" > /dev/null 2>&1 \
          || log "WARN: Browser navigate failed (CDP port $CDP_PORT)"
      fi
      ;;

    browser_screenshot)
      OUTPUT_PATH=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('output_path',''))" 2>/dev/null)
      if [ -n "$OUTPUT_PATH" ]; then
        log "Browser screenshot: $OUTPUT_PATH"
        openclaw browser screenshot "$OUTPUT_PATH" 2>/dev/null \
          || log "WARN: Browser screenshot failed"
      fi
      ;;

    browser_click)
      SELECTOR=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('selector',''))" 2>/dev/null)
      if [ -n "$SELECTOR" ]; then
        log "Browser click: $SELECTOR"
        # Would use CDP Runtime.evaluate to click — placeholder
        log "WARN: browser_click not yet implemented via CDP"
      fi
      ;;

    message)
      CHANNEL=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('channel',''))" 2>/dev/null)
      MSG_TEXT=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('text',''))" 2>/dev/null)

      if [ "$CHANNEL" = "discord" ] || [ "$CHANNEL" = "telegram" ]; then
        log "Sending $CHANNEL message: $(echo "$MSG_TEXT" | head -c 100)..."
        python3 "$PIPELINE_DIR/scripts/discord-notify.py" "NEXUS" "$MSG_TEXT" 2>/dev/null \
          || log "WARN: $CHANNEL message failed"
      elif [ "$CHANNEL" = "messages_md" ]; then
        echo "[$TIMESTAMP] NEXUS→ALL: $MSG_TEXT" >> "$COLLAB_DIR/shared/MESSAGES.md"
        log "Posted to MESSAGES.md"
      fi
      ;;

    write_file)
      FILE_PATH=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('path',''))" 2>/dev/null)
      FILE_CONTENT=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('content',''))" 2>/dev/null)

      if [ -n "$FILE_PATH" ] && [ -n "$FILE_CONTENT" ]; then
        log "Writing file: $FILE_PATH"
        mkdir -p "$(dirname "$FILE_PATH")"
        echo "$FILE_CONTENT" > "$FILE_PATH" \
          && log "File written: $FILE_PATH" \
          || log "WARN: Failed to write $FILE_PATH"
      fi
      ;;

    noop)
      REASON=$(echo "$ACTION_JSON" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('reason','No reason given'))" 2>/dev/null)
      log "NOOP: $REASON"
      ;;

    *)
      log "WARN: Unknown action type: $ACTION_TYPE"
      ;;
  esac
done < "$TMP_DIR/actions.jsonl"

# ─── Step 6: Save state ──────────────────────────────────────────────
python3 -c "
import json, os
from datetime import datetime

action_count = 0
try:
    with open('/tmp/pipeline-driver/decision.json') as f:
        action_count = len(json.load(f).get('actions', []))
except:
    pass

state = {
    'last_run': datetime.now().isoformat(),
    'architecture': 'inverted_brainstorm',
    'alpha_tmux': '$ALPHA_RUNNING',
    'bravo_tmux': '$BRAVO_RUNNING',
    'charlie_tmux': '$CHARLIE_RUNNING',
    'actions_executed': action_count,
    'tokens_exhausted': '$TOKENS_EXHAUSTED' == 'true',
    'brainstorm_model': '${BRAINSTORM_MODEL:-opus}',
    'alpha_model': '${ALPHA_MODEL:-opus}',
    'worker_model': '${WORKER_MODEL:-sonnet}',
}

state_file = os.path.expanduser('~/.openclaw/state/pipeline-driver.json')
os.makedirs(os.path.dirname(state_file), exist_ok=True)
with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)
" 2>/dev/null || log "WARN: Failed to save state"

log "=== NEXUS run complete ==="
