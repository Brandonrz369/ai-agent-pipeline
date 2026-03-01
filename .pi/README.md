# .pi — Pipeline Internal State

Runtime state directory for the autonomous AI agent pipeline. Holds ephemeral
orchestration artifacts that are machine-local and should not be committed to
version control.

## Purpose

`.pi/` stores internal pipeline state that doesn't belong in the other runtime
directories:

| Directory | Scope | `.pi/` differs because... |
|-----------|-------|---------------------------|
| `.collab/` | Multi-agent coordination (NEXUS, ALPHA, BRAVO, CHARLIE) | `.pi/` is for the pipeline engine itself, not agent-to-agent communication |
| `.openclaw/` | Gateway ingress state (Telegram, Discord, browser) | `.pi/` is for internal orchestration, not external-facing gateway state |
| `.pipeline-run/` | Active batch execution (tasks.json, results.json) | `.pi/` is for cross-run persistent state, not single-batch artifacts |
| `.claude/` | Claude Code session permissions (settings.json) | `.pi/` is for runtime data, not static configuration |

**In short:** `.pi/` is where the orchestration engine tracks its own operational
state across pipeline runs — things like run history, orchestrator checkpoints,
and internal bookkeeping.

## Intended Components

The following components are planned for this directory as the pipeline matures:

```
.pi/
├── README.md              # This file
├── run-history.json       # Log of completed pipeline runs (task IDs, status, timestamps)
├── orchestrator-state.json# Gemini orchestrator checkpoint (last mode, hop count, state hashes)
├── cache-manifest.json    # Gemini context cache inventory (cache names, TTLs, content refs)
├── dlq-index.json         # Dead-letter queue index for cross-run DLQ persistence
└── metrics/               # Performance telemetry snapshots (T41 benchmarking output)
    └── latest.json
```

### Component Descriptions

**run-history.json** — Append-only log of pipeline runs. Each entry records the
task batch, start/end timestamps, per-task status (PASS/FAIL/PARTIAL/BLOCKED),
and the final state hash. Used by the orchestrator to detect recurring failures
and inform routing decisions.

**orchestrator-state.json** — Checkpoint for the Gemini completion loop. Captures
the current prompt mode (EXECUTE/ARCHITECT/SUPERVISE), hysteresis counters,
and the state hash chain. Enables crash recovery: if the pipeline restarts
mid-run, it can resume from the last checkpoint instead of replaying from scratch.

**cache-manifest.json** — Inventory of active Gemini context caches created via
the MCP gemini-create-cache tool. Tracks cache names, display names, TTLs,
and the source files they were built from. Prevents duplicate cache creation
and enables cache rotation.

**dlq-index.json** — Cross-run index of dead-lettered tasks. While individual
DLQ entries live in src/anti-loop/, this index provides a persistent view
across pipeline restarts for the dead-letter list CLI command.

**metrics/** — Output directory for the automated performance benchmarking suite
(T41). Stores latency percentiles, throughput measurements, and resource
utilization snapshots.

## File Conventions

Follow the established project patterns:

| Format | Use for | Examples in project |
|--------|---------|---------------------|
| JSON | Structured state, task data, results | `.openclaw/workspace-state.json`, `.pipeline-run/tasks.json` |
| Markdown | Human-readable docs, logs | `.collab/PROTOCOL.md`, `reports/*.md` |
| YAML | Configuration (read-only at runtime) | `config/openclaw-config.yaml` |

### Naming

- Use kebab-case for filenames (e.g., run-history.json, not runHistory.json)
- Suffix state files with their format (.json, .md)
- Prefix temporary/scratch files with _ (e.g., _scratch.json) — these are
  safe to delete at any time

### Schema

State files should be validated against JSON schemas when practical. Place
schemas in schemas/ following the existing pattern (see schemas/task-blueprint.schema.json).

## Task Blueprint Reference

When .pi/ state files reference tasks, they use the standard task blueprint
format enforced by src/schema/:

```json
{
  "task_id": "AUTO-2026-001",
  "metadata": {
    "project": "ai-agent-pipeline",
    "node": 1,
    "workstream": "content",
    "batch": 7,
    "priority": "P3",
    "tier": 2
  }
}
```

Task IDs follow the pattern: PREFIX-TIMESTAMP-B[batch]-N[node] for
auto-generated tasks, or AUTO-YYYY-NNN for pipeline-internal tasks.

## Security

- **No secrets.** Never store API keys, tokens, or credentials in .pi/.
  Use .env and environment variables per project convention.
- **No PII.** State files should reference task IDs and file paths, not
  user-identifiable data.
- **RBAC applies.** The pipeline's RBAC system (security/rbac-config.md)
  governs read/write access. Agents need explicit .pi in their write_scope
  to modify files here.

## Git Status

This directory is **ephemeral** and should be added to .gitignore. Contents
are machine-local runtime state that varies between environments.

```gitignore
# Pipeline internal state (ephemeral)
.pi/
```

## Parent Project

This directory lives inside [ai-agent-pipeline/](../README.md), a two-tier
autonomous multi-agent orchestration framework (Gemini orchestrator + Claude
Code executor). See [ARCHITECTURE.md](../ARCHITECTURE.md) for the full system
design.
