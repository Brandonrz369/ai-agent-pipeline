#!/bin/bash
# OpenClaw Pipeline Driver — The "whip" that drives Claude Code sessions
#
# V3 Blueprint Architecture:
#   Gemini 3.1 Pro = Traffic cop — reads state, formats prompts, routes
#   Claude Code "Brain" = Makes ALL decisions — what to do, how, why
#   Claude Code Workers = Bravo/Charlie executing tasks
#
# The brain does the thinking. Gemini just reads state and passes it to the brain.

set -euo pipefail

PIPELINE_DIR="/home/brans/ai-agent-pipeline"
COLLAB_DIR="$PIPELINE_DIR/.collab"
STATE_FILE="$HOME/.openclaw/state/pipeline-driver.json"
LOCK_FILE="/tmp/pipeline-driver.lock"
LOG_FILE="$HOME/.openclaw/logs/pipeline-driver.log"

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

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$LOG_FILE")"

log() {
  echo "$(date -Iseconds) $1" | tee -a "$LOG_FILE"
}

log "=== Pipeline Driver Run ==="

# ─── Step 1: Read state (Gemini's job — simple data gathering) ────────
TASKBOARD=$(cat "$COLLAB_DIR/shared/TASKBOARD.md" 2>/dev/null || echo "No taskboard")
MESSAGES=$(tail -40 "$COLLAB_DIR/shared/MESSAGES.md" 2>/dev/null || echo "No messages")
BRAVO_STATUS=$(cat "$COLLAB_DIR/bravo/STATUS.md" 2>/dev/null || echo "UNKNOWN")
CHARLIE_STATUS=$(cat "$COLLAB_DIR/charlie/STATUS.md" 2>/dev/null || echo "UNKNOWN")
ALPHA_STATUS=$(cat "$COLLAB_DIR/alpha/STATUS.md" 2>/dev/null || echo "UNKNOWN")

# Check which tmux sessions are actually running
BRAVO_RUNNING=$(tmux has-session -t "bravo-work" 2>/dev/null && echo "yes" || echo "no")
CHARLIE_RUNNING=$(tmux has-session -t "charlie-work" 2>/dev/null && echo "yes" || echo "no")

log "State: Bravo tmux=$BRAVO_RUNNING, Charlie tmux=$CHARLIE_RUNNING"

# ─── Step 2: Spawn Claude Code BRAIN for decisions ───────────────────
# This is the key V3 insight: Claude Code makes ALL decisions.
# Gemini just gathered the state above. Now Claude Code brain decides.

BRAIN_PROMPT="You are the BRAIN for the OpenClaw Pipeline Driver. You make ALL strategic decisions.

CURRENT STATE:
---
TASKBOARD:
$(echo "$TASKBOARD" | head -40)
---
RECENT MESSAGES (last 40 lines):
$(echo "$MESSAGES" | tail -40)
---
AGENT STATUS:
- Bravo: $(echo "$BRAVO_STATUS" | head -5)
  Bravo tmux session running: $BRAVO_RUNNING
- Charlie: $(echo "$CHARLIE_STATUS" | head -5)
  Charlie tmux session running: $CHARLIE_RUNNING
- Alpha: $(echo "$ALPHA_STATUS" | head -3)
---

PROJECTS:
- AI Agent Pipeline: /home/brans/ai-agent-pipeline/ (107 tests, build clean)
- Legacy Automation Agency: /home/brans/legacy-automation-agency/ (~85% built)

YOUR JOB: Decide what each worker agent should do RIGHT NOW.

Rules:
1. If an agent has no running tmux session, they need to be spawned with a task
2. If an agent is actively working (tmux running + recent STATUS update), let them continue
3. If a STATUS says WORKING but tmux is dead, the agent crashed — respawn them
4. Always check TASKBOARD for OPEN tasks before assigning
5. Be specific: don't say 'continue work' — say exactly what file to create/edit

Reply with ONLY valid JSON, no markdown fences:
{\"spawn_bravo\": true/false, \"bravo_prompt\": \"exact prompt for Bravo's claude -p session\", \"spawn_charlie\": true/false, \"charlie_prompt\": \"exact prompt for Charlie's claude -p session\", \"reasoning\": \"why\"}"

log "Spawning Claude Code brain session for decision..."

BRAIN_DECISION=$(env -u CLAUDECODE claude -p "$BRAIN_PROMPT" --output-format json 2>/dev/null || echo "")

# Parse brain output — claude --output-format json wraps in {"type":"result","result":"..."}
DECISION=$(python3 << PYEOF
import json, re, sys

raw = '''$( echo "$BRAIN_DECISION" | sed "s/'/'\\\\''/g" )'''

try:
    # Try parsing as Claude JSON output format
    outer = json.loads(raw)
    text = outer.get("result", raw)
except:
    text = raw

# Find JSON object in text
match = re.search(r'\{[^{}]*("spawn_bravo"|"spawn_charlie")[^{}]*\}', text, re.DOTALL)
if match:
    try:
        decision = json.loads(match.group())
        print(json.dumps(decision))
    except:
        print('{"error": "json_parse_failed", "raw": ' + json.dumps(text[:300]) + '}')
else:
    # Try finding any JSON
    match2 = re.search(r'\{[\s\S]*\}', text)
    if match2:
        try:
            print(json.dumps(json.loads(match2.group())))
        except:
            print('{"error": "no_valid_json", "raw": ' + json.dumps(text[:300]) + '}')
    else:
        print('{"error": "no_json", "raw": ' + json.dumps(text[:300]) + '}')
PYEOF
)

if echo "$DECISION" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); assert 'error' not in d" 2>/dev/null; then
  log "Brain decision: $DECISION"
