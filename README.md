# Autonomous AI Agent Pipeline
## Two-Tier Agent Architecture — Gemini Orchestrator + Claude Code Brain/Executor/Supervisor
## Version 2.0 — February 2026

---

> **Derived from**: GTG-1002 attack pattern research (Anthropic, Nov 2025) + Project Titan
> legal defense multi-agent execution + 2026 enterprise AI engineering best practices.

---

## What This Is

A production-grade orchestration framework for autonomous multi-agent AI workflows.
Gemini 3.1 Pro routes your requests and drives the retry loop. Claude Code does ALL the
thinking, coding, and GUI supervision. Anti-loop safeguards guarantee bounded cost.

**The core problem:**
Any task complex enough to require deep research, parallel workstreams, and iterative
refinement will break a single agent through context limits, hallucination cascade, or
strategy conflicts.

**The solution:**
A two-tier system where Gemini is the traffic cop and Claude Code is the workforce —
brain, executor, and supervisor — with industrial-grade anti-loop safeguards, brain
damage prevention via MCP context caching, and mobile/remote access via OpenClaw.

---

## Quick Start

### Prerequisites

- **Node.js** >= 22
- **Claude Code** CLI (`claude` in PATH) — the brain/executor
- **Gemini API Key** — for orchestration, verification, and caching

### Install

```bash
cd ai-agent-pipeline
npm install
cp .env.example .env
# Edit .env and set GEMINI_API_KEY
```

### Run Tests

```bash
npm test                    # Run all 93 tests
npm run build               # Compile TypeScript → dist/
npm run dev -- status       # Run CLI in dev mode
```

### CLI Commands

```bash
# Full pipeline — research → decompose → dispatch
npx tsx src/cli.ts run "Build a Discord bot in Python"

# Individual phases
npx tsx src/cli.ts research "authentication patterns for Node.js"
npx tsx src/cli.ts decompose research-output.md
npx tsx src/cli.ts dispatch prompts/batch1_tasks.json
npx tsx src/cli.ts dispatch prompts/batch1_tasks.json --dry-run

# Validation
npx tsx src/cli.ts validate prompts/batch1_tasks.json

# Dead-letter queue management
npx tsx src/cli.ts dead-letter list
npx tsx src/cli.ts dead-letter inspect <id>
npx tsx src/cli.ts dead-letter retry <id>

# Audit trail
npx tsx src/cli.ts audit list
npx tsx src/cli.ts audit verify

# Status
npx tsx src/cli.ts status

# Webhook server (for N8n callbacks and HITL approvals)
npx tsx src/cli.ts serve --port 3847
```

### OpenClaw Integration

If you have OpenClaw installed, dispatch from your phone:

```bash
# Install pipeline as an OpenClaw skill
npx tsx src/cli.ts serve    # Start the gateway

# Then from Telegram/Discord/Happy Coder:
# "Run pipeline: Build a Discord bot in Python"
# OpenClaw routes to Gemini → Claude Code → results back to your phone
```

---

## Architecture

```
YOU (Phone / Discord / CLI)
  │
  ▼
OPENCLAW GATEWAY (always running)
  │
  ▼
GEMINI 3.1 PRO (traffic cop — routes, doesn't think)
  │
  ├── Classifies task type (code / GUI / research / simple)
  ├── Selects prompt mode (EXECUTE / ARCHITECT / SUPERVISE)
  ├── Formats prompt from templates
  │
  ▼
CLAUDE CODE (brain + executor + supervisor)
  │
  ├── EXECUTE: Write code, edit files, run commands
  ├── ARCHITECT: Read-only analysis after 3 failures
  ├── SUPERVISE: Vision + mouse + keyboard for GUI tasks
  │
  ▼
FLASH-LITE VERIFIER → PASS / RETRY / ESCALATE
  │
  ▼
ANTI-LOOP SAFEGUARDS
  ├── TTL: Max 10 hops → dead-letter queue
  ├── Hysteresis: 3 failures → ARCHITECT, 2 successes → EXECUTE
  └── Backflow: SHA-256 state hash → detect A-B-A cycles
```

### Three Prompt Modes

| Mode | When | Tools | Purpose |
|------|------|-------|---------|
| **EXECUTE** | First attempt | Bash, Read, Write, Edit, Glob, Grep | Write code, run commands |
| **ARCHITECT** | After 3 failures | Read only | Root cause analysis, new plan |
| **SUPERVISE** | GUI tasks | Computer Use + Bash + Read + Write | Install apps, click wizards |

### Completion Loop

