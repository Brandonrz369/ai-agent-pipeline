---
name: ai-pipeline
description: "Run the AI Agent Pipeline — Gemini orchestrator + Claude Code executor with anti-loop safeguards. Use when: (1) running end-to-end task pipelines, (2) researching and decomposing complex tasks, (3) dispatching work to Claude Code sessions, (4) checking pipeline status or dead-letter queue. Requires Node.js and Claude CLI."
metadata:
  {
    "openclaw": { "emoji": "🔄", "requires": { "anyBins": ["claude", "tsx", "node"] } },
  }
---

# AI Agent Pipeline

Two-tier autonomous agent pipeline: **Gemini classifies/routes**, **Claude Code executes/thinks**.

## Architecture

```
User/Trigger → Gemini 3.1 Pro (classifier) → Claude Code (executor)
                    ↓                              ↓
              Route + Mode Select          EXECUTE / ARCHITECT / SUPERVISE
                    ↓                              ↓
              Anti-Loop Engine ←──── Flash-Lite Verifier
                    ↓
              PASS / RETRY / DEAD_LETTER
```

## Commands

All commands use the CLI at `/home/brans/ai-agent-pipeline/`:

```bash
# Full pipeline: research → decompose → dispatch → completion loop
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts run 'Your task prompt here'"

# Individual phases
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts research 'Your research question'"
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts decompose research-output.json"
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts dispatch tasks.json"

# Validation and monitoring
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts validate task-envelope.json"
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts status"
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts dead-letter list"
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts dead-letter retry <task-id>"

# Start webhook server (receives triggers from N8n, Discord, etc.)
bash workdir:/home/brans/ai-agent-pipeline command:"npx tsx src/cli.ts serve"
```

## Three Claude Code Modes

| Mode | Tools | Use Case |
|------|-------|----------|
| EXECUTE | Full (bash, read, write, edit) | Building, coding, file manipulation |
| ARCHITECT | Read-only (read, glob, grep) | Analysis, planning, code review |
| SUPERVISE | Computer Use + vision | GUI automation, visual verification |

## Anti-Loop Safeguards

- **TTL:** Max 10 hops per task (prevents infinite retry)
- **Hysteresis:** 3 consecutive failures → escalate to ARCHITECT mode; 2 successes → back to EXECUTE
- **Backflow Detection:** SHA-256 file hashing detects if executor undoes previous work
- **Dead-Letter Queue:** Tasks that exceed TTL or fail hysteresis are shelved for human review

## Brain Context MCP

Long sessions get context-compressed every ~5 actions via Gemini Flash-Lite to prevent "brain damage" (context window overflow). Uses MCP server at `src/mcp-servers/brain-context/`.

## Environment

Required env vars in `/home/brans/ai-agent-pipeline/.env`:
- `GEMINI_API_KEY` — Gemini API access
- `PIPELINE_DIR` — Pipeline root directory (defaults to cwd)

## Integration with OpenClaw

The pipeline registers as an OpenClaw skill so it can be triggered via:
- Discord commands
- Cron jobs (`openclaw cron add --every "90m" --message "pipeline cache refresh"`)
- Direct agent invocation (`openclaw agent -m "Run pipeline for: <task>"`)
- Webhook triggers via N8n workflows

## Rules

1. **Always use workdir** — point to `/home/brans/ai-agent-pipeline/`
2. **Check status first** — run `pipeline status` before starting new tasks
3. **Monitor dead-letter** — check for stuck tasks after pipeline runs
4. **Don't bypass anti-loop** — let the safeguards do their job
5. **Use pty:true for Claude Code** — coding agents need a terminal
