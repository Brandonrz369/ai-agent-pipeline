# OpenClaw Gateway

**The always-running ingress daemon that connects your phone, messaging apps, and
remote interfaces to the Gemini orchestrator and Claude Code execution engine.**

OpenClaw is the front door to the pipeline. It receives natural-language requests from
any configured channel, routes them to Gemini 3.1 Pro for classification and prompt
formatting, then drives the completion loop until a result is delivered back to the
user. It runs as a persistent daemon on your home machine (or VPS), reachable via
Tailscale mesh VPN.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Message Flow](#message-flow)
3. [What Gemini Does (and Does Not Do)](#what-gemini-does-and-does-not-do)
4. [Ingress Channels](#ingress-channels)
5. [N8n Integration](#n8n-integration)
6. [Configuration Reference](#configuration-reference)
7. [Daemon Lifecycle](#daemon-lifecycle)
8. [Cross-References](#cross-references)

---

## Architecture Overview

OpenClaw occupies the ingress layer of the V3 two-tier architecture. It is NOT the
brain -- it is the traffic cop. The division of responsibility is:

| Component | Role | Analogy |
|-----------|------|---------|
| OpenClaw Gateway | Receive requests, manage channels, dispatch to Gemini | Receptionist |
| Gemini 3.1 Pro | Classify tasks, format prompts, parse results, drive retry loop | Project manager |
| Claude Code | Execute code, architect solutions, supervise GUI tasks | Senior engineer |
| Flash-Lite | Verify execution results, compress context for MCP cache | QA tester |

OpenClaw itself is a lightweight Node.js process. It does not perform AI inference.
It maintains WebSocket connections to configured channels, manages authentication,
and shuttles messages between users and the Gemini orchestrator.

---

## Message Flow

The complete lifecycle of a user request:

```
User (Phone / Telegram / Discord)
  |
  v
OpenClaw Gateway (always running, Tailscale-accessible)
  |
  |  [1] Authenticate user, validate channel
  |  [2] Extract request text (strip formatting, handle voice-to-text)
  |  [3] Create task envelope (schemas/task-envelope.schema.json)
  |  [4] Dispatch to Gemini 3.1 Pro
  |
  v
Gemini 3.1 Pro (classify, decompose, format prompt)
  |
  |  [5] Classify: code task? GUI task? simple query? multi-step?
  |  [6] If multi-step: decompose into sub-tasks, create task blueprints
  |  [7] Format appropriate prompt (EXECUTE / ARCHITECT / SUPERVISE)
  |  [8] Dispatch to Claude Code
  |
  v
Claude Code (execute / architect / supervise)
  |
  |  [9] Execute task using permitted tools
  |  [10] Return structured JSON result
  |
  v
Flash-Lite (verify result)
  |
  |  [11] Check: Did output address objective? Obvious errors?
  |  [12] Return: PASS / RETRY / ESCALATE
  |
  v
Gemini 3.1 Pro (drive retry or finalize)
  |
  |  [13] PASS? Summarize result for mobile display
  |  [14] RETRY? Adjust prompt, increment hops, loop back to [7]
  |  [15] ESCALATE? Switch to ARCHITECT mode, loop back to [7]
  |
  v
OpenClaw Gateway
  |
  |  [16] Format response for target channel
  |  [17] Deliver to user via original channel
  |
  v
User receives result
```

### Multi-Step Task Flow

When Gemini detects a multi-step request (e.g., "set up a new Express API with auth,
tests, and deploy to staging"), the flow branches:

```
Gemini decomposes into N sub-tasks
  |
  ├─→ Option A: Sequential dependencies exist
  |     → Dispatch to N8n as a batch (workflows/n8n-fanout-fanin.json)
  |     → N8n handles fan-out, dependency ordering, fan-in
  |     → Results aggregate and return through OpenClaw
  |
  └─→ Option B: Independent sub-tasks
        → Gemini drives each through the completion loop individually
        → Results collected and summarized
        → Single response returned through OpenClaw
```

---

## What Gemini Does (and Does Not Do)

Understanding this boundary is critical. Gemini is the orchestrator, not the brain.

### Gemini DOES:

| Capability | Detail |
|-----------|--------|
| **Classify tasks** | Determine if a request is a code task, GUI task, simple query, or multi-step project |
| **Decompose multi-step requests** | Break complex requests into ordered sub-tasks with dependencies |
| **Format prompts** | Select the correct prompt mode (EXECUTE/ARCHITECT/SUPERVISE) and populate the template |
| **Parse JSON results** | Read Claude Code's structured output and extract status, artifacts, errors |
| **Check pass/fail** | Dispatch to Flash-Lite for verification, interpret PASS/RETRY/ESCALATE |
| **Drive retry loop** | Adjust prompts on failure, increment hop counters, enforce TTL |
| **Summarize for mobile** | Compress verbose results into mobile-friendly summaries |
| **Manage context offloading** | Store compressed context in MCP cache for brain damage prevention |

### Gemini does NOT:

| Capability | Why Not |
|-----------|---------|
| **Write code** | Claude Code is the code generation engine; Gemini lacks the tool access and specialized training |
| **Reason about architecture** | Architectural decisions require deep codebase understanding that Claude Code builds through tool use |
| **Debug errors** | Debugging requires reading files, running tests, and iterating -- Claude Code's domain |
| **Evaluate code quality** | Quality evaluation requires understanding the codebase context that Claude Code holds |
| **Monitor GUI** | Computer Use (screenshot/mouse/keyboard) is a Claude Code capability, not Gemini |
| **See the screen** | Gemini has no access to the desktop environment; only Claude Code in SUPERVISE mode does |

---

## Ingress Channels

### Happy Coder (Primary Mobile App)

The recommended mobile interface. Connects to OpenClaw via Tailscale.

- Native iOS/Android app with end-to-end encryption
- Voice input with automatic transcription
- Real-time streaming of Claude Code output
- Push notifications for completions, failures, and dead-letters
- See `docs/mobile-access.md` for full setup

### Telegram

OpenClaw runs a Telegram bot that listens for messages in a private channel or DM.

- Send tasks as messages, receive results as replies
- Inline keyboard for HITL approvals (react to approve/reject)
- Dead-letter notifications with one-tap retry
- File attachments supported (images, documents forwarded as context)

### Discord

OpenClaw connects to a private Discord server channel.

- Slash commands for structured task submission
- Thread-based conversations for multi-turn interactions
- Role-based access control (only authorized users can submit tasks)
- Webhook integration for N8n notifications

### Claude Code Remote (Browser-Based)

For situations where a full browser interface is preferred over messaging.

- Zero-config via Cloudflare Tunnel
- QR code pairing from mobile
- Full terminal-like interface in any mobile browser
- See `docs/mobile-access.md` for details

---

## N8n Integration

OpenClaw can dispatch tasks directly to N8n workflows, bypassing the single-task
completion loop when batch processing is more appropriate.

### When OpenClaw dispatches to N8n:

- Multi-step tasks with inter-task dependencies (fan-out/fan-in)
- Batch jobs (e.g., "refactor all 12 API endpoints to use the new auth middleware")
- Tasks requiring HITL gates at specific points in the workflow

### How it works:

1. OpenClaw creates task blueprints for each sub-task (`schemas/task-blueprint.schema.json`)
2. OpenClaw POSTs to the N8n webhook endpoint configured in `config/openclaw-config.yaml`
3. N8n receives the batch and executes `workflows/n8n-fanout-fanin.json`
4. Each fan-out branch runs the inner completion loop (see `docs/completion-loop.md`)
5. N8n fan-in gate collects all results
6. N8n POSTs the aggregated result back to OpenClaw's callback endpoint
7. OpenClaw formats and delivers to the user

### Webhook Configuration:

```yaml
# In config/openclaw-config.yaml
n8n:
  webhook_url: "http://localhost:5678/webhook/openclaw-dispatch"
  callback_url: "http://localhost:3000/api/n8n-callback"
  auth_token: "${N8N_AUTH_TOKEN}"
  timeout_ms: 300000  # 5 minutes per batch
```

---

## Configuration Reference

Configuration lives in `config/openclaw-config.yaml`. Below is a complete reference.

```yaml
# config/openclaw-config.yaml

# --- Daemon Settings ---
daemon:
  port: 3000
  host: "0.0.0.0"
  log_level: "info"          # debug | info | warn | error
  pid_file: "~/.openclaw/openclaw.pid"
  log_dir: "~/.openclaw/logs/"

# --- Gemini Orchestrator ---
gemini:
  model: "gemini-3.1-pro"
  api_key: "${GEMINI_API_KEY}"
  temperature: 0.2           # Low temp for consistent classification
  max_tokens: 8192
  timeout_ms: 30000

# --- Flash-Lite Verifier ---
flash_lite:
  model: "gemini-flash-lite"
  api_key: "${GEMINI_API_KEY}"
  temperature: 0.0
  max_tokens: 1024
  timeout_ms: 10000

# --- Claude Code ---
claude:
  binary: "claude"           # Path to claude CLI
  max_concurrent: 3          # Max parallel Claude Code sessions
  session_timeout_ms: 600000 # 10 minutes per session

# --- Task Envelope Defaults ---
task_envelope:
  ttl_max: 10
  hysteresis_fail_threshold: 3
  hysteresis_success_threshold: 2
  dead_letter_path: "~/.openclaw/dead-letter/"

# --- Ingress Channels ---
channels:
  telegram:
    enabled: true
    bot_token: "${TELEGRAM_BOT_TOKEN}"
    allowed_user_ids: [123456789]
  discord:
    enabled: true
    bot_token: "${DISCORD_BOT_TOKEN}"
    guild_id: "your-guild-id"
    channel_id: "your-channel-id"
    allowed_role_ids: ["role-id"]
  happy_coder:
    enabled: true
    port: 3001
    encryption: true

# --- N8n Integration ---
n8n:
  webhook_url: "http://localhost:5678/webhook/openclaw-dispatch"
  callback_url: "http://localhost:3000/api/n8n-callback"
  auth_token: "${N8N_AUTH_TOKEN}"
  timeout_ms: 300000

# --- Networking ---
network:
  tailscale:
    enabled: true
    hostname: "openclaw"
  cloudflare_tunnel:
    enabled: false
    tunnel_id: ""
```

---

## Daemon Lifecycle

### Starting OpenClaw

```bash
# Start as background daemon
openclaw start

# Start in foreground (for debugging)
openclaw start --foreground

# Start with specific config
openclaw start --config /path/to/openclaw-config.yaml
```

### Stopping OpenClaw

```bash
# Graceful shutdown (finishes in-flight tasks)
openclaw stop

# Immediate shutdown (kills active sessions)
openclaw stop --force
```

### Health Check

```bash
# Check daemon status
openclaw status

# Output:
# OpenClaw Gateway v3.0.0
# Status: RUNNING (PID 12345)
# Uptime: 3d 14h 22m
# Active sessions: 2/3
# Channels: telegram(ok) discord(ok) happy_coder(ok)
# Gemini: connected
# N8n: connected
# Dead-letter queue: 1 pending
```

### Logs

```bash
# Tail live logs
openclaw logs --follow

# Show last 100 lines
openclaw logs --lines 100

# Filter by level
openclaw logs --level error
```

---

## Cross-References

| Document | Relevance |
|----------|-----------|
| `docs/completion-loop.md` | The inner loop that OpenClaw dispatches tasks into |
| `docs/prompt-modes.md` | The three prompt modes Gemini selects for Claude Code |
| `docs/anti-loop-safeguards.md` | TTL, hysteresis, and backflow detection that prevent runaway tasks |
| `docs/mobile-access.md` | Detailed setup for all mobile/remote access patterns |
| `docs/computer-use.md` | SUPERVISE mode details for GUI tasks |
| `docs/phase3-n8n-orchestration.md` | N8n workflow architecture that OpenClaw dispatches to |
| `docs/phase6-security.md` | Security model governing all agent actions |
| `security/hitl-gates.md` | HITL gate definitions referenced by OpenClaw's task routing |
| `schemas/task-envelope.schema.json` | Schema for the task envelope OpenClaw creates |
| `schemas/task-blueprint.schema.json` | Schema for task blueprints dispatched to N8n |
| `config/openclaw-config.yaml` | Primary configuration file |
