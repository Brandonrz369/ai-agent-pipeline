# Phase 4: Intent-Based Model Routing

**Route each task to the cheapest model capable of completing it -- cutting costs by
85-94% compared to running everything on a flagship model.**

Without routing, every cache query, file read, and status parse burns flagship tokens.
With a 3-tier routing strategy, you reserve expensive models for the work that actually
needs them.

---

## Table of Contents

1. [The Cost Problem](#the-cost-problem)
2. [The 3-Tier Model Stack](#the-3-tier-model-stack)
3. [Routing Logic (Classifier Node)](#routing-logic-classifier-node)
4. [Portkey / AI Gateway Integration](#portkey--ai-gateway-integration)
5. [Fallback and Escalation Protocol](#fallback-and-escalation-protocol)
6. [Cost Projections and ROI](#cost-projections-and-roi)

---

## The Cost Problem

In an agentic workflow, a single task generates many internal steps. A worker agent
debugging a function might:

1. Read the file (tool call)
2. Query the knowledge cache (tool call)
3. Attempt a fix (reasoning + generation)
4. Run the test suite (tool call)
5. Read the error output (tool call)
6. Revise the fix (reasoning + generation)
7. Run tests again (tool call)
8. Parse the result (tool call)
9. Write the report (generation)

That is 9 steps for a single task. If every step runs on Claude Opus at ~$15/M input +
$75/M output tokens, a task that processes 50K tokens across its steps costs:

```
50K tokens * ~$45/M average = ~$2.25 per task
20 tasks per batch = $45 per batch
4 batches per project = $180 per project
```

Now consider that steps 1, 2, 4, 5, and 8 are trivial -- they are file reads, cache
queries, and output parsing. A $0.03/M token model handles them identically. That is
5 of 9 steps (55%) running at 1/500th the cost.

---

## The 3-Tier Model Stack

> **Note:** Pricing is approximate as of February 2026 and subject to change. Check
> provider pricing pages for current rates before using these figures for budgeting.

### Tier 1: Runners (Cheap, Fast, High-Volume)

| Model | Input Price | Output Price | Best For |
|-------|-------------|--------------|----------|
| Claude Haiku 4.5 | $0.80/M | $4.00/M | Cache queries, status parsing |
| Gemini Flash | $0.075/M | $0.30/M | File reads, format checks |
| GPT-4o-mini | $0.15/M | $0.60/M | Boilerplate generation, log parsing |

**Task profile:** File reads, cache queries, status parsing, format validation,
boilerplate generation, log parsing, data fetching. Any task where the "thinking" is
trivial and the bottleneck is I/O.

### Tier 2: Workers (Balanced, Capable)

| Model | Input Price | Output Price | Best For |
|-------|-------------|--------------|----------|
| Claude Sonnet 4.6 | $3.00/M | $15.00/M | Code generation, editing |
| Gemini Pro | $1.25/M | $5.00/M | Multi-file reasoning |
| GPT-4.1 | $2.00/M | $8.00/M | Cross-reference, drafting |

**Task profile:** Code implementation, document drafting, moderate reasoning, parallel
workstream execution, cross-referencing, editing. The bulk of "real work" in the pipeline.

### Tier 3: Synthesis (Expensive, Reserved for High-Value)

| Model | Input Price | Output Price | Best For |
|-------|-------------|--------------|----------|
| Claude Opus 4.6 | $15.00/M | $75.00/M | Strategic synthesis, architecture |
| Gemini Deep Research | Per-query pricing | Research synthesis |
| o3 | $10.00/M | $40.00/M | Complex multi-file reasoning |

**Task profile:** Strategic synthesis, complex multi-document reasoning, final quality
control, architectural decisions, root narrative updates, red team review. Tasks where
getting it wrong is expensive.

---

## Routing Logic (Classifier Node)

The router runs as an N8n Function node before each task dispatch. It examines the task
blueprint and assigns a tier. The classifier itself runs on a Tier 1 model (cheap).

### Basic Classifier (Rule-Based)

```javascript
// N8n Function Node: Route Task to Tier
// Input: task blueprint JSON
// Output: task + assigned tier

function routeTask(task) {
  const type = task.task.type;
  const instructions = task.task.instructions.join(' ').toLowerCase();
  const tier = task.metadata.tier;

  // Explicit tier override from blueprint
  if (tier) return tier;

  // Tier 3: synthesis, strategy, architecture, final review
  if (type === 'REVIEW' ||
      instructions.includes('synthesize') ||
      instructions.includes('strategic') ||
      instructions.includes('architecture') ||
      instructions.includes('red team') ||
      instructions.includes('quality control') ||
      (task.metadata.priority === 'P1' && type !== 'RESEARCH')) {
    return 3;
  }

  // Tier 1: fetching, reading, parsing, formatting
  if (instructions.includes('query cache') ||
      instructions.includes('query knowledge') ||
      instructions.includes('read file') ||
      instructions.includes('parse') ||
      instructions.includes('format') ||
      instructions.includes('list files') ||
      instructions.includes('check status') ||
      (type === 'RESEARCH' && !instructions.includes('synthesize'))) {
    return 1;
  }

  // Default: Tier 2 (implementation work)
  return 2;
}

const task = $input.first().json;
const assignedTier = routeTask(task);

return [{
  json: {
    ...task,
    routing: {
      tier: assignedTier,
      model: assignedTier === 1 ? 'claude-haiku-4-5'
           : assignedTier === 2 ? 'claude-sonnet-4-6'
           : 'claude-opus-4-6',
      timestamp: new Date().toISOString()
    }
  }
}];
```

### Advanced Classifier (LLM-Based)

For more nuanced routing, use a Tier 1 model as the classifier itself:

```javascript
// System prompt for the classifier model (Haiku or Flash)
const classifierPrompt = `You are a task routing classifier.
Given a task JSON, respond with ONLY a number: 1, 2, or 3.

Tier 1 (cheap model): Reading files, querying caches, parsing outputs,
  formatting data, simple transformations.
Tier 2 (mid-tier model): Code generation, document writing, moderate reasoning,
  multi-file edits, cross-referencing.
Tier 3 (flagship model): Strategic synthesis, architecture decisions,
  multi-document reasoning, quality review, red team analysis.

Task: ${JSON.stringify(task)}

Respond with ONLY the tier number.`;
```

Cost of classification: ~$0.001 per task (Haiku processing a small JSON object).

---

## Portkey / AI Gateway Integration

Portkey acts as a unified API gateway that routes requests to different providers
based on configuration. This centralizes API key management, enables automatic retries,
and provides cost tracking.

### Setup

```bash
# Install Portkey SDK (for programmatic use)
npm install portkey-ai

# Or use the REST API directly from N8n HTTP Request nodes
```

### N8n HTTP Request Node Configuration

```javascript
// N8n HTTP Request Node
{
  "url": "https://api.portkey.ai/v1/chat/completions",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "x-portkey-api-key": "{{ $env.PORTKEY_API_KEY }}",
    "x-portkey-virtual-key": "{{ $json.routing.tier === 1 ? $env.HAIKU_VKEY : $json.routing.tier === 2 ? $env.SONNET_VKEY : $env.OPUS_VKEY }}",
    "x-portkey-retry-count": "3",
    "x-portkey-cache": "semantic",
    "x-portkey-trace-id": "{{ $json.task_id }}"
  },
  "body": {
    "model": "{{ $json.routing.model }}",
    "messages": [
      { "role": "system", "content": "{{ $json.system_prompt }}" },
      { "role": "user", "content": "{{ JSON.stringify($json.task) }}" }
    ],
    "max_tokens": "{{ $json.routing.tier === 1 ? 2000 : $json.routing.tier === 2 ? 8000 : 16000 }}"
  }
}
```

### Key Portkey Features for This Pipeline

| Feature | How It Helps |
|---------|-------------|
| **Semantic caching** | Identical or near-identical cache queries return cached results, saving tokens |
| **Automatic retries** | Tier 1 models that fail get retried before escalation |
| **Cost tracking** | Per-task cost visible in Portkey dashboard, tagged by task_id |
| **Fallback routing** | If Haiku is down, auto-route to Flash |
| **Rate limit handling** | Queues requests instead of failing on rate limits |
| **Trace IDs** | Every request tagged with task_id for audit trail correlation |

### Alternative: Self-Hosted AI Gateway

If you prefer not to route through a third-party service:

```bash
# LiteLLM Proxy (open-source alternative)
pip install litellm[proxy]

# Config file
cat > litellm_config.yaml << 'EOF'
model_list:
  - model_name: tier1
    litellm_params:
      model: anthropic/claude-haiku-4-5
      api_key: $ANTHROPIC_API_KEY

  - model_name: tier2
    litellm_params:
      model: anthropic/claude-sonnet-4-6
      api_key: $ANTHROPIC_API_KEY

  - model_name: tier3
    litellm_params:
      model: anthropic/claude-opus-4-6
      api_key: $ANTHROPIC_API_KEY
EOF

litellm --config litellm_config.yaml --port 4000
```

Point N8n HTTP Request nodes at `http://localhost:4000/v1/chat/completions` instead
of the Portkey URL.

---

## Fallback and Escalation Protocol

When a model fails to complete a task, the system escalates rather than retrying
infinitely at the same tier.

### Escalation Chain

```
Tier 1 attempt
    |
    [SUCCESS] --> Done
    |
    [FAIL: hallucination, retry loop, malformed output]
    |
    v
Tier 2 attempt (same task, same context)
    |
    [SUCCESS] --> Done (flag in report: "escalated from Tier 1")
    |
    [FAIL]
    |
    v
Tier 3 attempt (same task, same context)
    |
    [SUCCESS] --> Done (flag in report: "escalated from Tier 2")
    |
    [FAIL]
    |
    v
STOP -- Human alert via Discord
    "Task [task_id] failed at all tiers. Manual intervention required."
```

### Escalation Detection

How to detect that a Tier 1 model is failing:

```javascript
// N8n Function Node: Escalation Detector
function shouldEscalate(response, tier) {
  // Malformed output (model could not follow the schema)
  if (!isValidJSON(response.output)) return true;

  // Retry loop (model asked to use the same tool 3+ times)
  if (response.tool_calls_count > 10 && tier === 1) return true;
  if (response.tool_calls_count > 20 && tier === 2) return true;

  // Hallucination signal (confident claim with no citation)
  if (response.output.includes('UNSUPPORTED_CLAIM')) return true;

  // Explicit "I cannot" response
  if (response.output.toLowerCase().includes('i cannot complete')) return true;

  return false;
}
```

### Tracking Escalation Patterns

Over time, track which task types escalate frequently. If a "Tier 1" task type
escalates to Tier 2 more than 30% of the time, reclassify it as Tier 2 in the
routing rules. This is how the routing logic improves over time.

---

## Cost Projections and ROI

### Without Routing (All Opus)

```
Assumption: 100 tasks per project, ~50K tokens average per task

100 tasks * 50K tokens * $45/M tokens = $225 per project
```

### With 3-Tier Routing

```
Distribution: 70% Tier 1, 25% Tier 2, 5% Tier 3

Tier 1: 70 tasks * 50K tokens * $2.40/M  = $8.40
Tier 2: 25 tasks * 50K tokens * $9.00/M  = $11.25
Tier 3:  5 tasks * 50K tokens * $45.00/M = $11.25

Total: $30.90 per project
```

### Savings

```
Without routing:  $225.00
With routing:      $30.90
Savings:          $194.10 (86% reduction)
```

### ROI Breakeven

Setting up the routing infrastructure (Portkey account, N8n classifier node, tier
definitions) takes approximately 2-4 hours. At $194 saved per project, the setup
pays for itself within the first project.

### Monitoring Costs

Track actual costs in the Portkey dashboard or via LiteLLM logs. Review monthly:

```bash
# If using Portkey, costs are visible at:
# https://app.portkey.ai/dashboard/analytics

# If self-hosted, parse LiteLLM logs:
# grep "cost" /var/log/litellm/access.log | awk '{sum += $NF} END {print sum}'
```

Adjust tier boundaries based on actual cost vs. quality data. The goal is to
maximize the percentage of Tier 1 usage without increasing failure rates.

---

## What Comes Next

Once a task is routed to a model, the model needs to execute tool calls reliably.
[Phase 5: MCP Execution + TypeScript Wrappers](phase5-mcp-execution.md) describes
how agents call tools through TypeScript wrappers instead of raw JSON-RPC, eliminating
the #1 source of execution failures in budget-tier models.
