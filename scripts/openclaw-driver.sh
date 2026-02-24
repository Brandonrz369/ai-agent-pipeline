#!/bin/bash
# NEXUS — OpenClaw Pipeline Driver
#
# The autonomous orchestrator that drives the AI Agent Pipeline.
# NEXUS reads state, routes decisions, and spawns agent sessions.
#
# Agent Hierarchy:
#   NEXUS   = OpenClaw + Gemini 3.1 Pro (this script) — traffic cop
#   ORACLE  = Claude Code brain session — strategic decisions
#   ALPHA   = Claude Code supervisor — reviews, unblocks, also works
#   BRAVO   = Claude Code builder 1 — execution path
#   CHARLIE = Claude Code builder 2 — verification path
#
# Fallback chain:
#   1. ORACLE (Claude Code brain)     → best decisions, costs tokens
#   2. Gemini 3.1 Pro (Antigravity)   → free, good decisions
#   3. Hardcoded fallback              → generic prompts, always works
#
# When Claude tokens are exhausted → notify user on Discord via Gemini

set -euo pipefail

PIPELINE_DIR="/home/brans/ai-agent-pipeline"
COLLAB_DIR="$PIPELINE_DIR/.collab"
STATE_FILE="$HOME/.openclaw/state/pipeline-driver.json"
LOCK_FILE="/tmp/pipeline-driver.lock"
LOG_FILE="$HOME/.openclaw/logs/pipeline-driver.log"
TMP_DIR="/tmp/pipeline-driver"
MCP_CONFIG="$PIPELINE_DIR/config/mcp-servers.json"

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

log "=== NEXUS Pipeline Driver Run ==="

# ─── Step 1: Read state ──────────────────────────────────────────────
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

# ─── Step 2: Build context ───────────────────────────────────────────
# Write context to temp files to avoid heredoc/quoting issues
python3 -c "
import json

def read_file(path, fallback='UNKNOWN', max_chars=800):
    try:
        with open(path) as f:
            return f.read()[:max_chars]
    except:
        return fallback

collab = '/home/brans/ai-agent-pipeline/.collab'
ctx = {
    'taskboard': read_file(f'{collab}/shared/TASKBOARD.md', 'No taskboard', 1500),
    'alpha_status': read_file(f'{collab}/alpha/STATUS.md', 'UNKNOWN', 400),
    'bravo_status': read_file(f'{collab}/bravo/STATUS.md', 'UNKNOWN', 400),
    'charlie_status': read_file(f'{collab}/charlie/STATUS.md', 'UNKNOWN', 400),
}

# Extract just OPEN tasks for a cleaner prompt
lines = ctx['taskboard'].split('\n')
open_lines = []
for line in lines:
    if 'OPEN' in line or 'WORKING' in line:
        open_lines.append(line.strip())

with open('/tmp/pipeline-driver/context.json', 'w') as f:
    json.dump(ctx, f)
with open('/tmp/pipeline-driver/open-tasks.txt', 'w') as f:
    f.write('\n'.join(open_lines) if open_lines else 'No OPEN tasks found')
with open('/tmp/pipeline-driver/alpha-status.txt', 'w') as f:
    f.write(ctx['alpha_status'][:200])
with open('/tmp/pipeline-driver/bravo-status.txt', 'w') as f:
    f.write(ctx['bravo_status'][:200])
with open('/tmp/pipeline-driver/charlie-status.txt', 'w') as f:
    f.write(ctx['charlie_status'][:200])
"

OPEN_TASKS=$(cat "$TMP_DIR/open-tasks.txt")
ALPHA_STATUS_TEXT=$(cat "$TMP_DIR/alpha-status.txt")
BRAVO_STATUS_TEXT=$(cat "$TMP_DIR/bravo-status.txt")
CHARLIE_STATUS_TEXT=$(cat "$TMP_DIR/charlie-status.txt")

# Write the ORACLE decision prompt to a file (avoids shell escaping nightmares)
cat > "$TMP_DIR/brain-prompt.txt" << 'PROMPT_END'
You are ORACLE, the strategic brain for the AI Agent Pipeline. Read .collab/oracle/IDENTITY.md for your full instructions. Your job is to decide which agents to spawn and what tasks to give them.

