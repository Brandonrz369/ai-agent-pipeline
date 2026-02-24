#!/bin/bash
# OpenClaw Pipeline Driver — The "whip" that drives Claude Code sessions
#
# This script runs as an OpenClaw cron job or always-on agent.
# It uses Gemini 3.1 Pro (via Antigravity proxy) to orchestrate,
# and spawns Claude Code sessions to do the actual work.
#
# Architecture (per V3 Blueprint):
#   OpenClaw + Gemini 3.1 Pro = Traffic cop (this script)
#   Claude Code sessions = Brain + Executor + Supervisor
#
# Usage:
#   openclaw cron add --name pipeline-driver --schedule "every 5m" --command "bash scripts/openclaw-driver.sh"
#   OR: bash scripts/openclaw-driver.sh  (manual run)

set -euo pipefail

PIPELINE_DIR="/home/brans/ai-agent-pipeline"
COLLAB_DIR="$PIPELINE_DIR/.collab"
STATE_FILE="$HOME/.openclaw/state/pipeline-driver.json"
LOCK_FILE="/tmp/pipeline-driver.lock"
LOG_FILE="$HOME/.openclaw/logs/pipeline-driver.log"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "$(date -Iseconds) SKIP: Driver already running (PID $LOCK_PID)" >> "$LOG_FILE"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$LOG_FILE")"

log() {
  echo "$(date -Iseconds) $1" >> "$LOG_FILE"
  echo "$1"
}

log "=== Pipeline Driver Run ==="

# Step 1: Read current state from collab files
TASKBOARD=$(cat "$COLLAB_DIR/shared/TASKBOARD.md" 2>/dev/null || echo "")
MESSAGES=$(tail -30 "$COLLAB_DIR/shared/MESSAGES.md" 2>/dev/null || echo "")
BRAVO_STATUS=$(cat "$COLLAB_DIR/bravo/STATUS.md" 2>/dev/null || echo "UNKNOWN")
CHARLIE_STATUS=$(cat "$COLLAB_DIR/charlie/STATUS.md" 2>/dev/null || echo "UNKNOWN")
ALPHA_STATUS=$(cat "$COLLAB_DIR/alpha/STATUS.md" 2>/dev/null || echo "UNKNOWN")

# Step 2: Check what projects need work
LEGACY_DIR="/home/brans/legacy-automation-agency"
LEGACY_EXISTS=$([ -d "$LEGACY_DIR" ] && echo "yes" || echo "no")

# Step 3: Use Gemini 3.1 Pro to decide next actions
# This call goes through the Antigravity proxy at localhost:8080
DECISION_PROMPT="You are the OpenClaw Pipeline Driver — the autonomous orchestrator.

CURRENT STATE:
- Taskboard: $TASKBOARD
- Recent Messages: $MESSAGES
- Bravo Status: $BRAVO_STATUS
- Charlie Status: $CHARLIE_STATUS
- Alpha Status: $ALPHA_STATUS
- Legacy Automation Agency exists: $LEGACY_EXISTS

Your job: Decide what Claude Code sessions (Alpha/Bravo/Charlie) should work on next.
If all pipeline tasks are done, assign work on the Legacy Automation Agency.
The Legacy Automation Agency needs: tests, error handling, authentication, documentation.

Reply with a JSON object:
{
  \"alpha_task\": \"what Alpha should do\",
  \"bravo_task\": \"what Bravo should do\",
  \"charlie_task\": \"what Charlie should do\",
  \"priority\": \"HIGH|MEDIUM|LOW\",
  \"reasoning\": \"why these assignments\"
}"

