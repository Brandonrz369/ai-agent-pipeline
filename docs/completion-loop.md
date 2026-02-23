# The Inner Completion Loop

**How individual tasks execute within the V3 two-tier orchestration -- the Gemini-driven
retry/escalation cycle that runs inside each N8n sub-workflow.**

The original pipeline (Phases 1-6) uses N8n for batch-level orchestration: fan-out tasks
to parallel workers, fan-in results, trigger the next phase. The V3 completion loop adds
a second layer: per-task execution quality management. N8n decides WHAT to run in parallel.
The completion loop decides HOW WELL each task runs.

---

## Table of Contents

1. [Two-Level Orchestration](#two-level-orchestration)
2. [Completion Loop Flow](#completion-loop-flow)
3. [Code Task Path](#code-task-path)
4. [GUI Task Path](#gui-task-path)
5. [Flash-Lite Verification](#flash-lite-verification)
6. [Anti-Loop Safeguards](#anti-loop-safeguards)
7. [Integration with N8n](#integration-with-n8n)
8. [Example Walkthrough](#example-walkthrough)
9. [Cross-References](#cross-references)

---

## Two-Level Orchestration

Understanding the two levels is essential to understanding the V3 architecture.

| Level | Engine | Scope | Manages |
|-------|--------|-------|---------|
| **OUTER LOOP** | N8n (Phase 3) | Batch of tasks | Fan-out, parallelism, dependencies, fan-in, HITL gates |
| **INNER LOOP** | Gemini completion loop (V3) | Single task | Execution quality, retries, mode switching, verification |

```
N8n OUTER LOOP (batch level)
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Fan-out gate                                           │
│    ├── Sub-workflow 1 ─┐                                │
│    ├── Sub-workflow 2  ├── Each runs INNER LOOP ──┐     │
│    ├── Sub-workflow 3  │                          │     │
│    └── Sub-workflow N ─┘                          │     │
│                                                   │     │
│  Fan-in gate <── collects results ────────────────┘     │
│    │                                                    │
│    v                                                    │
│  Next phase / final report                              │
│                                                         │
└─────────────────────────────────────────────────────────┘

Gemini INNER LOOP (per-task, inside each sub-workflow)
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Gemini classifies task                                 │
│    → Format prompt (EXECUTE / ARCHITECT / SUPERVISE)    │
│    → Claude Code executes                               │
│    → Flash-Lite verifies                                │
│    → PASS? Return result to N8n fan-in                  │
│    → FAIL? Retry with adjusted prompt (up to TTL)       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The key insight: **each N8n fan-out branch runs its own independent completion loop.**
Branch 1 can be on its 5th retry while Branch 3 already succeeded. They do not block
each other. The N8n fan-in gate simply waits until all branches resolve (success or
dead-letter).

---

## Completion Loop Flow

The complete decision tree for a task entering the completion loop:

```
TASK ENTERS (from N8n sub-workflow or direct OpenClaw dispatch)
  │
  ├─→ Gemini classifies: code task? GUI task? simple tool call?
  │
  ├─→ CODE TASK:
  │     [1] Gemini formats EXECUTE prompt
  │     [2] Claude Code executes, returns JSON result
  │     [3] Flash-Lite verifies result
  │     [4] PASS? → Summarize, return to N8n fan-in gate
  │     [5] RETRY? → Check anti-loop safeguards:
  │         ├─ hops >= ttl_max?    → Dead-letter, notify operator
  │         ├─ Backflow detected?  → Dead-letter, notify operator
  │         ├─ consecutive_failures < 3?
  │         │    → Gemini adjusts prompt, GOTO [1]
  │         └─ consecutive_failures >= 3?
  │              → Switch to ARCHITECT mode
  │              → Claude Code produces blueprint (read-only)
  │              → New EXECUTE session with blueprint as instructions
  │              → GOTO [1] with fresh session
  │     [6] ESCALATE? → Dead-letter immediately, notify operator
  │
  ├─→ GUI TASK:
  │     [1] Gemini formats SUPERVISE prompt
  │     [2] Claude Code enters Computer Use loop
  │     [3] Claude Code reports: done / stuck / error
  │     [4] Done?  → Flash-Lite verifies screenshot matches expected state
  │     [5] Stuck? → ARCHITECT prompt for new GUI approach
  │     [6] Error? → Check anti-loop safeguards, retry or dead-letter
  │
  └─→ SIMPLE TOOL CALL (no completion loop needed):
        [1] Gemini calls tool directly (e.g., file read, cache lookup)
        [2] Return result immediately
```

---

## Code Task Path

The most common path through the completion loop. Approximately 85% of tasks
in a typical pipeline are code tasks.

### Step 1: Gemini Formats EXECUTE Prompt

Gemini reads the task blueprint and populates the EXECUTE template:

```
Task blueprint (from schemas/task-blueprint.schema.json)
  + Codebase context (from previous hops or MCP cache)
  + Success criteria (from blueprint)
  + Tool permissions (EXECUTE mode defaults)
  → Populated EXECUTE prompt (templates/execute-prompt.md)
```

### Step 2: Claude Code Executes

Claude Code receives the populated prompt and executes using its permitted tools.
A new Claude Code session is started for each hop (fresh context, no stale reasoning).

Key behaviors during execution:
- Claude Code reads relevant files to understand current state
- Writes/edits code files to implement the task
- Runs tests or validation commands
- Returns structured JSON with status, artifacts, and test results

### Step 3: Flash-Lite Verifies

The JSON result is passed to Flash-Lite for independent verification.
See [Flash-Lite Verification](#flash-lite-verification) below.

### Step 4: Success Path

On PASS from Flash-Lite:
1. Gemini summarizes the result (compresses verbose output for storage/display)
2. Result is returned to the N8n fan-in gate (or directly to OpenClaw if not in a batch)
3. Task envelope is marked complete
4. `consecutive_successes` incremented (relevant for de-escalation after ARCHITECT mode)

### Step 5: Failure Path

On RETRY from Flash-Lite:
1. `hops` incremented in task envelope
2. `consecutive_failures` incremented
3. Anti-loop safeguards checked (TTL, backflow, hysteresis)
4. If safeguards allow retry: Gemini adjusts the prompt based on the failure
5. Adjustment strategies:
   - Include the specific error message in the new prompt
   - Narrow the task scope (break into smaller sub-steps)
   - Add explicit constraints ("do NOT use approach X, it failed because Y")
   - Provide additional context from MCP cache
6. New Claude Code session starts with adjusted prompt

### Architect Escalation

When `consecutive_failures >= 3`:
1. Gemini switches mode to ARCHITECT in the task envelope
2. `escalated` flag set to `true` (sticky)
3. ARCHITECT prompt includes all previous failure summaries
4. Claude Code runs in read-only mode, produces a blueprint
5. Blueprint becomes the INSTRUCTIONS for the next EXECUTE attempt
6. New EXECUTE session starts with the blueprint
7. If the blueprint-guided attempt succeeds twice: `escalated` cleared

---

## GUI Task Path

GUI tasks follow a different path using SUPERVISE mode and Computer Use.
See `docs/computer-use.md` for the full Computer Use specification.

### Step 1: Gemini Formats SUPERVISE Prompt

Gemini identifies the task as GUI-dependent and populates the SUPERVISE template:

```
Task description
  + Current desktop state description
  + Safety constraints (restricted URLs, payment page blocks)
  + Context offload reminder (every 5 steps)
  → Populated SUPERVISE prompt (templates/supervise-prompt.md)
```

### Step 2: Computer Use Loop

Claude Code enters the screenshot-analyze-act-verify loop:

1. Takes screenshot, analyzes current state
2. Identifies next action (click, type, key press)
3. Executes action
4. Takes new screenshot, verifies action succeeded
5. Every 5 steps: offloads context to Gemini MCP cache
6. Continues until task complete or stuck

### Step 3: Completion or Stuck

- **Done:** Claude Code reports success with final screenshot. Flash-Lite verifies
  the screenshot matches the expected end state.
- **Stuck:** Claude Code reports inability to proceed. Gemini switches to ARCHITECT
  mode for a new approach to the GUI task.
- **Error:** Unexpected state (crash dialog, wrong application). Anti-loop safeguards
  apply normally.

---

## Flash-Lite Verification

Flash-Lite is Gemini's lightweight verification model. It runs after EVERY task
completion attempt, providing an independent quality check.

### What Flash-Lite Checks

| Check | Description |
|-------|-------------|
| Objective addressed | Does the output actually solve the stated task? |
| Obvious errors | Syntax errors, missing imports, broken references |
| Missing artifacts | Were all expected files created/modified? |
| Test results | If tests were run, did they pass? |
| Screenshot match (GUI) | Does the final screenshot match the expected state? |

### What Flash-Lite Does NOT Check

| Not Checked | Why |
|------------|-----|
| Code quality | Too subjective for a lightweight check; handled by Red Team review |
| Architecture decisions | Requires deep codebase understanding; not Flash-Lite's scope |
| Security vulnerabilities | Requires specialized analysis; handled by Phase 6 |
| Performance | Requires benchmarking; not a per-task verification concern |

### Flash-Lite vs. Red Team Review

These are complementary, not redundant:

| Aspect | Flash-Lite | Red Team (Phase 6) |
|--------|-----------|-------------------|
| Scope | Per-task, per-hop | Per-batch, post-hoc |
| Timing | After every execution attempt | After all tasks in a batch complete |
| Depth | Surface-level pass/fail | Deep adversarial review |
| Cost | ~$0.001/check | ~$0.05/review |
| Model | Gemini Flash-Lite | Configurable (often Gemini Pro or Claude) |
| Purpose | Drive retry loop | Catch systemic issues across tasks |

### Flash-Lite Return Values

| Value | Meaning | Completion Loop Action |
|-------|---------|----------------------|
| `PASS` | Task completed successfully | Return result, exit loop |
| `RETRY` | Task partially completed or has fixable issues | Retry with adjusted prompt |
| `ESCALATE` | Task fundamentally broken, cannot be fixed with retries | Dead-letter immediately |

### Cost Impact

At ~$0.001 per verification call, Flash-Lite adds negligible cost even at high
retry rates:

```
10 hops (worst case) * $0.001 = $0.01 per task
75 tasks/day * $0.01 = $0.75/day
30 days * $0.75 = $22.50/month (worst case, all tasks hitting TTL)
```

In practice, most tasks pass on the first or second attempt, so actual monthly
Flash-Lite cost is typically $1-3.

---

## Anti-Loop Safeguards

The completion loop includes three safeguards to prevent runaway execution.
For the full specification, see `docs/anti-loop-safeguards.md`.

### Summary

| Safeguard | Mechanism | Trigger |
|-----------|-----------|---------|
| **TTL** | Hop counter with maximum | `hops >= ttl_max` (default: 10) |
| **Hysteresis** | Consecutive failure counter | `consecutive_failures >= 3` triggers ARCHITECT |
| **Backflow** | File state hash comparison | Post-hop hash matches any previous hash |

All three safeguards are checked at the beginning of each retry decision. If any
safeguard triggers a dead-letter, the task is immediately removed from the
completion loop and written to `~/.openclaw/dead-letter/`.

---

## Integration with N8n

### Where the Completion Loop Runs

The completion loop runs **inside** each N8n sub-workflow. Specifically:

```
N8n workflow: workflows/n8n-fanout-fanin.json
  │
  ├── Fan-out gate
  │     │
  │     ├── Sub-workflow 1
  │     │     └── HTTP Request node → OpenClaw API → Completion loop
  │     │           └── Waits for completion loop to resolve
  │     │           └── Returns: success result OR dead-letter notice
  │     │
  │     ├── Sub-workflow 2
  │     │     └── (same pattern)
  │     │
  │     └── Sub-workflow N
  │           └── (same pattern)
  │
  ├── Fan-in gate (waits for all sub-workflows)
  │     └── Aggregates results
  │
  └── Post-processing (Red Team review, report generation)
```

### Key Integration Points

1. **Task dispatch:** N8n sub-workflow sends task blueprint to OpenClaw via HTTP request
2. **Completion loop:** OpenClaw + Gemini manage retries, mode switches, verification
3. **Result return:** Completion loop returns final result to N8n sub-workflow
4. **Dead-letter:** If TTL exceeded, dead-letter notice returned instead of result
5. **Fan-in:** N8n fan-in gate collects all results (successes + dead-letters)

### Independent Retry

Each fan-out branch retries independently:

```
Branch 1: Task A → EXECUTE → PASS (1 hop)           ──→ Fan-in
Branch 2: Task B → EXECUTE → RETRY → RETRY → PASS    ──→ Fan-in
Branch 3: Task C → EXECUTE → RETRY x3 → ARCHITECT     ──→ Fan-in
                   → EXECUTE (blueprint) → PASS
Branch 4: Task D → EXECUTE → RETRY x10 → DEAD-LETTER ──→ Fan-in
```

Branch 1 does not wait for Branch 4's retries. The fan-in gate waits for all
branches to resolve (either success or dead-letter), then proceeds.

---

## Example Walkthrough

A concrete example: refactoring an API endpoint.

### Task

"Refactor the `/api/users` endpoint to use the new pagination middleware."

### Hop 1: EXECUTE (Success Path)

```
Gemini: Classify → code task
Gemini: Format EXECUTE prompt with task + codebase context
Claude Code: Reads src/routes/users.ts, src/middleware/pagination.ts
Claude Code: Edits src/routes/users.ts to use pagination middleware
Claude Code: Runs npm test → 2 failures
Claude Code: Fixes test expectations
Claude Code: Runs npm test → all pass
Claude Code: Returns JSON { status: "PASS", ... }
Flash-Lite: Verifies → PASS
Gemini: Summarize → return to N8n fan-in
```

Total: 1 hop, ~$0.05 (Claude Code session + Flash-Lite check)

### Hop 1-4: EXECUTE with Failures, Then ARCHITECT

```
Hop 1: EXECUTE → npm test fails, 3 errors → Flash-Lite: RETRY
  consecutive_failures: 1

Hop 2: EXECUTE (adjusted prompt includes error) → different error → RETRY
  consecutive_failures: 2

Hop 3: EXECUTE (narrowed scope) → same error as hop 1 → RETRY
  consecutive_failures: 3 → HYSTERESIS TRIGGERED

Hop 4: ARCHITECT mode
  Claude Code: Reads files (read-only), identifies root cause
  Claude Code: Returns blueprint with 5 steps
  Blueprint: "The pagination middleware expects query params, but
             /api/users passes them as route params..."

Hop 5: EXECUTE with blueprint as instructions
  Claude Code: Follows blueprint step by step
  Claude Code: Fixes param passing, updates tests
  Claude Code: npm test → all pass → PASS
  consecutive_successes: 1

Hop 6: (next task also succeeds)
  consecutive_successes: 2 → DE-ESCALATE (escalated = false)
```

Total: 6 hops, ~$0.30 (5 Claude sessions + 1 Architect + 6 Flash-Lite checks)

---

## Cross-References

| Document | Relevance |
|----------|-----------|
| `docs/openclaw-gateway.md` | How tasks enter the completion loop |
| `docs/prompt-modes.md` | The three prompt modes used within the loop |
| `docs/anti-loop-safeguards.md` | Full specification of TTL, hysteresis, backflow |
| `docs/computer-use.md` | GUI task path and Computer Use details |
| `docs/phase3-n8n-orchestration.md` | N8n outer loop that wraps the completion loop |
| `docs/phase4-model-routing.md` | Model selection complementing the completion loop |
| `schemas/task-envelope.schema.json` | Task envelope tracking loop state |
| `schemas/task-blueprint.schema.json` | Task blueprint format consumed by the loop |
| `workflows/n8n-fanout-fanin.json` | N8n workflow that dispatches to the completion loop |