AGENT STATUS:
PROMPT_END

# Append dynamic state (using printf to avoid heredoc issues)
printf -- "- ALPHA (supervisor) tmux session running: %s | Status: %s\n" "$ALPHA_RUNNING" "$ALPHA_STATUS_TEXT" >> "$TMP_DIR/brain-prompt.txt"
printf -- "- BRAVO (builder 1) tmux session running: %s | Status: %s\n" "$BRAVO_RUNNING" "$BRAVO_STATUS_TEXT" >> "$TMP_DIR/brain-prompt.txt"
printf -- "- CHARLIE (builder 2) tmux session running: %s | Status: %s\n" "$CHARLIE_RUNNING" "$CHARLIE_STATUS_TEXT" >> "$TMP_DIR/brain-prompt.txt"

cat >> "$TMP_DIR/brain-prompt.txt" << 'PROMPT_END'

OPEN/WORKING TASKS FROM TASKBOARD:
PROMPT_END

echo "$OPEN_TASKS" >> "$TMP_DIR/brain-prompt.txt"

cat >> "$TMP_DIR/brain-prompt.txt" << 'PROMPT_END'

RULES:
1. If tmux=no, the agent needs to be respawned with a specific task
2. If tmux=yes, leave the agent alone (do NOT spawn)
3. ALPHA should ALWAYS be running — if tmux=no, always spawn ALPHA
4. ALPHA's prompt must start with: "Read .collab/alpha/IDENTITY.md first."
5. BRAVO's prompt must start with: "Read .collab/bravo/IDENTITY.md first."
6. CHARLIE's prompt must start with: "Read .collab/charlie/IDENTITY.md first."
7. Pick the first OPEN task assigned to that agent from the TASKBOARD
8. Be VERY specific in prompts: tell the agent exactly which files to read/create, give step-by-step instructions
9. Tell BRAVO and CHARLIE to EXIT when done. Tell ALPHA to stand by after supervision.

Reply with ONLY a JSON object. Do NOT wrap in markdown code fences. No backticks. No explanation.
{"spawn_alpha": true/false, "alpha_prompt": "exact prompt text", "spawn_bravo": true/false, "bravo_prompt": "exact prompt text", "spawn_charlie": true/false, "charlie_prompt": "exact prompt text", "reasoning": "brief"}
PROMPT_END

DECISION_PROMPT=$(cat "$TMP_DIR/brain-prompt.txt")

# ─── Step 3: Try ORACLE (Claude Code brain) first ────────────────────
DECISION=""
TOKENS_EXHAUSTED="false"

log "Consulting ORACLE (Claude Code brain)..."
timeout 180 env -u CLAUDECODE claude -p "$DECISION_PROMPT" --output-format json > "$TMP_DIR/brain-raw.json" 2>"$TMP_DIR/brain-stderr.txt" || true

# Check for token exhaustion
if grep -qi "out of extra usage\|rate limit\|quota exceeded\|tokens exhausted" "$TMP_DIR/brain-stderr.txt" "$TMP_DIR/brain-raw.json" 2>/dev/null; then
  TOKENS_EXHAUSTED="true"
  log "Claude Code tokens EXHAUSTED. Will use Gemini fallback."
fi

# Parse ORACLE output (using temp file — no heredoc quoting issues)
if [ -s "$TMP_DIR/brain-raw.json" ] && [ "$TOKENS_EXHAUSTED" = "false" ]; then
  DECISION=$(python3 "$PIPELINE_DIR/scripts/parse-brain-output.py" "$TMP_DIR/brain-raw.json" 2>/dev/null || echo "")
fi

if [ -n "$DECISION" ] && [ "$DECISION" != "" ]; then
  log "ORACLE decision: $(echo "$DECISION" | head -c 400)"