```
Task → Classify → Format Prompt → Execute (Claude) → Verify (Flash-Lite)
                                                          │
                                              PASS ← ─ ─ ┤
                                              RETRY → anti-loop → retry
                                              ESCALATE → dead-letter
```

---

## Project Structure

```
ai-agent-pipeline/
├── src/                          # TypeScript runtime (42 files)
│   ├── cli.ts                    # CLI entry point (8 commands)
│   ├── commands/                 # CLI command implementations
│   ├── orchestrator/             # Gemini completion loop engine
│   │   ├── index.ts              # GeminiOrchestrator class
│   │   ├── loop-driver.ts        # THE completion loop
│   │   ├── classifier.ts         # Task type → mode/tier routing
│   │   └── prompt-formatter.ts   # Template filling + security injection
│   ├── executor/                 # Claude Code session management
│   │   ├── index.ts              # ClaudeCodeExecutor class
│   │   ├── session.ts            # Process spawning + output parsing
│   │   └── modes.ts              # EXECUTE/ARCHITECT/SUPERVISE config
│   ├── verifier/                 # Flash-Lite post-execution verification
│   ├── anti-loop/                # TTL, hysteresis, backflow, dead-letter
│   ├── gateway/                  # Webhook server + OpenClaw bridge
│   ├── router/                   # Task → tier routing
│   ├── decomposer/              # Research → task blueprints
│   ├── security/                 # RBAC, HITL gates, Discord HITL
│   ├── audit/                    # HMAC-signed tamper-evident logging
│   ├── mcp-servers/              # Brain context MCP server
│   ├── schema/                   # AJV JSON Schema validation
│   ├── config/                   # YAML config loading
│   ├── utils/                    # Logger, hash, template, retry
│   └── types/                    # TypeScript interfaces
├── schemas/                      # JSON Schema contracts
├── templates/                    # Prompt templates (7 modes)
├── config/                       # YAML configuration
├── workflows/                    # N8n workflow exports
├── docs/                         # Phase documentation (13 files)
├── security/                     # Threat model, RBAC, HITL gates
├── reports/                      # Agent execution reports
└── prompts/                      # Task blueprint batches
```

---

## Anti-Loop Safeguards

Every task runs inside a **Task Envelope** that tracks execution state:

```json
{
  "ttl_max": 10,
  "hops": 0,
  "mode": "EXECUTE",
  "consecutive_failures": 0,
  "consecutive_successes": 0,
  "escalated": false,
  "state_hashes": []
}
```

**Three Laws:**
1. **TTL** — Max 10 hops. Tasks exceeding TTL go to dead-letter queue with notification.
2. **Hysteresis** — 3 failures → escalate to ARCHITECT. 2 successes → de-escalate. No flicker.
3. **Backflow** — SHA-256 hash target files. If state matches a previous hop → A-B-A cycle detected → blocked.

---

## Security

- **RBAC** — Per-node read/write/execute permissions
- **HITL Gates** — Human approval for git push, deploy, delete, credential entry
- **Discord HITL** — Rich embeds with approve/reject buttons, timeout defaults
- **Prompt Injection Defense** — Security notice appended to every prompt
- **Audit Trail** — HMAC-SHA256 signed entries, tamper detection via `pipeline audit verify`
- **MCP Image Pinning** — SHA-256 digest verification for MCP server images

---

## Testing

```bash
npm test                                          # All 93 tests
npx vitest run src/anti-loop/__tests__/           # Anti-loop unit tests (13)
npx vitest run src/security/__tests__/            # Security + HITL tests (22)
npx vitest run src/schema/__tests__/              # Schema validation (4)
npx vitest run src/utils/__tests__/               # Retry/backoff tests (5)
npx vitest run src/__tests__/integration.test.ts  # Integration tests (34)
npx vitest run src/__tests__/e2e.test.ts          # E2E CLI tests (15)
```

---

## Cost Model

| Component | Type | Monthly Cost |
|-----------|------|-------------|
| Claude Code (Max 5x) | Fixed | $100 |
| Gemini 3.1 Pro | Variable | $50-60 |
| Gemini Flash-Lite | Variable | $1-3 |
| **Total (moderate)** | — | **$150-165** |

85-94% cheaper than all-Opus approaches via 3-tier model routing.

---

## Configuration

Key files:
- `.env` — API keys (GEMINI_API_KEY required)
- `config/openclaw-config.yaml` — Gateway, orchestrator, verifier, anti-loop settings
- `config/mcp-servers.yaml` — MCP server registry
- `config/required-caches.yaml` — Gemini cache definitions
- `security/rbac-config.md` — Per-node permissions
- `security/hitl-gates.md` — Human approval gate definitions

---

## License

MIT — use freely, adapt, extend. Attribution appreciated.
