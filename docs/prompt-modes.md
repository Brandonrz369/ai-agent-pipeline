# Prompt Modes for Claude Code

**Three distinct operational modes that control how Claude Code approaches a task --
selected by Gemini based on task type, failure history, and GUI requirements.**

The V3 architecture treats Claude Code as a multi-hat operator. Each "hat" grants
different tool permissions, receives a different prompt structure, and optimizes for
a different phase of task completion. Gemini selects the hat; Claude Code wears it.

---

## Table of Contents

1. [Why Three Modes](#why-three-modes)
2. [EXECUTE Mode (Hat 1)](#execute-mode-hat-1)
3. [ARCHITECT Mode (Hat 2)](#architect-mode-hat-2)
4. [SUPERVISE Mode (Hat 3)](#supervise-mode-hat-3)
5. [Mode Transitions](#mode-transitions)
6. [Prompt Templates](#prompt-templates)
7. [Cross-References](#cross-references)

---

## Why Three Modes

A single prompt style fails for three reasons:

1. **Execution without planning loops forever.** When Claude Code hits a wall, retrying
   the same approach with the same tools produces the same failure. The completion loop
   detects this via consecutive failure counts and switches to ARCHITECT mode, which
   strips away execution tools and forces a planning-only response.

2. **Planning without execution never ships.** An agent that only reasons about code
   never writes code. EXECUTE mode gives full tool access and expects artifacts (files,
   commits, test results) as output. The plan from ARCHITECT mode becomes the input.

3. **Neither mode handles GUI.** Code tasks and GUI tasks require fundamentally different
   tool sets. SUPERVISE mode grants Computer Use (screenshots, mouse, keyboard) for
   tasks that require visual interaction with a desktop environment.

The Gemini orchestrator selects the mode and populates the corresponding template.
Claude Code never selects its own mode -- this prevents an agent stuck in a loop from
deciding it should keep trying instead of escalating.

---

## EXECUTE Mode (Hat 1)

### When It Activates

- **First attempt** at any new task entering the completion loop
- **After ARCHITECT mode** produces a blueprint (executing the blueprint's steps)
- **Default mode** for all code tasks unless failure history triggers escalation

### Tool Permissions

| Tool | Access | Notes |
|------|--------|-------|
| Bash | Full | Shell execution within Docker sandbox |
| Read | Full | Read any file in the workspace |
| Write | Full | Create and overwrite files |
| Edit | Full | Targeted string replacements in files |
| Glob | Full | File pattern matching |
| Grep | Full | Content search across files |
| WebFetch | Full | Fetch web content |
| WebSearch | Full | Search the web |
| NotebookEdit | Full | Edit Jupyter notebooks |
| Computer Use | **Denied** | GUI tasks require SUPERVISE mode |

### Prompt Structure

```
TASK:             What to accomplish (from Gemini's classification)
CONTEXT:          Relevant codebase state, prior results, task blueprint reference
INSTRUCTIONS:     Step-by-step execution guidance (from Gemini or ARCHITECT blueprint)
SUCCESS_CRITERIA:  How to verify the task is done (testable conditions)
ALLOWED_TOOLS:    Explicit list of permitted tools
```

### Template Location

`templates/execute-prompt.md`

### Example EXECUTE Prompt

```markdown
## TASK
Implement rate limiting middleware for the Express API at src/middleware/rate-limit.ts.

## CONTEXT
- Express 4.x API in src/server.ts
- Existing middleware pattern in src/middleware/auth.ts
- Redis client configured in src/config/redis.ts
- No existing rate limiting implementation

## INSTRUCTIONS
1. Create src/middleware/rate-limit.ts using sliding window algorithm
2. Use existing Redis client from src/config/redis.ts
3. Configure: 100 requests per 15-minute window per IP
4. Return 429 with Retry-After header on limit exceeded
5. Add middleware to src/server.ts after auth middleware
6. Write tests in tests/middleware/rate-limit.test.ts

## SUCCESS_CRITERIA
- npm test passes with all new tests green
- Rate limit triggers correctly at 101st request in test
- Retry-After header value is accurate
- Existing auth tests still pass

## ALLOWED_TOOLS
Bash, Read, Write, Edit, Glob, Grep
```

### Expected Output

Claude Code returns a structured JSON result:

```json
{
  "status": "PASS",
  "artifacts": [
    "src/middleware/rate-limit.ts",
    "tests/middleware/rate-limit.test.ts"
  ],
  "modifications": [
    "src/server.ts"
  ],
  "test_results": {
    "total": 14,
    "passed": 14,
    "failed": 0
  },
  "summary": "Implemented sliding-window rate limiter with Redis backend. 100 req/15min/IP. All 14 tests pass."
}
```

---

## ARCHITECT Mode (Hat 2)

### When It Activates

- **After 3 consecutive failures** in EXECUTE mode (hysteresis threshold)
- **When Gemini detects circular reasoning** (same error appearing in multiple hops)
- **When backflow is detected** (file hashes cycling to previous states)
- **Never on first attempt** -- always try EXECUTE first

### Tool Permissions

| Tool | Access | Notes |
|------|--------|-------|
| Read | Full | Can read files to understand codebase state |
| Glob | Full | Can search for files by pattern |
| Grep | Full | Can search file contents |
| Bash | **Read-only** | Can run read-only commands (ls, cat, git log, test suites) |
| Write | **Denied** | Cannot create or modify files |
| Edit | **Denied** | Cannot edit files |
| Computer Use | **Denied** | GUI tasks require SUPERVISE mode |

The key constraint: ARCHITECT mode **cannot modify the codebase**. This prevents
premature execution during the planning phase. The agent must think, not act.

### Prompt Structure

```
ROLE:             You are an architect. You analyze, plan, but do NOT execute.
TASK:             The original task that has been failing
FAILED_ATTEMPTS:  Summary of each previous attempt and its failure mode
PROVIDE:
  - Root cause analysis: Why did previous attempts fail?
  - Approach: What fundamentally different approach should be tried?
  - Step-by-step plan: Numbered, atomic steps for EXECUTE mode to follow
  - Variables: What information is needed at each step?
  - Verification: How to check each step succeeded before proceeding
  - Edge cases: What could go wrong with this new approach?
```

### Template Location

`templates/architect-prompt.md`

### Example ARCHITECT Prompt

```markdown
## ROLE
You are an architect. You will analyze the failed attempts below, identify the
root cause, and produce a detailed execution blueprint. You will NOT write code,
edit files, or execute commands that modify state. Read-only investigation only.

## TASK
Implement rate limiting middleware for the Express API at src/middleware/rate-limit.ts.

## FAILED_ATTEMPTS

### Attempt 1 (EXECUTE, hop 3)
- Created rate-limit.ts with in-memory store
- Tests failed: Redis connection expected but not available in test env
- Error: "Redis client not initialized"

### Attempt 2 (EXECUTE, hop 4)
- Added mock Redis in test setup
- Tests passed locally but rate-limit.ts still uses in-memory store
- Flash-Lite verification: RETRY -- implementation does not use Redis as specified

### Attempt 3 (EXECUTE, hop 5)
- Rewrote to use Redis but imported wrong client
- Error: "TypeError: redis.incr is not a function"
- Same Redis import error as attempt 1

## PROVIDE
1. Root cause analysis
2. Fundamentally different approach
3. Step-by-step plan (numbered, atomic)
4. Required variables at each step
5. Verification criteria per step
6. Edge cases and failure modes
```

### Expected Output

Claude Code returns a structured blueprint (no code files, no modifications):

```json
{
  "status": "BLUEPRINT",
  "root_cause": "The Redis client in src/config/redis.ts exports a ioredis instance, not node-redis. All three attempts used node-redis API (redis.incr). The correct API is redis.call('INCR', key).",
  "approach": "Use ioredis API directly. Verify the exported client type before writing any implementation code.",
  "plan": [
    {
      "step": 1,
      "action": "Read src/config/redis.ts and identify the exact export type and API surface",
      "verify": "Confirm whether export is ioredis.Redis or node-redis.RedisClient"
    },
    {
      "step": 2,
      "action": "Read ioredis documentation for INCR and EXPIRE commands",
      "verify": "Have the correct method signatures for sliding window"
    },
    {
      "step": 3,
      "action": "Create src/middleware/rate-limit.ts using ioredis API",
      "verify": "File compiles without type errors (tsc --noEmit)"
    },
    {
      "step": 4,
      "action": "Create test file with ioredis-mock (not node-redis mock)",
      "verify": "npm test -- --testPathPattern rate-limit passes"
    },
    {
      "step": 5,
      "action": "Register middleware in src/server.ts after auth middleware",
      "verify": "Full test suite passes: npm test"
    }
  ],
  "edge_cases": [
    "ioredis-mock may not support all commands -- verify INCR and EXPIRE are supported",
    "Existing tests may use a different Redis mock library -- check test/setup.ts"
  ]
}
```

This blueprint is then fed back into EXECUTE mode as the INSTRUCTIONS field.

---

## SUPERVISE Mode (Hat 3)

### When It Activates

- **When the task requires GUI interaction** (Gemini classification)
- **Examples:** Installing desktop software, navigating setup wizards, filling native
  forms, registering accounts in GUI-only applications
- **New in V3** -- not present in the original 6-phase pipeline

### Tool Permissions

| Tool | Access | Notes |
|------|--------|-------|
| Computer Use | Full | Screenshots, mouse movement, clicks, keyboard input |
| Bash | Full | Shell commands alongside GUI interaction |
| Read | Full | File reading for context |
| Write | Full | File writing for configuration/output |
| Edit | Full | File editing |
| gemini-cache MCP | Full | Context offloading for brain damage prevention |

### Prompt Structure

```
TASK:             What GUI interaction to perform
ENVIRONMENT:      Current desktop state, OS, display resolution
STEPS:            High-level steps (not pixel-level -- Claude Code figures out the GUI)
SAFETY:           What NOT to click (payment pages, delete buttons, etc.)
VERIFICATION:     How to confirm the GUI task succeeded
CONTEXT_OFFLOAD:  Reminder to offload to Gemini MCP cache every 5 steps
```

### Template Location

`templates/supervise-prompt.md`

### The Screenshot-Analyze-Act-Verify Loop

SUPERVISE mode operates on a continuous feedback loop:

```
1. Take screenshot of current desktop state
2. Analyze: What do I see? What is the next required action?
3. Execute: Move mouse to (x, y), click / type text / press key combo
4. Take new screenshot
5. Evaluate: Did the action produce the expected result?
   YES → Continue to next step
   NO  → Analyze what went wrong, try alternative approach
6. Every 5 steps: offload accumulated context to Gemini MCP cache
7. Repeat until task complete or failure threshold reached
```

### Context Offloading

Screenshots are token-expensive (~1500 tokens each). After 5 steps, accumulated
context can exceed useful limits. The offload protocol:

1. Claude Code calls `store_context(key, accumulated_context)` via Gemini MCP
2. Flash-Lite compresses to ~200 tokens (key facts, current state, remaining steps)
3. Claude Code receives compressed summary via `get_summary(key)`
4. Raw screenshot history is discarded from context
5. Claude Code continues with: current screenshot + compressed summary

This keeps the working context under ~50K tokens even for long GUI workflows.

### Safety Gates

SUPERVISE mode requires additional HITL gates due to the elevated risk of GUI
interaction. See `security/hitl-gates.md` for gate definitions.

| Gate | Trigger | Severity |
|------|---------|----------|
| HITL-013 | Any Computer Use session start | HIGH |
| HITL-014 | Credential entry during Computer Use | CRITICAL |

For full Computer Use documentation, see `docs/computer-use.md`.

---

## Mode Transitions

Mode transitions are managed by the Gemini orchestrator based on the task envelope
state. Claude Code never self-selects a mode.

### Transition Diagram

```
                    ┌──────────────────────────────┐
                    │                              │
                    │  Task enters completion loop │
                    │                              │
                    └──────────────┬───────────────┘
                                   │
                                   v
                    ┌──────────────────────────────┐
                    │                              │
                    │    Gemini classifies task     │
                    │                              │
                    └──────┬───────────┬───────────┘
                           │           │
              Code/API task│           │GUI task
                           v           v
              ┌────────────────┐  ┌────────────────┐
              │                │  │                │
              │  EXECUTE mode  │  │ SUPERVISE mode │
              │   (Hat 1)      │  │   (Hat 3)      │
              │                │  │                │
              └───┬────────┬───┘  └───┬────────────┘
                  │        │          │
           success│  3 consecutive    │stuck
                  │  failures         │
                  v        │          v
              ┌────────┐   │   ┌────────────────┐
              │ Done / │   │   │                │
              │ Return │   └──>│ ARCHITECT mode │
              └────────┘       │   (Hat 2)      │
                               │                │
                               └───┬────────────┘
                                   │
                                   │ produces blueprint
                                   v
                          ┌────────────────┐
                          │                │
                          │  EXECUTE mode  │
                          │ (with blueprint│
                          │  as INSTRUCTIONS)
                          │                │
                          └───┬────────┬───┘
                              │        │
                       success│  still failing
                              │        │
                              v        v
                          ┌────────┐  Dead-letter
                          │ Done / │  (TTL exceeded)
                          │ Return │
                          └────────┘
```

### Transition Rules

| Transition | Trigger | Mechanism |
|-----------|---------|-----------|
| EXECUTE -> ARCHITECT | `consecutive_failures >= 3` | Hysteresis escalation; sets `escalated = true` |
| ARCHITECT -> EXECUTE | Blueprint produced | Always; ARCHITECT output becomes EXECUTE input |
| EXECUTE -> EXECUTE (de-escalate) | `consecutive_successes >= 2` after architect blueprint | Clears `escalated` flag; future failures restart at count 0 |
| EXECUTE/ARCHITECT -> SUPERVISE | Task classified as GUI by Gemini | Initial classification, not a failure-based transition |
| SUPERVISE -> ARCHITECT | Claude Code reports "stuck" in GUI | Same hysteresis rules apply |
| Any -> Dead-letter | `hops >= ttl_max` | TTL exceeded; task envelope written to dead-letter queue |

### Transition Tracking in Task Envelope

All transitions are recorded in the task envelope (`schemas/task-envelope.schema.json`):

```json
{
  "id": "task_abc123",
  "mode": "ARCHITECT",
  "hops": 5,
  "consecutive_failures": 3,
  "consecutive_successes": 0,
  "escalated": true,
  "session_ids": [
    "session_001",
    "session_002",
    "session_003",
    "session_004",
    "session_005"
  ]
}
```

Each mode change starts a **new Claude Code session**. This is intentional:
- Fresh context window (no stale reasoning from failed attempts)
- Clean tool state (no lingering file handles or processes)
- Session ID tracked for audit trail

---

## Prompt Templates

| Mode | Template File | Description |
|------|--------------|-------------|
| EXECUTE | `templates/execute-prompt.md` | Full execution with all tools |
| ARCHITECT | `templates/architect-prompt.md` | Read-only analysis and planning |
| SUPERVISE | `templates/supervise-prompt.md` | GUI interaction with Computer Use |

Templates are Mustache-style with variables populated by Gemini before dispatch
to Claude Code. Variables include task details, context, prior results, and
safety constraints.

---

## Cross-References

| Document | Relevance |
|----------|-----------|
| `docs/completion-loop.md` | How mode transitions fit into the inner completion loop |
| `docs/anti-loop-safeguards.md` | TTL, hysteresis, and backflow that govern transitions |
| `docs/computer-use.md` | Full SUPERVISE mode and Computer Use documentation |
| `docs/openclaw-gateway.md` | How tasks enter the system and reach mode selection |
| `docs/phase4-model-routing.md` | Model selection that complements prompt mode selection |
| `security/hitl-gates.md` | HITL-013 and HITL-014 gates for SUPERVISE mode |
| `schemas/task-envelope.schema.json` | Task envelope schema tracking mode state |
| `templates/execute-prompt.md` | EXECUTE mode prompt template |
| `templates/architect-prompt.md` | ARCHITECT mode prompt template |
| `templates/supervise-prompt.md` | SUPERVISE mode prompt template |