else
  # ─── Fallback: Use Gemini 3.1 Pro via Antigravity (FREE) ───────────
  log "ORACLE unavailable. NEXUS falling back to Gemini 3.1 Pro via Antigravity..."

  # Write Gemini prompt to file
  DECISION=$(python3 "$PIPELINE_DIR/scripts/gemini-fallback.py" \
    "$ALPHA_RUNNING" "$BRAVO_RUNNING" "$CHARLIE_RUNNING" "$TMP_DIR/open-tasks.txt" 2>/dev/null || echo "")

  if [ -n "$DECISION" ] && [ "$DECISION" != "" ]; then
    log "NEXUS Gemini fallback decision: $(echo "$DECISION" | head -c 400)"
  else
    log "Both ORACLE and Gemini failed. NEXUS using hardcoded fallback."
    DECISION=$(python3 -c "
import json
d = {
    'spawn_alpha': $([ "$ALPHA_RUNNING" = "no" ] && echo "True" || echo "False"),
    'alpha_prompt': 'Read /home/brans/ai-agent-pipeline/.collab/alpha/IDENTITY.md first. Then check TASKBOARD.md. Supervise BRAVO and CHARLIE, review completed work, and work on any unassigned P1+ tasks yourself. Stand by after supervision.',
    'spawn_bravo': $([ "$BRAVO_RUNNING" = "no" ] && echo "True" || echo "False"),
    'bravo_prompt': 'Read /home/brans/ai-agent-pipeline/.collab/bravo/IDENTITY.md first. Then check TASKBOARD.md. Work on the first OPEN task assigned to you. Update .collab/bravo/STATUS.md when done. EXIT when finished.',
    'spawn_charlie': $([ "$CHARLIE_RUNNING" = "no" ] && echo "True" || echo "False"),
    'charlie_prompt': 'Read /home/brans/ai-agent-pipeline/.collab/charlie/IDENTITY.md first. Then check TASKBOARD.md. Work on the first OPEN task assigned to you. Update .collab/charlie/STATUS.md when done. EXIT when finished.',
    'reasoning': 'NEXUS hardcoded fallback — spawning idle agents with identity-file prompts'
}
print(json.dumps(d))
")
    log "NEXUS hardcoded fallback: $(echo "$DECISION" | head -c 300)"
  fi
fi

# ─── Step 4: Discord notification if tokens exhausted ────────────────
if [ "$TOKENS_EXHAUSTED" = "true" ]; then
  log "Sending Discord notification about token exhaustion..."
  python3 "$PIPELINE_DIR/scripts/discord-notify.py" \
    "Claude Code tokens exhausted" \
    "NEXUS detected that Claude Code tokens are exhausted. Agents are being driven by Gemini 3.1 Pro (via Antigravity) with limited decision quality. Tokens should reset at midnight. Want me to: run deep research, cache files, or do other Gemini-powered work while we wait?" \
    2>/dev/null || log "WARN: Discord notification failed"
fi

# ─── Step 5: Post to MESSAGES.md ─────────────────────────────────────
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%MZ")
REASONING=$(echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('reasoning','Auto'))" 2>/dev/null || echo "Auto")

{
  echo ""
  echo "[$TIMESTAMP] NEXUS→ALL: **Automated assignment**"
  echo "- $REASONING"
  echo "- ALPHA tmux: $ALPHA_RUNNING | BRAVO tmux: $BRAVO_RUNNING | CHARLIE tmux: $CHARLIE_RUNNING"
} >> "$COLLAB_DIR/shared/MESSAGES.md"

# ─── Step 6: SPAWN agent sessions ────────────────────────────────────
SPAWN_ALPHA=$(echo "$DECISION" | python3 -c "import sys,json; v=json.loads(sys.stdin.read()).get('spawn_alpha',False); print('true' if v else 'false')" 2>/dev/null || echo "false")
SPAWN_BRAVO=$(echo "$DECISION" | python3 -c "import sys,json; v=json.loads(sys.stdin.read()).get('spawn_bravo',False); print('true' if v else 'false')" 2>/dev/null || echo "false")
SPAWN_CHARLIE=$(echo "$DECISION" | python3 -c "import sys,json; v=json.loads(sys.stdin.read()).get('spawn_charlie',False); print('true' if v else 'false')" 2>/dev/null || echo "false")

# MCP config flag for Gemini tools via Antigravity
MCP_FLAG=""
if [ -f "$MCP_CONFIG" ]; then
  MCP_FLAG="--mcp-config $MCP_CONFIG"
fi

# ─── Spawn ALPHA (supervisor — persistent) ───────────────────────────
if [ "$SPAWN_ALPHA" = "true" ]; then
  echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('alpha_prompt','Read .collab/alpha/IDENTITY.md first. Then check TASKBOARD.md and supervise.'))" > "$TMP_DIR/alpha-prompt.txt" 2>/dev/null

  log "NEXUS: Spawning ALPHA (supervisor)..."
  tmux kill-session -t "alpha-supervisor" 2>/dev/null || true
  tmux new-session -d -s "alpha-supervisor" \
    "cd $PIPELINE_DIR && env -u CLAUDECODE claude -p \"\$(cat /tmp/pipeline-driver/alpha-prompt.txt)\" $MCP_FLAG --output-format json 2>&1 | tee -a $LOG_FILE; echo 'ALPHA SESSION ENDED at '\$(date) >> $LOG_FILE; sleep 10" 2>/dev/null \
    && log "NEXUS: ALPHA STARTED (alpha-supervisor)" \
    || log "WARN: ALPHA spawn failed"
