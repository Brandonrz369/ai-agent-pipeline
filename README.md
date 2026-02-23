# Autonomous AI Agent Pipeline
## Strategic Orchestration of Multi-Agent Systems for Complex Execution Workflows
## Version 1.0 — February 2026

---

> **Derived from**: GTG-1002 attack pattern research (Anthropic, Nov 2025) + Project Titan
> legal defense multi-agent execution + 2026 enterprise AI engineering best practices.
> This is the generalized, reusable version of those architectures.

---

## What This Is

A complete blueprint and implementation framework for orchestrating multiple AI agents
to execute complex, multi-front workflows that exceed the capability of any single agent.

**The core problem this solves:**
Any task complex enough to require deep research, parallel workstreams, quality control,
and iterative refinement will break a single AI agent — through context limits, hallucination
cascade, or the inability to hold conflicting sub-strategies simultaneously.

**The solution:**
A Hub-and-Spoke Blackboard architecture where specialized agents each hold narrow context,
communicate through structured files, query a shared memory layer (Gemini/LLM cache), and
are coordinated by an Orchestrator that reads summaries — never raw data.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PIPELINE OVERVIEW                           │
│                                                                 │
│  PHASE 1: DEEP RESEARCH                                         │
│  Senior prompt → Deep Research API → Comprehensive spec         │
│                                                                 │
│  PHASE 2: SCHEMA DECOMPOSITION                                  │
│  Spec → JSON task blueprint → Machine-executable contracts      │
│                                                                 │
│  PHASE 3: N8N ORCHESTRATION                                     │
│  Fan-Out → Parallel agent swarm → Fan-In gate                  │
│                                                                 │
│  PHASE 4: INTENT-BASED MODEL ROUTING (Portkey/Gateway)         │
│  Task type → Tier 1/2/3 model selection → Cost optimization    │
│                                                                 │
│  PHASE 5: MCP EXECUTION                                         │
│  TypeScript wrappers → Tool calls → Structured results         │
│                                                                 │
│  PHASE 6: SECURITY & GOVERNANCE                                 │
│  Sandboxing → RBAC → HITL gates → Audit trail                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Repo Structure

```
ai-agent-pipeline/
├── README.md                    ← This file (start here)
├── ARCHITECTURE.md              ← Full technical blueprint (Phases 1-7)
├── GTG1002_ANALYSIS.md          ← Verified attack pattern research + lessons
├── STRATEGY.md                  ← Crash recovery & execution log
├── docs/
│   ├── phase1-deep-research.md
│   ├── phase2-schema-decomposition.md
│   ├── phase3-n8n-orchestration.md
│   ├── phase4-model-routing.md
│   ├── phase5-mcp-execution.md
│   ├── phase6-security.md
│   ├── openclaw-gateway.md      ← V3: OpenClaw gateway & mobile ingress
│   ├── prompt-modes.md          ← V3: EXECUTE/ARCHITECT/SUPERVISE modes
│   ├── completion-loop.md       ← V3: Inner task execution loop
│   ├── computer-use.md          ← V3: Computer Use / SUPERVISE mode
│   ├── anti-loop-safeguards.md  ← V3: TTL, hysteresis, dead-letter queue
│   └── mobile-access.md         ← V3: Mobile & remote access + cost model
├── schemas/
│   ├── task-blueprint.schema.json    ← JSON Schema for task contracts (+ envelope extension)
│   ├── task-envelope.schema.json     ← V3: Anti-loop task envelope schema
│   ├── report.schema.json            ← JSON Schema for agent reports
│   └── routing-config.schema.json    ← Model routing configuration
├── workflows/
│   ├── n8n-fanout-fanin.json        ← N8n workflow export (parallel execution)
│   ├── n8n-delegation-chain.json    ← N8n automated handoff workflow
│   ├── n8n-cache-monitor.json       ← N8n cache expiry alerting
│   └── n8n-audit-trail.json         ← N8n git commit automation
├── templates/
│   ├── orchestrator-prompt.md       ← System prompt template for Hub agent
│   ├── worker-prompt.md             ← System prompt template for worker nodes
│   ├── redteam-prompt.md            ← System prompt for Red Team / critic agent
│   ├── task-file.md                 ← Task dispatch file template (+ envelope section)
│   ├── execute-prompt.md            ← V3: EXECUTE mode prompt (full tools)
│   ├── architect-prompt.md          ← V3: ARCHITECT mode prompt (read-only reasoning)
│   └── supervise-prompt.md          ← V3: SUPERVISE mode prompt (Computer Use)
├── config/
│   ├── required-caches.yaml         ← Gemini cache definitions (+ brain-context)
│   ├── openclaw-config.yaml         ← V3: OpenClaw gateway configuration
│   └── mcp-servers.yaml             ← V3: MCP server registry (+ gemini-cache)
├── scripts/
│   ├── rebuild-cache.sh             ← Cache rebuild script (+ brain-context)
│   └── refresh-cache.sh             ← Cache refresh script
└── security/
    ├── threat-model.md              ← Threats (+ retry storms, Computer Use risks)
    ├── rbac-config.md               ← Per-node permissions (+ Supervisor node)
    ├── hitl-gates.md                ← HITL gates (+ HITL-013, HITL-014 for Computer Use)
    └── approved-digests.yaml        ← MCP server image pinning
```