else
  log "WARN: Brain decision failed: $DECISION"
  # Fallback: spawn both if they're not running
  DECISION="{\"spawn_bravo\": $([ "$BRAVO_RUNNING" = "no" ] && echo "true" || echo "false"), \"bravo_prompt\": \"You are BRAVO. Read /home/brans/ai-agent-pipeline/.collab/shared/TASKBOARD.md and work on the first OPEN task assigned to you. Update bravo/STATUS.md when done.\", \"spawn_charlie\": $([ "$CHARLIE_RUNNING" = "no" ] && echo "true" || echo "false"), \"charlie_prompt\": \"You are CHARLIE. Read /home/brans/ai-agent-pipeline/.collab/shared/TASKBOARD.md and work on the first OPEN task assigned to you. Update charlie/STATUS.md when done.\", \"reasoning\": \"Fallback: spawning idle agents\"}"
  log "Using fallback: $DECISION"
fi

# ─── Step 3: Post brain's decision to MESSAGES.md ────────────────────
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%MZ")
REASONING=$(echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('reasoning','No reasoning'))" 2>/dev/null || echo "Auto-assigned")

cat >> "$COLLAB_DIR/shared/MESSAGES.md" << EOF

[$TIMESTAMP] OPENCLAW-DRIVER→ALL: **Automated assignment** (Claude Code brain decision)
- Reasoning: $REASONING
- Bravo tmux running: $BRAVO_RUNNING
- Charlie tmux running: $CHARLIE_RUNNING
EOF

# ─── Step 4: ACTUALLY SPAWN worker sessions ──────────────────────────
SPAWN_BRAVO=$(echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('spawn_bravo', False))" 2>/dev/null || echo "False")
SPAWN_CHARLIE=$(echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('spawn_charlie', False))" 2>/dev/null || echo "False")

if [ "$SPAWN_BRAVO" = "True" ] || [ "$SPAWN_BRAVO" = "true" ]; then
  BRAVO_PROMPT=$(echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('bravo_prompt','Read TASKBOARD.md and work on your next OPEN task.'))" 2>/dev/null || echo "Read TASKBOARD.md and work on your next OPEN task.")

  log "SPAWNING Bravo worker session..."
  tmux kill-session -t "bravo-work" 2>/dev/null || true
  tmux new-session -d -s "bravo-work" \
    "cd $PIPELINE_DIR && env -u CLAUDECODE claude -p '$BRAVO_PROMPT' --output-format json; echo 'SESSION ENDED'; sleep 5" 2>/dev/null \
    && log "Bravo tmux session STARTED" \
    || log "WARN: Failed to start Bravo tmux"
fi

if [ "$SPAWN_CHARLIE" = "True" ] || [ "$SPAWN_CHARLIE" = "true" ]; then
  CHARLIE_PROMPT=$(echo "$DECISION" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('charlie_prompt','Read TASKBOARD.md and work on your next OPEN task.'))" 2>/dev/null || echo "Read TASKBOARD.md and work on your next OPEN task.")

  log "SPAWNING Charlie worker session..."
  tmux kill-session -t "charlie-work" 2>/dev/null || true
  tmux new-session -d -s "charlie-work" \
    "cd $PIPELINE_DIR && env -u CLAUDECODE claude -p '$CHARLIE_PROMPT' --output-format json; echo 'SESSION ENDED'; sleep 5" 2>/dev/null \
    && log "Charlie tmux session STARTED" \
    || log "WARN: Failed to start Charlie tmux"
fi

# ─── Step 5: Save state ──────────────────────────────────────────────
python3 -c "
import json
from datetime import datetime
state = {
    'last_run': datetime.now().isoformat(),
    'decision': json.loads('''$(echo "$DECISION" | sed "s/'/'\\\\''/g")'''),
    'bravo_tmux': '$BRAVO_RUNNING',
    'charlie_tmux': '$CHARLIE_RUNNING',
}
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
" 2>/dev/null || log "WARN: Failed to save state"

log "=== Driver run complete ==="
