#!/bin/bash
# Hourly status notification — sends Discord update with agent usage stats
# Called by crontab every hour

set -euo pipefail

PIPELINE_DIR="/home/brans/ai-agent-pipeline"
cd "$PIPELINE_DIR"

# Load secrets
if [ -f "$PIPELINE_DIR/.env" ]; then
  set -a; source "$PIPELINE_DIR/.env"; set +a
fi

WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"
if [ -z "$WEBHOOK_URL" ]; then
  echo "No DISCORD_WEBHOOK_URL set, skipping"
  exit 0
fi

# Run usage tracker check (sends alerts at thresholds)
python3 "$PIPELINE_DIR/scripts/usage-tracker.py" check 2>/dev/null || true

# Build status message
STATUS=$(python3 -c "
import json
from pathlib import Path
import subprocess

SESSION_DIR = Path.home() / '.claude/projects/-home-brans-ai-agent-pipeline'
DRIVER_DIR = Path('/tmp/pipeline-driver')

agents = ['alpha', 'bravo', 'charlie']
lines = []

for agent in agents:
    sid_file = DRIVER_DIR / f'{agent}-session-id.txt'
    if sid_file.exists():
        sid = sid_file.read_text().strip()
        jsonl = SESSION_DIR / f'{sid}.jsonl'
        if jsonl.exists():
            assistant_count = 0
            with open(jsonl) as f:
                for line in f:
                    try:
                        d = json.loads(line)
                        if d.get('type') == 'assistant':
                            assistant_count += 1
                    except:
                        pass
            size_kb = round(jsonl.stat().st_size / 1024, 1)
            pct = round((assistant_count / 100) * 100)
            bar = '█' * (pct // 10) + '░' * (10 - pct // 10)
            lines.append(f'{agent.upper()}: {assistant_count} turns ({pct}%) [{bar}] {size_kb}KB')
        else:
            lines.append(f'{agent.upper()}: session file missing')
    else:
        lines.append(f'{agent.upper()}: no active session')

# Check tmux
tmux = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'], capture_output=True, text=True)
if tmux.returncode == 0 and tmux.stdout.strip():
    running = tmux.stdout.strip().replace(chr(10), ', ')
else:
    running = 'none'
lines.append(f'\\nRunning tmux sessions: {running}')

# Check Antigravity
import urllib.request
try:
    req = urllib.request.Request('http://127.0.0.1:8080/', method='HEAD')
    urllib.request.urlopen(req, timeout=3)
    lines.append('Antigravity proxy: up')
except:
    lines.append('Antigravity proxy: down (using OpenRouter)')

# OpenRouter cost tracking
cost_file = Path('/tmp/pipeline-driver/cost-tracker.json')
if cost_file.exists():
    try:
        cost_data = json.loads(cost_file.read_text())
        total_cost = cost_data.get('total_cost', 0)
        total_calls = cost_data.get('calls', 0)
        total_in = cost_data.get('total_input_tokens', 0)
        total_out = cost_data.get('total_output_tokens', 0)
        started = cost_data.get('started', 'unknown')[:10]
        lines.append(f'\\nOpenRouter cost since {started}: \${total_cost:.4f} ({total_calls} calls, {total_in:,} in + {total_out:,} out tokens)')
        by_caller = cost_data.get('by_caller', {})
        for caller, stats in by_caller.items():
            lines.append(f'  {caller}: \${stats[\"cost\"]:.4f} ({stats[\"calls\"]} calls)')
    except:
        pass
else:
    lines.append('\\nOpenRouter cost: \$0.00 (no calls yet)')

print('\\n'.join(lines))
" 2>/dev/null || echo "Status check failed")

# Send Discord embed
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HOUR=$(date +"%I %p")

# Generate PDF report
PDF_PATH=$(python3 "$PIPELINE_DIR/scripts/generate-report-pdf.py" 2>/dev/null || echo "")

if [ -n "$PDF_PATH" ] && [ -f "$PDF_PATH" ]; then
  # Send embed + PDF attachment together
  curl -s -o /dev/null -X POST "$WEBHOOK_URL" \
    -F "file=@${PDF_PATH}" \
    -F "payload_json=$(python3 -c "
import json
status = '''$STATUS'''
payload = {
    'content': '',
    'embeds': [{
        'title': 'Hourly Pipeline Status ($HOUR)',
        'description': status,
        'color': 3447003,
        'timestamp': '$TIMESTAMP',
        'footer': {'text': 'AI Agent Pipeline - Hourly Update'}
    }]
}
print(json.dumps(payload))
")" && echo "Discord notification sent (with PDF)" || echo "Discord notification failed"
else
  # Fallback: send embed only
  curl -s -o /dev/null -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
status = '''$STATUS'''
payload = {
    'embeds': [{
        'title': 'Hourly Pipeline Status ($HOUR)',
        'description': status,
        'color': 3447003,
        'timestamp': '$TIMESTAMP',
        'footer': {'text': 'AI Agent Pipeline - Hourly Update'}
    }]
}
print(json.dumps(payload))
")" && echo "Discord notification sent (no PDF)" || echo "Discord notification failed"
fi