# Try Antigravity proxy first (Gemini 3.1 Pro)
DECISION=$(curl -s -X POST "http://127.0.0.1:8080/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -H "anthropic-version: 2023-06-01" \
  -d "{
    \"model\": \"gemini-3.1-pro-high\",
    \"max_tokens\": 2048,
    \"messages\": [{\"role\": \"user\", \"content\": \"$DECISION_PROMPT\"}]
  }" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    # Anthropic format response
    if 'content' in d:
        for block in d['content']:
            if block.get('type') == 'text':
                print(block['text'])
                break
    elif 'error' in d:
        print(json.dumps({'error': d['error']}))
except:
    print('{\"error\": \"parse_failed\"}')
" 2>/dev/null)

if [ -z "$DECISION" ] || echo "$DECISION" | grep -q '"error"'; then
  log "WARN: Gemini 3.1 Pro decision failed, using fallback logic"
  # Fallback: check if pipeline tasks are done, then assign Legacy work
  if echo "$TASKBOARD" | grep -q "OPEN\|IN_PROGRESS"; then
    DECISION='{"alpha_task":"Continue supervising pipeline tasks","bravo_task":"Continue current pipeline task","charlie_task":"Continue current pipeline task","priority":"HIGH","reasoning":"Pipeline tasks still open"}'
  else
    DECISION='{"alpha_task":"Supervise Legacy Automation Agency work","bravo_task":"Add tests to Legacy Automation Agency","charlie_task":"Add error handling and docs to Legacy Automation Agency","priority":"HIGH","reasoning":"Pipeline complete, moving to Legacy"}'
  fi
fi

log "Decision: $DECISION"

# Step 4: Post decisions to MESSAGES.md for agents to pick up
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%MZ")

# Extract tasks from JSON
ALPHA_TASK=$(echo "$DECISION" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('alpha_task','No task'))" 2>/dev/null || echo "Review state")
BRAVO_TASK=$(echo "$DECISION" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('bravo_task','No task'))" 2>/dev/null || echo "Continue work")
CHARLIE_TASK=$(echo "$DECISION" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('charlie_task','No task'))" 2>/dev/null || echo "Continue work")
REASONING=$(echo "$DECISION" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('reasoning','Auto-assigned'))" 2>/dev/null || echo "Auto-assigned")

cat >> "$COLLAB_DIR/shared/MESSAGES.md" << EOF

[$TIMESTAMP] OPENCLAW-DRIVER→ALL: **Automated task assignment** (Gemini 3.1 Pro decision)
- Reasoning: $REASONING
- Alpha: $ALPHA_TASK
- Bravo: $BRAVO_TASK
- Charlie: $CHARLIE_TASK
EOF

# Step 5: Save state
cat > "$STATE_FILE" << EOF
{
  "last_run": "$(date -Iseconds)",
  "decision": $DECISION,
  "agents": {
    "alpha": "$(echo "$ALPHA_STATUS" | head -5 | tr '\n' ' ')",
    "bravo": "$(echo "$BRAVO_STATUS" | head -5 | tr '\n' ' ')",
    "charlie": "$(echo "$CHARLIE_STATUS" | head -5 | tr '\n' ' ')"
  }
}
EOF

# Step 6: If agents are idle, spawn Claude Code sessions to push them
# Check if Bravo is idle
if echo "$BRAVO_STATUS" | grep -qi "standing by\|idle\|DONE.*Standing"; then
  log "Bravo is idle — spawning Claude Code session with task"
  # Spawn in background via tmux
  tmux new-session -d -s "bravo-work" "cd $PIPELINE_DIR && claude -p \"Read $COLLAB_DIR/shared/MESSAGES.md for your latest assignment. You are BRAVO. Execute the task assigned to you. When done, update bravo/STATUS.md and post completion to shared/MESSAGES.md.\" --output-format json" 2>/dev/null || true
fi

if echo "$CHARLIE_STATUS" | grep -qi "standing by\|idle\|DONE.*Standing"; then
  log "Charlie is idle — spawning Claude Code session with task"
  tmux new-session -d -s "charlie-work" "cd $PIPELINE_DIR && claude -p \"Read $COLLAB_DIR/shared/MESSAGES.md for your latest assignment. You are CHARLIE. Execute the task assigned to you. When done, update charlie/STATUS.md and post completion to shared/MESSAGES.md.\" --output-format json" 2>/dev/null || true
fi

log "=== Driver run complete ==="