fi

# ─── Spawn BRAVO (builder 1 — execution path) ────────────────────────
if [ "$SPAWN_BRAVO" = "true" ]; then
  echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('bravo_prompt','Read .collab/bravo/IDENTITY.md first. Then check TASKBOARD.md.'))" > "$TMP_DIR/bravo-prompt.txt" 2>/dev/null

  log "NEXUS: Spawning BRAVO (builder 1)..."
  tmux kill-session -t "bravo-work" 2>/dev/null || true
  tmux new-session -d -s "bravo-work" \
    "cd $PIPELINE_DIR && env -u CLAUDECODE claude -p \"\$(cat /tmp/pipeline-driver/bravo-prompt.txt)\" $MCP_FLAG --output-format json 2>&1 | tee -a $LOG_FILE; echo 'BRAVO SESSION ENDED at '\$(date) >> $LOG_FILE; sleep 10" 2>/dev/null \
    && log "NEXUS: BRAVO STARTED (bravo-work)" \
    || log "WARN: BRAVO spawn failed"
fi

# ─── Spawn CHARLIE (builder 2 — verification path) ───────────────────
if [ "$SPAWN_CHARLIE" = "true" ]; then
  echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('charlie_prompt','Read .collab/charlie/IDENTITY.md first. Then check TASKBOARD.md.'))" > "$TMP_DIR/charlie-prompt.txt" 2>/dev/null

  log "NEXUS: Spawning CHARLIE (builder 2)..."
  tmux kill-session -t "charlie-work" 2>/dev/null || true
  tmux new-session -d -s "charlie-work" \
    "cd $PIPELINE_DIR && env -u CLAUDECODE claude -p \"\$(cat /tmp/pipeline-driver/charlie-prompt.txt)\" $MCP_FLAG --output-format json 2>&1 | tee -a $LOG_FILE; echo 'CHARLIE SESSION ENDED at '\$(date) >> $LOG_FILE; sleep 10" 2>/dev/null \
    && log "NEXUS: CHARLIE STARTED (charlie-work)" \
    || log "WARN: CHARLIE spawn failed"
fi

# ─── Step 7: Save state ──────────────────────────────────────────────
python3 -c "
import json
from datetime import datetime
state = {
    'last_run': datetime.now().isoformat(),
    'alpha_tmux': '$ALPHA_RUNNING',
    'bravo_tmux': '$BRAVO_RUNNING',
    'charlie_tmux': '$CHARLIE_RUNNING',
    'spawn_alpha': '$SPAWN_ALPHA' == 'true',
    'spawn_bravo': '$SPAWN_BRAVO' == 'true',
    'spawn_charlie': '$SPAWN_CHARLIE' == 'true',
    'tokens_exhausted': '$TOKENS_EXHAUSTED' == 'true',
}
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
" 2>/dev/null || log "WARN: Failed to save state"

log "=== NEXUS run complete ==="
