# Anti-Loop Safeguards -- Bounded Termination Guarantees

**Every task must terminate. Escalation must be sticky. Cycles must be detected.
These three guarantees prevent the completion loop from running forever.**

Without safeguards, a retry loop is an infinite loop. An agent that fails and retries
the same approach indefinitely burns tokens, produces no useful output, and blocks
the pipeline. Anti-loop safeguards enforce bounded behavior: every task either succeeds
within a finite number of attempts or is dead-lettered for human review.

---

## Table of Contents

1. [The Three Laws of Agent Loops](#the-three-laws-of-agent-loops)
2. [Task Envelope](#task-envelope)
3. [TTL (Time-To-Live)](#ttl-time-to-live)
4. [Hysteresis (Escalation Damping)](#hysteresis-escalation-damping)
5. [Handshake / Backflow Detection](#handshake--backflow-detection)
6. [Dead-Letter Queue](#dead-letter-queue)
7. [Brain Damage Prevention (Context Offloading)](#brain-damage-prevention-context-offloading)
8. [Safeguard Interaction Matrix](#safeguard-interaction-matrix)
9. [Configuration Reference](#configuration-reference)
10. [Cross-References](#cross-references)

---

## The Three Laws of Agent Loops

These three laws are non-negotiable. The completion loop enforces all three on
every task, on every hop.

### Law 1: Every Task Must Terminate (TTL)

A task has a maximum number of hops (retry attempts). When the hop count reaches
the TTL maximum, the task is dead-lettered regardless of state. No exceptions.
No "just one more try." The counter is monotonically increasing and cannot be reset.

### Law 2: Escalation Must Be Sticky (Hysteresis)

When a task escalates from EXECUTE to ARCHITECT mode, the `escalated` flag is set
to `true` and remains `true` until the architect-guided approach proves itself with
consecutive successes. This prevents oscillation: a task that failed 3 times in
EXECUTE mode should not immediately return to unguided EXECUTE after one architect
blueprint. The sticky flag ensures the system remembers that this task needed help.

### Law 3: Cycles Must Be Detected (Backflow)

A task that produces the same file state as a previous hop is cycling without
progress. State hashes (SHA-256 of target files) are recorded at each hop boundary.
If a new hash matches any previous hash, the task is immediately dead-lettered.
This catches A-B-A patterns where an agent alternates between two approaches that
each undo the other's work.

---

## Task Envelope

The task envelope is the data structure that carries all safeguard state. It wraps
a task reference with TTL counters, mode tracking, and hash history.

### Schema

Full schema: `schemas/task-envelope.schema.json`

### Structure

```json
{
  "id": "task_abc123",
  "task_id_ref": "PROJ-2026-001-B01-N03",
  "ttl_max": 10,
  "hops": 0,
  "mode": "EXECUTE",
  "state_hashes": [],
  "consecutive_failures": 0,
  "consecutive_successes": 0,
  "escalated": false,
  "session_ids": [],
  "mcp_cache_key": "",
  "dead_letter_path": "~/.openclaw/dead-letter/",
  "created_at": "2026-02-23T10:00:00Z",
  "last_hop_at": "2026-02-23T10:00:00Z"
}
```

### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | (required) | Unique envelope ID |
| `task_id_ref` | string | (optional) | Reference to task blueprint ID |
| `ttl_max` | integer | 10 | Maximum hops before dead-letter |
| `hops` | integer | 0 | Current hop count (monotonically increasing) |
| `mode` | enum | "EXECUTE" | Current prompt mode: EXECUTE, ARCHITECT, SUPERVISE |
| `state_hashes` | string[] | [] | SHA-256 hashes of file state at each hop boundary |
| `consecutive_failures` | integer | 0 | Failure streak counter (resets on success) |
| `consecutive_successes` | integer | 0 | Success streak counter (resets on failure) |
| `escalated` | boolean | false | Sticky flag: true once ARCHITECT mode triggered |
| `session_ids` | string[] | [] | All Claude Code session IDs used |
| `mcp_cache_key` | string | "" | Key for context in Gemini MCP cache |
| `dead_letter_path` | string | ~/.openclaw/dead-letter/ | Directory for expired envelopes |
| `created_at` | datetime | (auto) | ISO 8601 envelope creation timestamp |
| `last_hop_at` | datetime | (auto) | ISO 8601 timestamp of most recent hop |

### Envelope Lifecycle

```
Task arrives
  │
  ├─ [CREATE] New envelope with defaults
  │   hops=0, mode=EXECUTE, escalated=false
  │
  ├─ [HOP] Each execution attempt:
  │   ├─ hops++
  │   ├─ last_hop_at = now()
  │   ├─ session_ids.push(new_session_id)
  │   ├─ state_hashes.push(sha256(target_files))
  │   └─ Check all three safeguards
  │
  ├─ [SUCCESS] Result is PASS:
  │   ├─ consecutive_failures = 0
  │   ├─ consecutive_successes++
  │   ├─ If consecutive_successes >= 2 AND escalated:
  │   │     escalated = false (de-escalate)
  │   └─ Return result
  │
  ├─ [FAILURE] Result is RETRY:
  │   ├─ consecutive_successes = 0
  │   ├─ consecutive_failures++
  │   ├─ If consecutive_failures >= 3:
  │   │     mode = ARCHITECT
  │   │     escalated = true
  │   └─ Loop back to [HOP]
  │
  └─ [DEAD-LETTER] Safeguard triggered:
      ├─ Write envelope to dead_letter_path
      ├─ Include last error and all session logs
      └─ Notify operator
```

---

## TTL (Time-To-Live)

### How It Works

Every task envelope has a `ttl_max` field (default: 10) and a `hops` counter
(starts at 0). Each retry increments `hops` by 1. When `hops >= ttl_max`, the
task is dead-lettered immediately. The hop counter is monotonically increasing --
it never decrements, even on success.

### Why 10 Hops

The default of 10 hops accommodates the worst-case productive path:

```
Hop  1: EXECUTE attempt 1 → RETRY
Hop  2: EXECUTE attempt 2 → RETRY
Hop  3: EXECUTE attempt 3 → RETRY (hysteresis triggered)
Hop  4: ARCHITECT analysis → produces blueprint
Hop  5: EXECUTE with blueprint, attempt 1 → RETRY
Hop  6: EXECUTE with blueprint, attempt 2 → RETRY
Hop  7: EXECUTE with blueprint, attempt 3 → RETRY (second escalation)
Hop  8: ARCHITECT analysis 2 → produces revised blueprint
Hop  9: EXECUTE with revised blueprint → RETRY
Hop 10: DEAD-LETTER (TTL exceeded)
```

This gives the system two full ARCHITECT cycles. If two independent architect
analyses cannot solve the problem, additional automated attempts are unlikely
to succeed. Human review is needed.

### Configuration

```yaml
# In config/openclaw-config.yaml
task_envelope:
  ttl_max: 10  # Adjust per use case. Range: 1-50.
```

For simple, well-defined tasks, a lower TTL (e.g., 5) saves tokens on hopeless
retries. For complex, exploratory tasks, a higher TTL (e.g., 20) gives the system
more room to find a solution.

### TTL and Cost

Each hop costs approximately $0.03-0.10 (Claude Code session + Flash-Lite check).
At TTL=10, the maximum cost per task is ~$1.00. At TTL=20, it's ~$2.00. These
are worst-case figures; most tasks resolve in 1-3 hops ($0.03-0.30).

---

## Hysteresis (Escalation Damping)

### The Problem: Mode Oscillation

Without hysteresis, a naive system might:

```
Attempt 1: EXECUTE → fail → switch to ARCHITECT
Attempt 2: ARCHITECT → blueprint → switch to EXECUTE
Attempt 3: EXECUTE → fail → switch to ARCHITECT  (same error!)
Attempt 4: ARCHITECT → same blueprint → switch to EXECUTE
... (infinite oscillation)
```

This burns hops without making progress. The agent alternates between "try again"
and "plan again" without either mode building on the other's output.

### The Solution: Sticky Escalation with Thresholds

Hysteresis introduces two thresholds and a sticky flag:

| Parameter | Value | Effect |
|-----------|-------|--------|
| `consecutive_failures` threshold | 3 | Number of consecutive EXECUTE failures before ARCHITECT |
| `consecutive_successes` threshold | 2 | Number of consecutive successes (after ARCHITECT) before de-escalation |
| `escalated` flag | boolean | Once true, stays true until de-escalation threshold met |

### How It Works

**Escalation (EXECUTE -> ARCHITECT):**

```
EXECUTE attempt → FAIL
  consecutive_failures = 1 (< 3) → retry in EXECUTE

EXECUTE attempt → FAIL
  consecutive_failures = 2 (< 3) → retry in EXECUTE

EXECUTE attempt → FAIL
  consecutive_failures = 3 (>= 3) → ESCALATE
    mode = ARCHITECT
    escalated = true
```

**De-escalation (back to unguided EXECUTE):**

```
ARCHITECT → produces blueprint
EXECUTE (with blueprint) → SUCCESS
  consecutive_failures = 0
  consecutive_successes = 1 (< 2) → continue, escalated still true

EXECUTE (next task or next step) → SUCCESS
  consecutive_successes = 2 (>= 2) → DE-ESCALATE
    escalated = false
```

**Why 2 consecutive successes for de-escalation:**

A single success might be a fluke (the task was easier, not that the approach is
better). Two consecutive successes indicate the architect blueprint actually fixed
the underlying problem. Only then is it safe to return to unguided EXECUTE mode.

### Counter Reset Rules

| Event | consecutive_failures | consecutive_successes |
|-------|---------------------|----------------------|
| Any SUCCESS | Reset to 0 | Increment by 1 |
| Any FAILURE | Increment by 1 | Reset to 0 |

This means a single failure breaks a success streak, and a single success breaks
a failure streak. The counters measure the current streak, not a running total.

---

## Handshake / Backflow Detection

### The Problem: A-B-A Cycles

Some failure modes produce cycles:

```
Hop 1: Agent adds dependency X to fix import error
  → Tests fail: X conflicts with existing dependency Y

Hop 2: Agent removes X, adds Y instead
  → Tests fail: original import error returns

Hop 3: Agent adds X again (same as Hop 1)
  → Tests fail: same conflict as Hop 1

... (A-B-A cycle, no progress)
```

The TTL will eventually kill this task, but it wastes hops first. Backflow
detection catches this pattern early.

### How It Works

1. **Before each hop:** Hash the target files (SHA-256)
   - Target files = files the task is expected to modify
   - Hash = SHA-256 of concatenated file contents
   - Push hash to `state_hashes[]` in the task envelope

2. **After each hop:** Hash the target files again
   - Compare the new hash against ALL previous hashes in `state_hashes[]`

3. **If the new hash matches any previous hash:** Backflow detected
   - The file state has returned to a previous state
   - The agent is cycling without making progress
   - Immediately dead-letter the task

### Implementation

```
Before hop N:
  pre_hash = sha256(read(target_files))
  state_hashes.push(pre_hash)

Claude Code executes...

After hop N:
  post_hash = sha256(read(target_files))

  for each previous_hash in state_hashes:
    if post_hash == previous_hash:
      → BACKFLOW DETECTED
      → Dead-letter immediately
      → Reason: "A-B-A cycle detected at hop N.
                  Post-execution state matches hop M."

  state_hashes.push(post_hash)
```

### What Gets Hashed

The "target files" are determined by the task blueprint:

- If the task specifies output files: hash those files
- If the task modifies existing files: hash the modified files
- If no specific files are identified: hash the entire working directory tree

Hashing the entire directory is expensive, so the task blueprint should specify
target files whenever possible.

### Limitations

Backflow detection catches exact state matches. It does NOT catch:
- Near-identical states (one character different)
- Semantic cycles (different code that produces the same bug)
- Multi-file cycles (file A returns to original, file B changes)

For these cases, the TTL provides the backstop termination guarantee.

---

## Dead-Letter Queue

When any safeguard triggers (TTL exceeded, backflow detected) or Flash-Lite returns
ESCALATE, the task is dead-lettered.

### Location

```
~/.openclaw/dead-letter/{envelope_id}.json
```

### Dead-Letter Record Contents

```json
{
  "envelope": {
    "id": "task_abc123",
    "task_id_ref": "PROJ-2026-001-B01-N03",
    "ttl_max": 10,
    "hops": 10,
    "mode": "EXECUTE",
    "state_hashes": ["a1b2c3...", "d4e5f6...", "a1b2c3..."],
    "consecutive_failures": 3,
    "consecutive_successes": 0,
    "escalated": true,
    "session_ids": ["sess_001", "sess_002", "..."],
    "mcp_cache_key": "task_abc123_context",
    "created_at": "2026-02-23T10:00:00Z",
    "last_hop_at": "2026-02-23T10:45:00Z"
  },
  "dead_letter_reason": "TTL_EXCEEDED",
  "last_error": "npm test: 2 failures in tests/auth/rate-limit.test.ts",
  "last_result": {
    "status": "RETRY",
    "error_summary": "Rate limit test expects Redis but test env has no Redis"
  },
  "session_logs": [
    "~/.openclaw/logs/sess_001.log",
    "~/.openclaw/logs/sess_002.log"
  ],
  "dead_lettered_at": "2026-02-23T10:45:00Z"
}
```

### Dead-Letter Reasons

| Reason | Trigger | Description |
|--------|---------|-------------|
| `TTL_EXCEEDED` | `hops >= ttl_max` | Ran out of retry attempts |
| `BACKFLOW_DETECTED` | Post-hop hash matches previous hash | Cycling without progress |
| `FLASH_LITE_ESCALATE` | Flash-Lite returned ESCALATE | Task fundamentally broken |
| `OPERATOR_EMERGENCY_STOP` | Operator sent STOP command | Manual intervention |
| `SESSION_TIMEOUT` | Claude Code session exceeded timeout | Execution hung |

### Operator Actions

When a dead-letter notification arrives, the operator can:

| Action | Command | Effect |
|--------|---------|--------|
| **Inspect** | `openclaw dead-letter inspect {id}` | View full dead-letter record |
| **Retry** | `openclaw dead-letter retry {id}` | Re-enter completion loop with fresh envelope |
| **Retry with params** | `openclaw dead-letter retry {id} --ttl 20 --hint "use ioredis"` | Retry with adjusted parameters |
| **Abandon** | `openclaw dead-letter abandon {id}` | Mark as permanently failed |
| **List** | `openclaw dead-letter list` | Show all pending dead-letters |

### Notifications

Dead-letter events are pushed to the operator via configured channels:

```yaml
# In config/openclaw-config.yaml
notifications:
  dead_letter:
    channels:
      - telegram
      - discord
    include_summary: true
    include_last_error: true
```

The notification includes:
- Task ID and description
- Dead-letter reason
- Last error message
- Number of hops consumed
- One-tap/click retry option (in supported channels)

---

## Brain Damage Prevention (Context Offloading)

### The Problem

Long-running Claude Code sessions accumulate context. After 20+ tool calls, the
context window contains:
- Original system prompt
- Task instructions
- Every file read (full content)
- Every command output
- Every screenshot (in SUPERVISE mode)
- All reasoning between steps

At ~100K tokens, Claude Code starts losing effective access to early context.
Instructions from the task prompt get "pushed out" by accumulated noise. The agent's
behavior degrades -- "brain damage."

### The Solution: Periodic Context Offloading

Every N steps (default: 5), the completion loop offloads accumulated context to
the Gemini MCP cache.

### Offload Protocol

```
Step 1-5: Claude Code executes normally, context grows
Step 5: Offload checkpoint

  Claude Code → store_context(key, {
    task_summary: "Implementing rate limiter",
    completed_actions: ["Read redis.ts", "Created rate-limit.ts", "Fixed imports",
                         "Updated tests", "Ran test suite"],
    current_state: "Tests passing but Flash-Lite flagged missing error handler",
    key_findings: ["Redis client is ioredis, not node-redis",
                    "Test env requires ioredis-mock >= 2.0"],
    remaining_work: ["Add error handler for Redis disconnect",
                      "Re-run Flash-Lite verification"],
    files_modified: ["src/middleware/rate-limit.ts", "tests/rate-limit.test.ts"]
  })

  Flash-Lite compresses → ~200 tokens:
  "Rate limiter impl using ioredis. Tests pass. Need error handler for
   Redis disconnect in rate-limit.ts. Files: rate-limit.ts, rate-limit.test.ts."

  Claude Code → get_summary(key) → receives compressed summary

  Claude Code continues with:
    - System prompt (always retained)
    - Current task instructions (always retained)
    - Compressed summary (200 tokens)
    - Current state only (recent file reads, last command output)
```

### Target Token Budget

| Component | Token Budget |
|-----------|-------------|
| System prompt | ~5,000 |
| Task instructions | ~2,000 |
| Compressed history | ~200-500 |
| Current state (recent reads, outputs) | ~20,000-40,000 |
| **Total target** | **~30,000-50,000** |

This keeps Claude Code well within effective attention range, even for tasks
that span 20+ hops.

### MCP Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `store_context(key, context)` | `key`: string, `context`: object | Send context to Gemini cache |
| `get_summary(key)` | `key`: string | Retrieve compressed summary |

### Configuration

```yaml
# In config/mcp-servers.yaml
servers:
  gemini-cache:
    command: "gemini-mcp-server"
    args: ["--mode", "cache"]
    env:
      GEMINI_API_KEY: "${GEMINI_API_KEY}"
    tools:
      - store_context
      - get_summary
    config:
      offload_interval: 5
      max_context_tokens: 50000
      compression_target: 200
      compression_model: "gemini-flash-lite"
```

---

## Safeguard Interaction Matrix

The three safeguards operate independently but interact at decision points:

```
After each hop, Gemini checks ALL safeguards in order:

  [1] TTL CHECK: hops >= ttl_max?
      YES → Dead-letter (TTL_EXCEEDED)
      NO  → Continue to [2]

  [2] BACKFLOW CHECK: post_hash matches any state_hashes[]?
      YES → Dead-letter (BACKFLOW_DETECTED)
      NO  → Continue to [3]

  [3] HYSTERESIS CHECK: consecutive_failures >= 3?
      YES → Switch to ARCHITECT mode, set escalated=true
      NO  → Continue in current mode

  [4] RESULT CHECK: Flash-Lite returned ESCALATE?
      YES → Dead-letter (FLASH_LITE_ESCALATE)
      NO  → Retry (RETRY) or return (PASS)
```

### Priority Order

TTL and backflow take precedence over hysteresis. If a task hits TTL=10 at the same
time hysteresis would trigger ARCHITECT mode, the task is dead-lettered, not escalated.
There is no point escalating a task that has exhausted its hop budget.

### Independence

Each fan-out branch in the N8n outer loop maintains its own task envelope with its
own safeguard state. Branch 1's failure count does not affect Branch 2's hysteresis.
This ensures that one struggling task does not contaminate the execution of other tasks.

---

## Configuration Reference

All safeguard parameters are configurable in `config/openclaw-config.yaml`:

```yaml
# Task envelope defaults
task_envelope:
  ttl_max: 10                      # Max hops per task (1-50)
  hysteresis_fail_threshold: 3     # Consecutive failures to trigger ARCHITECT
  hysteresis_success_threshold: 2  # Consecutive successes to de-escalate
  dead_letter_path: "~/.openclaw/dead-letter/"

# Brain damage prevention
context_offload:
  enabled: true
  interval: 5                      # Steps between offloads
  max_context_tokens: 50000        # Target ceiling
  compression_target: 200          # Compressed summary token target

# Notifications
notifications:
  dead_letter:
    channels:
      - telegram
      - discord
    include_summary: true
    include_last_error: true
```

---

## Cross-References

| Document | Relevance |
|----------|-----------|
| `docs/completion-loop.md` | The loop that these safeguards protect |
| `docs/prompt-modes.md` | Mode transitions governed by hysteresis |
| `docs/openclaw-gateway.md` | Dead-letter notifications delivered through OpenClaw |
| `docs/computer-use.md` | SUPERVISE mode safeguards (stuck detection) |
| `docs/phase3-n8n-orchestration.md` | Outer loop independence (per-branch safeguards) |
| `schemas/task-envelope.schema.json` | Full schema for the task envelope |
| `config/openclaw-config.yaml` | Safeguard configuration |
| `config/mcp-servers.yaml` | Gemini MCP cache configuration for context offloading |
