# Phase 2: Schema-Driven Task Decomposition

**Convert unstructured research output into machine-executable JSON task contracts --
eliminating the "Ambiguity Tax" that kills downstream automation.**

This phase is the bridge between human-readable research and machine-executable work.
Every task dispatched to any agent in the pipeline passes through schema validation here.

---

## Table of Contents

1. [Why JSON Contracts Beat Prose Prompts](#why-json-contracts-beat-prose-prompts)
2. [The Task Blueprint Schema Walkthrough](#the-task-blueprint-schema-walkthrough)
3. [Generating Blueprints with a Tier 3 Model](#generating-blueprints-with-a-tier-3-model)
4. [Schema Validation Workflow](#schema-validation-workflow)
5. [Good vs Bad Task Decomposition](#good-vs-bad-task-decomposition)
6. [Batch Organization Strategies](#batch-organization-strategies)

---

## Why JSON Contracts Beat Prose Prompts

### The Ambiguity Tax

When you dispatch work to an agent with a prose prompt like "implement the auth system
from the research doc," you pay the **Ambiguity Tax**:

- The agent interprets "implement" differently than you meant
- It guesses which files to modify (often wrong)
- It decides its own scope (often too broad or too narrow)
- The output format is unpredictable
- Downstream automation cannot parse the result reliably
- Failure mode: silent drift, discovered only at integration time

**The tax compounds.** In a 5-agent pipeline, each agent's ambiguity multiplies. By the
time the Red Team reviews, the output bears little resemblance to the original intent.

### The Schema Contract Solution

A JSON task contract eliminates every source of ambiguity:

| Prose Prompt | JSON Contract |
|--------------|---------------|
| "Implement auth" | `"objective": "Implement JWT validation middleware"` |
| (agent guesses files) | `"target_file": "src/auth/middleware.ts"` |
| (agent guesses scope) | `"write_scope": ["src/auth/", "tests/auth/"]` |
| (agent guesses format) | `"report_file": "reports/n2_auth_batch1.md"` |
| (no dependency tracking) | `"dependencies": ["PROJ-2026-001-B1-N1"]` |
| (no tool specification) | `"mcp_tools_required": ["filesystem", "bash"]` |

The agent cannot misinterpret because there is nothing to interpret. The contract is
the specification.

---

## The Task Blueprint Schema Walkthrough

The full schema lives at `schemas/task-blueprint.schema.json`. Here is every field,
explained.

### Top-Level Structure

```json
{
  "task_id": "PROJ-2026-001-B1-N2",
  "metadata": { ... },
  "task": { ... },
  "output": { ... },
  "constraints": { ... }
}
```

### task_id

```json
"task_id": "PROJ-2026-001-B1-N2"
```

Pattern: `PROJECT-YEAR-SEQUENCE-BATCH-NODE`

- `PROJ` -- project code (uppercase)
- `2026` -- year
- `001` -- sequence number within the project
- `B1` -- batch number (tasks dispatched together)
- `N2` -- node number (which agent executes this)

This ID is referenced by dependencies, reports, and the audit trail. It must be unique
across the entire project.

### metadata

```json
"metadata": {
  "project": "project-name", "node": 2, "workstream": "backend-api",
  "batch": 1, "priority": "P1", "deadline": "2026-03-01", "tier": 2
}
```

Key fields: `node` (which agent executes, 0 = orchestrator), `workstream` (logical
grouping), `priority` (P1 = critical path), `tier` (1/2/3 for model routing -- see
[Phase 4](phase4-model-routing.md)). The `tier` field is one of the highest-ROI
settings in the pipeline.

### task

```json
"task": {
  "type": "EDIT",
  "target_file": "src/auth/middleware.ts",
  "objective": "Implement JWT validation middleware",
  "instructions": [
    "Query knowledge cache: 'What auth standard does this codebase use?'",
    "Review existing auth patterns in src/auth/",
    "Implement validateJWT() per the spec in research output section 3.2",
    "Write unit tests covering: valid token, expired token, malformed token"
  ],
  "dependencies": ["PROJ-2026-001-B1-N1"],
  "mcp_tools_required": ["filesystem", "bash", "github"],
  "context_queries": [
    "What JWT library version is in package.json?",
    "Are there existing auth tests to follow as patterns?"
  ]
}
```

Key fields: `type` (EDIT/CREATE/REVIEW/RESEARCH/EXECUTE), `target_file` (primary file),
`objective` (what success looks like), `instructions` (ordered imperative steps),
`dependencies` (task_ids that must complete first), `mcp_tools_required` (which MCP
servers are needed), `context_queries` (Gemini cache queries to run before starting).

**The `instructions` array is the most critical field.** Each instruction must be
imperative ("Implement X" not "X should be implemented"), specific, verifiable, and
scoped within `write_scope`.

### output

The `output` block defines what the agent must produce: `report_file` (watched by N8n
Workflow B -- see [Phase 3](phase3-n8n-orchestration.md)), `status_options`, and
`required_fields`.

### constraints

```json
"constraints": {
  "write_scope": ["src/auth/", "tests/auth/"],
  "read_scope": ["src/", "docs/"],
  "forbidden": ["node_modules/", ".env", "*.secret"],
  "requires_human_approval": false
}
```

`write_scope` limits where the agent can modify files. `forbidden` patterns are never
accessible. `requires_human_approval` triggers the HITL gate (see
[Phase 6](phase6-security.md)). These constraints map directly to the RBAC system.

---

## Generating Blueprints with a Tier 3 Model

Task decomposition is a Tier 3 job. Budget models produce vague instructions and miss
dependencies. Use Claude Opus, o3, or Gemini Deep Research for this step.

### System Prompt for the Decomposer

```
You are a technical project decomposer. Read the attached research report.
Decompose the implementation into an array of JSON task objects following
the schema at schemas/task-blueprint.schema.json exactly.

Rules:
- Each task must have a unique task_id following pattern: PROJECT-YEAR-SEQ-BATCH-NODE
- Dependencies must reference valid task_ids within this batch
- Instructions must be imperative, specific, and verifiable
- No task may span more than one workstream
- Assign tier: 1 for reads/fetches/parses, 2 for implementation, 3 for review/synthesis
- Set write_scope as narrowly as possible
- Output ONLY valid JSON -- no prose, no markdown wrapper, no code fences
```

### Invocation

```bash
# Feed the Phase 1 research output to a Tier 3 model with the decomposer prompt
# The model produces a JSON array of task blueprints

# Example using Claude:
# Paste the decomposer system prompt + research output
# Model returns: [ { "task_id": "PROJ-2026-001-B1-N1", ... }, ... ]

# Save to the prompts directory:
# prompts/batch1_tasks.json
```

### Manual Review Checkpoint

Before validation, manually review the generated blueprints for:
1. **Dependency correctness** -- Are dependencies pointing to tasks that actually produce what is needed?
2. **Scope creep** -- Is any task trying to do too much?
3. **Missing tasks** -- Did the model skip any section of the research output?
4. **Tier assignments** -- Are simple reads assigned Tier 1 and synthesis assigned Tier 3?

---

## Schema Validation Workflow

Every blueprint must pass schema validation before dispatch. Invalid JSON contracts
cause silent failures downstream.

### Using ajv (CLI)

```bash
# Install ajv-cli (one-time)
npm install -g ajv-cli

# Validate a single batch file against the schema
npx ajv validate \
  -s schemas/task-blueprint.schema.json \
  -d prompts/batch1_tasks.json

# Expected output on success:
# prompts/batch1_tasks.json valid

# Expected output on failure:
# prompts/batch1_tasks.json invalid
# [ { keyword: 'required', message: "must have required property 'objective'" } ]
```

For programmatic validation in N8n, use the `ajv` library to compile the schema and
validate each blueprint before dispatch.

### Validation in the Pipeline

```
Research output (Phase 1)
    |
    v
Tier 3 model generates JSON blueprints
    |
    v
Schema validation (ajv) ----[FAIL]----> Fix and re-generate
    |
    [PASS]
    v
Write to prompts/batch[N]_tasks.json
    |
    v
N8n file watcher triggers fan-out (Phase 3)
```

---

## Good vs Bad Task Decomposition

### Bad: Vague, overlapping, unverifiable

```json
{
  "task_id": "PROJ-2026-001-B1-N1",
  "metadata": { "tier": 2, "workstream": "backend", "priority": "P2", "node": 1, "batch": 1, "project": "proj" },
  "task": {
    "type": "CREATE",
    "objective": "Set up the backend",
    "instructions": ["Create the backend architecture", "Add authentication",
      "Make sure it works", "Write some tests"],
    "mcp_tools_required": ["filesystem", "bash"]
  },
  "output": { "report_file": "reports/n1_batch1.md", "status_options": ["PASS", "FAIL"] },
  "constraints": { "write_scope": ["src/"], "read_scope": ["src/"] }
}
```

**Problems:** "Set up the backend" is 50+ hours in one task. "Make sure it works" is
not verifiable. `write_scope` of `src/` is the entire codebase. No dependencies,
no context queries, no target file.

### Good: Narrow, specific, verifiable

```json
{
  "task_id": "PROJ-2026-001-B1-N2",
  "metadata": {
    "project": "acme-saas",
    "node": 2,
    "workstream": "auth",
    "batch": 1,
    "priority": "P1",
    "deadline": "2026-03-01",
    "tier": 2
  },
  "task": {
    "type": "EDIT",
    "target_file": "src/auth/middleware.ts",
    "objective": "Implement JWT validation middleware with RS256 verification",
    "instructions": [
      "Query knowledge cache: 'What JWT library and version is in package.json?'",
      "Read src/auth/middleware.ts to understand existing middleware chain",
      "Read src/auth/types.ts for the AuthenticatedRequest interface",
      "Implement validateJWT() that verifies RS256 signatures using jose@5.x",
      "Handle three error cases: expired token (401), malformed token (400), missing token (401)",
      "Export the middleware as default from the module",
      "Write tests in tests/auth/middleware.test.ts covering: valid token, expired, malformed, missing"
    ],
    "dependencies": ["PROJ-2026-001-B1-N1"],
    "mcp_tools_required": ["filesystem", "bash"],
    "context_queries": [
      "What JWT library version is in package.json?",
      "What does the AuthenticatedRequest interface look like?",
      "Are there existing middleware tests to follow as patterns?"
    ]
  },
  "output": {
    "report_file": "reports/n2_auth_middleware_batch1.md",
    "status_options": ["PASS", "FAIL", "PARTIAL", "BLOCKED"],
    "required_fields": ["status", "files_changed", "tests_added", "issues_found"],
    "cross_stream_alerts": []
  },
  "constraints": {
    "write_scope": ["src/auth/", "tests/auth/"],
    "read_scope": ["src/", "docs/", "schemas/"],
    "forbidden": ["node_modules/", ".env", "*.secret"],
    "requires_human_approval": false
  }
}
```

**Why this works:**
- Single file target, narrow write scope
- Every instruction is a verifiable action
- Context queries pre-load relevant knowledge before the agent starts
- Dependencies are explicit
- Error cases are enumerated, not left to the agent's judgment

---

## Batch Organization Strategies

### Strategy 1: Dependency-Ordered Batches

Group tasks into batches where all tasks within a batch can run in parallel (no
intra-batch dependencies), and batch N+1 depends on batch N completing.

```
Batch 1: [N1: research context, N2: scaffold project, N3: set up CI]
    |  (all independent -- fan-out)
    v
Batch 2: [N1: auth middleware, N2: database schema, N3: API routes]
    |  (all depend on Batch 1 -- fan-out after Batch 1 fan-in)
    v
Batch 3: [N1: integration tests, N2: load tests]
    |  (depend on Batch 2)
    v
Batch 4: [Red Team review of all outputs]
```

### Strategy 2: Workstream-Aligned Batches

Group tasks by workstream. Each workstream runs as an independent pipeline.
Cross-workstream sync happens only at defined integration points.

```
Workstream A (backend):  B1-N1 → B1-N2 → B1-N3 → Integration Gate
Workstream B (frontend): B1-N4 → B1-N5 → B1-N6 → Integration Gate
                                                      |
                                                 Batch 2: Integration tasks
```

### Strategy 3: Tier-Grouped Batches (Cost Optimization)

Group all Tier 1 tasks (cache queries, file reads) first, then Tier 2 (implementation),
then Tier 3 (review/synthesis). Minimizes expensive model usage.

### Naming Convention

```
prompts/batch1_tasks.json       # First batch
prompts/batch2_tasks.json       # Second batch (depends on batch 1)
prompts/redteam_batch1.json     # Red Team review of batch 1 outputs
```

---

## What Comes Next

The validated JSON blueprints are written to `prompts/` and picked up by the N8n
file watcher, which fans them out to parallel agent sub-workflows. See
[Phase 3: N8n Workflow Orchestration](phase3-n8n-orchestration.md).