---

## Quick Start

### 1. Prerequisites

**Core (required):**
- Claude Code (claude-sonnet-4-6 or higher) — the brain/executor/supervisor
- Gemini MCP server (`@rlabs-inc/gemini-mcp`) — memory/cache layer
- N8n (local or VPS) — see docs/phase3-n8n-orchestration.md
- Git + GitHub CLI

**V3 Integration (recommended):**
- OpenClaw Gateway — always-on ingress for mobile/remote access
- Gemini 3.1 Pro API key — orchestrator model
- Tailscale — secure VPN for remote access (free tier)
- Happy Coder app (iOS/Android) — native mobile interface (optional)
- Telegram or Discord bot — for task dispatch and notifications (optional)

### 2. Start a session
```bash
# Open tmux with named panes
tmux new-session -s pipeline -n hub
tmux new-window -t pipeline -n worker1
tmux new-window -t pipeline -n worker2
tmux new-window -t pipeline -n worker3
tmux new-window -t pipeline -n redteam

# In hub pane:
claude  # This becomes Node 0 (Orchestrator)

# In each worker pane:
claude  # Worker nodes — paste system prompt from templates/worker-prompt.md
```

### 3. Initialize memory layer
```bash
# Combine your project's knowledge base into cache files
cat your-project-docs/*.md > /tmp/knowledge_base.txt

# Create Gemini cache via MCP
# gemini-create-cache filePath:/tmp/knowledge_base.txt displayName:project-kb ttlMinutes:120
```

### 4. Dispatch first batch
Node 0 generates JSON task contracts from schemas/task-blueprint.schema.json
and writes them to prompts/. Workers read and execute.

### Alternative: OpenClaw-Based Dispatch (V3)
If you have OpenClaw installed, you can skip tmux and dispatch from your phone:
```bash
# OpenClaw receives your message via Telegram/Discord/Happy Coder
# Gemini orchestrator decomposes the task
# Claude Code sessions are spawned automatically in the right prompt mode
# Results are sent back to your phone

# See docs/openclaw-gateway.md for full setup
# See config/openclaw-config.yaml for configuration
```

---

## The GTG-1002 Pattern (The Foundation)

This architecture is directly derived from the November 2025 Anthropic disclosure of
**GTG-1002**, a Chinese state-sponsored group that used Claude Code + MCP to conduct
autonomous cyber operations against ~30 enterprise targets with 80-90% AI autonomy.

**The key insight, inverted for legitimate use:**
- GTG-1002 used it for attack. We use it for complex knowledge work.
- The pattern works because of context isolation + structured handoffs + shared memory.
- See GTG1002_ANALYSIS.md for the full technical breakdown.

---

## Key Design Principles

1. **No single agent holds the whole picture** — context isolation prevents hallucination cascade
2. **Structured file communication** — agents never talk directly; all handoffs via files
3. **Orchestrator reads summaries, not raw data** — hub makes decisions, never discoveries
4. **Shared memory via LLM cache** — Gemini holds the knowledge base; agents query it
5. **Results only up the chain** — sub-agents summarize before passing to orchestrator
6. **Fan-Out for parallelism** — independent workstreams run simultaneously
7. **Fan-In before synthesis** — all branches complete before final assembly
8. **3-tier model routing** — cheap for iteration, mid-tier for parallel work, flagship for synthesis
9. **JSON task contracts** — schema-validated blueprints eliminate ambiguous prose prompts
10. **TypeScript wrappers** — reliable MCP tool execution via code, not raw JSON-RPC
11. **HITL on irreversible actions** — human approval gates for high-consequence operations
12. **Automated audit trail** — every agent action logged and git-committed
13. **Three prompt modes** — EXECUTE for full tools, ARCHITECT for read-only reasoning after failures, SUPERVISE for GUI tasks via Computer Use
14. **Anti-loop safeguards** — TTL-bounded task envelopes with hysteresis and backflow detection prevent infinite retry loops
15. **Brain damage prevention** — long-session context offloaded to Gemini MCP cache, keeping active context under ~50K tokens
16. **Always-on access** — OpenClaw Gateway enables mobile/Telegram/Discord dispatch to the pipeline from anywhere

---

## Validated Use Cases

| Domain | Orchestrator | Workers | Memory Layer |
|--------|-------------|---------|-------------|
| Legal defense (multi-front) | Claude Sonnet | 3 front agents + Red Team | Gemini (evidence manifest) |
| Software engineering | Claude Sonnet | Feature agents by module | Gemini (codebase index) |
| Research synthesis | Claude Opus | Domain specialist agents | Gemini (source documents) |
| Business intelligence | Claude Sonnet | Data agents by department | Gemini (company knowledge base) |
| Content production | Claude Haiku | Channel-specific writers | Gemini (brand guidelines) |

---

## License

MIT — use freely, adapt, extend. Attribution appreciated.
Inspired by: GTG-1002 (adversarial), Project Titan (legal defense), Anthropic MCP docs.
