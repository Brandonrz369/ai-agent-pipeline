# Phase 3: N8n Workflow Orchestration

**Automate agent delegation, parallelization, synchronization, and alerting --
closing the "human courier" gap that limits manual multi-agent setups.**

Without orchestration, multi-agent pipelines require a human to copy outputs between
agents, check completion status, and trigger the next step. N8n replaces that manual
labor with event-driven workflows.

---

## Table of Contents

1. [Why N8n](#why-n8n)
2. [Workflow A: Fan-Out / Fan-In](#workflow-a-fan-out--fan-in)
3. [Workflow B: Automated Delegation Chain](#workflow-b-automated-delegation-chain)
4. [Workflow C: Cache Monitor](#workflow-c-cache-monitor)
5. [Workflow D: Git Audit Trail](#workflow-d-git-audit-trail)
6. [Workflow E: HITL Gate](#workflow-e-hitl-gate)
7. [N8n Installation and Setup](#n8n-installation-and-setup)
8. [Workspace Sync (VPS and Local)](#workspace-sync-vps-and-local)

---

## Why N8n

The GTG-1002 attack pattern (see `GTG1002_ANALYSIS.md`) demonstrated that automated
agent-to-agent handoff is the critical enabler for sustained autonomous operation.
In that attack, each completed agent automatically triggered the next without human
intervention. That is what made it fast.

In a manual multi-agent setup, the human operator is the bottleneck:

```
Agent 1 completes → Human reads report → Human copies output →
Human writes new prompt → Human pastes to Agent 2 → Agent 2 starts
```

Time per handoff: 2-5 minutes (human speed). For a 20-task pipeline with dependencies,
that is 40-100 minutes of pure overhead.

**N8n replaces this with:**

```
Agent 1 writes report file → N8n detects file → N8n parses status →
N8n writes next task file → Agent 2 starts (triggered by file watcher)
```

Time per handoff: <5 seconds (machine speed).

### Why N8n Specifically

| Feature | N8n | Alternatives |
|---------|-----|-------------|
| Self-hostable | Yes (VPS, Docker) | Zapier/Make: cloud-only, data leaves your infra |
| MCP integration | Native (as client and server) | Most lack MCP support |
| File system triggers | Built-in | Many require workarounds |
| JSON manipulation | Native nodes | Often needs custom code |
| Discord/Slack webhooks | Built-in | Usually available |
| Cost | Free (self-hosted) | Zapier: $20-600/mo for this volume |
| Workflow export/import | JSON files (version-controllable) | Proprietary formats |

---

## Workflow A: Fan-Out / Fan-In

This is the core parallel execution workflow. It takes a batch of task blueprints and
runs them simultaneously, waiting for all to complete before proceeding.

### Trigger

A new JSON file appears in `prompts/` matching the pattern `batch*_tasks.json`.

### Step 1: Fan-Out

```
[File Trigger: prompts/batch*_tasks.json]
    |
    v
[JSON Parse Node]
    Parse the file into an array of task objects
    |
    v
[Split In Batches Node]
    For each task in the array:
    |
    +---> [Sub-Workflow: Execute Task]  (async, task 1)
    +---> [Sub-Workflow: Execute Task]  (async, task 2)
    +---> [Sub-Workflow: Execute Task]  (async, task 3)
    ...
```

Each sub-workflow:
1. Loads the agent context (system prompt from `templates/worker-prompt.md`)
2. Injects the specific task JSON
3. Runs the agent (via Claude API or local Claude Code instance)
4. Writes the report to `reports/`
5. Sends a callback to the fan-in gate

### Step 2: Fan-In Gate

The Fan-In node maintains a checklist of expected task_ids. It scans `reports/` for
completed batch reports. When all task_ids are accounted for, it returns
`ALL_COMPLETE` and proceeds. Otherwise it returns `WAITING` with the remaining list.

### Step 3: Red Team Trigger

Once all tasks complete:
```
[Fan-In: ALL_COMPLETE]
    |
    v
[Write File Node]
    Write prompts/redteam_batch[N].json
    (Red Team review task referencing all batch outputs)
    |
    v
[Discord Webhook Node]
    "Batch N complete. Red Team review queued. [X] tasks passed, [Y] partial."
```

### Step 4: Orchestrator Summary

```
[Red Team Report Received]
    |
    v
[Aggregate Node]
    Collect all reports from reports/n*_batch[N].md
    |
    v
[Summary Generation Node]
    Compile into batch summary with pass/fail/partial counts
    |
    v
[POST to Orchestrator Webhook]
    Orchestrator (Node 0) receives the summary for strategic decisions
```

---

## Workflow B: Automated Delegation Chain

This workflow handles sequential task dependencies -- when one agent's output triggers
the next agent's input.

### Trigger

A new file appears in `reports/` matching `n[2-5]_*.md`.

### Logic

```yaml
trigger: File created in reports/ matching n[2-5]_*.md

steps:
  - read: Parse the report file
  - extract: Find the "status" field in the report

  - if status == "PASS":
      - determine_next: Look up the dependency graph for the next task
      - write_task: Write the next task JSON to prompts/
      - notify: Discord "Node X PASSED. Node Y dispatched."

  - if status == "FAIL":
      - stop: Do not dispatch any downstream tasks
      - alert: Discord "Node X FAILED. Manual review required."
      - tag: Add to blocked_tasks.json for orchestrator review

  - if status == "PARTIAL":
      - alert: Discord "Node X PARTIAL. Human decision needed."
      - wait: Pause until human responds via Discord reaction or webhook
      - if approved: proceed as PASS
      - if rejected: proceed as FAIL

  - if status == "BLOCKED":
      - alert: Discord "Node X BLOCKED by dependency. Check upstream."
      - log: Record in blocked_tasks.json
```

### N8n Implementation

```javascript
// Status Parser Node
const reportContent = $input.first().json.content;
const statusMatch = reportContent.match(/## Status:\s*(PASS|FAIL|PARTIAL|BLOCKED)/);
const status = statusMatch ? statusMatch[1] : 'UNKNOWN';

return [{ json: { status, report: reportContent } }];
```

The Switch node routes to the appropriate branch based on the parsed status.

---

## Workflow C: Cache Monitor

Gemini caches expire. If a cache expires mid-pipeline, agents lose access to the
shared knowledge base. This workflow prevents that.

### Trigger

Cron schedule: every 90 minutes.

### Logic

```yaml
trigger: Cron every 90 minutes

steps:
  - list_caches: Call gemini-list-caches via MCP
  - check_required: Compare against required cache list in config/required-caches.yaml
  - for each missing or expiring cache:
      - alert: Discord "Cache [name] missing or expiring in < 30 min"
      - rebuild: Execute cache rebuild script (re-create from source files)
  - if all caches healthy:
      - log: "Cache check passed" (no alert needed)
```

Define required caches in `config/required-caches.yaml` with name, source file path,
TTL, and criticality flag. The monitor rebuilds critical caches automatically and
alerts on non-critical ones.

---

## Workflow D: Git Audit Trail

Every completed task with a PASS status gets its changes committed to git. This
creates a verifiable chain of custody for every modification.

### Trigger

A file appears in `reports/` matching `*_batch*.md` with status `PASS`.

### Logic

```yaml
trigger: Report file with status PASS

steps:
  - parse_report: Extract files_changed list from the report
  - git_add: Stage only the files listed in files_changed
  - git_commit:
      message: "Batch {N} [{task_id}]: {objective} -- Status: PASS"
  - notify: Discord "Committed batch N to git: {task_id}"
```

The commit script stages only the specific files listed in the report's `files_changed`
field, then commits with a structured message: `"Batch N [task_id]: objective -- Status: PASS"`.

**Important:** This workflow commits but does NOT push. Pushing is a HITL-gated action
(see Workflow E and [Phase 6: Security](phase6-security.md)).

---

## Workflow E: HITL Gate

Human-in-the-loop gates pause the pipeline and wait for human approval before
proceeding with high-consequence actions.

### Trigger

Any task with `requires_human_approval: true` reaches completion, OR any action
matches a pattern in `security/hitl-gates.md`.

### Logic

```yaml
trigger: Task completion where requires_human_approval == true

steps:
  - pause: Hold the next workflow step
  - notify: Discord "APPROVAL REQUIRED: [task details]"
  - include:
      - What the task did
      - Files changed
      - Summary of changes
      - "Reply with checkmark to proceed, X to block"
  - wait: Monitor Discord for human reaction
  - if approved:
      - resume: Continue the delegation chain
      - log: "Approved by [user] at [timestamp]"
  - if blocked:
      - stop: Mark task as BLOCKED
      - alert: "Task blocked by [user]. Manual intervention required."
```

### HITL-Triggering Patterns

These patterns always require human approval, regardless of the task's
`requires_human_approval` field:

```yaml
# From security/hitl-gates.md
require_human_approval:
  - pattern: "git push"
  - pattern: "send email"
  - pattern: "deploy to production"
  - pattern: "delete *"
  - pattern: "drop table"
  - pattern: "rm -rf"
  - file_destinations: ["external/", "outbox/"]
  - status_transitions: ["DRAFT -> FINAL", "STAGED -> PROD"]

auto_approved:
  - pattern: "read *"
  - pattern: "write reports/*"
  - pattern: "write prompts/*"
  - pattern: "git add && git commit"
  - pattern: "npm test"
```

---

## N8n Installation and Setup

### VPS Installation

```bash
# Install Node.js 18+ (if not already present)
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install N8n globally
npm install -g n8n

# Create systemd service
cat > /etc/systemd/system/n8n.service << 'EOF'
[Unit]
Description=N8n workflow automation
After=network.target

[Service]
Environment=DISCORD_WEBHOOK_URL=your_webhook_url
Environment=N8N_PORT=5678
Environment=N8N_BASIC_AUTH_ACTIVE=true
Environment=N8N_BASIC_AUTH_USER=admin
Environment=N8N_BASIC_AUTH_PASSWORD=your_secure_password
Environment=N8N_PROTOCOL=https
Environment=N8N_HOST=your-vps-domain.com
Environment=GENERIC_TIMEZONE=America/Los_Angeles
ExecStart=/usr/bin/n8n start
Restart=always
User=root
WorkingDirectory=/root

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable n8n
systemctl start n8n
```

### Importing Workflows

```bash
# Import workflow JSON files from the workflows/ directory
n8n import:workflow --input=workflows/n8n-fanout-fanin.json
n8n import:workflow --input=workflows/n8n-delegation-chain.json
n8n import:workflow --input=workflows/n8n-cache-monitor.json
n8n import:workflow --input=workflows/n8n-audit-trail.json
```

### Required Credentials in N8n

Configure these in Settings > Credentials: Discord Webhook (notifications),
Anthropic API Key (agent execution), Gemini API Key (cache/research),
GitHub Token (audit trail). Filesystem access is automatic when the project
directory is mounted.

---

## Workspace Sync (VPS and Local)

The pipeline assumes a shared git repository between VPS and local development machines.
Changes made by agents on the VPS must be visible locally, and vice versa.

### Sync Setup

```bash
# On VPS: auto-pull every 5 minutes
echo "*/5 * * * * cd /root/project && git pull origin main 2>&1 >> /var/log/sync.log" \
  >> /etc/crontab
```

Conflict prevention: each agent has a dedicated `write_scope` (from the task blueprint),
only one agent writes to any given file at a time, and git audit commits happen after
fan-in (all agents done), not during execution.

---

## What Comes Next

The orchestrated workflows dispatch tasks to agents, but which model runs each task?
That is determined by [Phase 4: Intent-Based Model Routing](phase4-model-routing.md),
which routes each task to the cheapest model that can handle it.
