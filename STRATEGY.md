# STRATEGY.md — Pipeline Blackboard & Crash Recovery
## Project: ai-agent-pipeline (self-build)
## Started: 2026-02-22
## Orchestrator: Claude Opus 4.6 (single-session, subagent workers)

---

## MISSION
Use the pipeline architecture to build out its own repo — fill every empty directory with production-quality content. "The pipeline eating its own tail."

## EXECUTION MODE
- **Single-session**: Orchestrator (this session) dispatches to Task subagents as simulated worker nodes
- **Gemini cache**: `pipeline-kb` (TTL 120min, expires ~2026-02-23T01:22Z)
- **Crash recovery**: Resume from the last completed batch below

---

## BATCH 1 — Foundation Files (6 tasks, parallel-safe)

| Task ID | Node | Workstream | Deliverable(s) | Tier | Status |
|---------|------|-----------|-----------------|------|--------|
| PIPE-2026-001-B1-N1 | N1 | docs | `docs/phase1-deep-research.md` through `docs/phase6-security.md` (6 files) | 2 | **PASS** |
| PIPE-2026-001-B1-N2 | N2 | schemas | `schemas/report.schema.json` + `schemas/routing-config.schema.json` | 2 | **PASS** |
| PIPE-2026-001-B1-N3 | N3 | templates | `templates/redteam-prompt.md` + `templates/task-file.md` | 2 | **PASS** |
| PIPE-2026-001-B1-N4 | N4 | security | `security/threat-model.md` + `security/rbac-config.md` + `security/hitl-gates.md` | 2 | **PASS** |
| PIPE-2026-001-B1-N5 | N5 | workflows | `workflows/n8n-fanout-fanin.json` + 3 more N8n exports | 2 | **PASS** |
| PIPE-2026-001-B1-N6 | N6 | repo | `.gitignore` + `LICENSE` (MIT) | 1 | **PASS** |

## BATCH 1 CROSS-STREAM ALERTS (for Red Team)
- N2: report.schema.json enforces `blocked_on` required when status=BLOCKED (stricter than prose spec)
- N5: Workflow E (HITL Gate with Discord reactions) out of scope — needs Discord API, not just webhooks
- N5: Cache monitor calls `scripts/rebuild-cache.sh` which doesn't exist yet
- N5: Workflows parse reports expecting `## Status:`, `## Task ID:`, `### CHANGES MADE` headers
- N4: Identified 4 new issues: CRITICAL gate override gap, cache write access ambiguity, audit log rotation, missing approved-digests inventory
- N1: Docs reference files that other nodes created (cross-refs should now resolve)
- N3: Red Team prompt has deterministic verdict rules (0 CRITICAL + 0 MAJOR = APPROVE)

## BATCH 1 STATS
- Total files created: 21 (6 docs + 2 schemas + 2 templates + 3 security + 4 workflows + 2 repo + 6 reports - 4 existed)
- Total lines written: ~6,000+
- Execution time: ~13 minutes (all 6 workers parallel)
- Gemini cache: pipeline-kb (expires ~2026-02-23T01:22Z)

## BATCH 2 — Integration & QA (after Batch 1)

| Task ID | Node | Workstream | Deliverable(s) | Tier | Status |
|---------|------|-----------|-----------------|------|--------|
| PIPE-2026-001-B2-N5 | Red Team | review | Review all Batch 1 outputs for consistency, accuracy, cross-references | 3 | **CONDITIONAL** |
| PIPE-2026-001-B2-N1 | N1 | repo | JSON validation of all 8 JSON files | 1 | **PASS (8/8)** |
| PIPE-2026-001-B2-FIX | Orch | fixes | Fix 5 major issues from Red Team review | 2 | **PASS** |

### Batch 2 Fixes Applied (Red Team Major Issues)
1. ARCHITECTURE.md: aligned report `required_fields` to match report.schema.json (`changes_made`, `new_issues`)
2. ARCHITECTURE.md: removed ghost field `narrative_check` from example
3. docs/phase3: added "Not Yet Implemented" note for Workflow E (HITL Gate)
4. docs/phase6: removed `deploy/` from `file_destinations` to match ARCHITECTURE.md
5. worker-prompt.md: standardized CHANGES MADE format to backtick-wrapped paths
6. ARCHITECTURE.md: routing function returns integers (1/2/3) to match schema

---

## CRASH RECOVERY PROTOCOL

If this session dies:
1. Open new Claude Code session in `/home/brandon/ai-agent-pipeline/`
2. Read this file (`STRATEGY.md`) — check the status column above
3. Recreate Gemini cache: `gemini-create-cache filePath:/tmp/pipeline_kb.txt displayName:pipeline-kb ttlMinutes:120`
   - If /tmp is gone: `cat README.md ARCHITECTURE.md GTG1002_ANALYSIS.md > /tmp/pipeline_kb.txt` first
4. Check `reports/` for any completed worker reports
5. Resume from first PENDING task in the batch

## DECISIONS LOG
- 2026-02-22: Single-session mode chosen over multi-tab (speed > architectural purity for first run)
- 2026-02-22: Batch 1 tasks are all parallel-safe (no inter-dependencies) — fan-out all 6
- 2026-02-22: N5 (workflows) needs N8n JSON format research before writing — Gemini search in-task
- 2026-02-22: Batch 1 ALL PASS, committed (fd9c3c9), Red Team CONDITIONAL, 5 fixes applied, committed (29b19ed), pushed to GitHub
- 2026-02-22: Remaining minor items tracked below for optional Batch 3
- 2026-02-22: Batch 3 ALL 11 minor fixes applied, committed, pushed. PROJECT COMPLETE.

---

## ARCHITECTURE NOTES FOR WORKERS

### What exists (read these, don't recreate):
- `README.md` — Project overview, repo structure, quick start, design principles
- `ARCHITECTURE.md` — Full 6-phase technical blueprint (THE primary source doc)
- `GTG1002_ANALYSIS.md` — Attack pattern research and lessons
- `schemas/task-blueprint.schema.json` — Task contract schema (validated, complete)
- `templates/orchestrator-prompt.md` — Hub agent system prompt
- `templates/worker-prompt.md` — Worker agent system prompt template

### What each worker produces:
- **N1 (docs)**: One markdown file per phase. Each should be a standalone deep-dive expanding on the corresponding ARCHITECTURE.md section. Include implementation examples, decision rationale, gotchas.
- **N2 (schemas)**: JSON Schema files matching the style of task-blueprint.schema.json. report.schema.json maps to the report format in worker-prompt.md. routing-config.schema.json maps to the 3-tier model routing in Phase 4.
- **N3 (templates)**: Markdown prompt templates matching the style of orchestrator-prompt.md and worker-prompt.md. redteam-prompt.md for the critic/QA agent. task-file.md is a dispatch template (not a prompt — it's the human-readable version of a task blueprint).
- **N4 (security)**: Expand Phase 6 of ARCHITECTURE.md into three focused documents. threat-model.md = full threat analysis. rbac-config.md = permission matrix with examples. hitl-gates.md = checkpoint definitions and approval flows.
- **N5 (workflows)**: Real N8n workflow JSON exports. Must be valid N8n format (research actual N8n export structure). 4 workflows matching the ones described in Phase 3.
- **N6 (repo)**: .gitignore for a Node.js/TypeScript + Python project with AI pipeline specifics. MIT LICENSE with 2026 date.
