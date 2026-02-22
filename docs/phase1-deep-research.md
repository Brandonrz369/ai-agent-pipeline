# Phase 1: Deep Research Engine

**Transform a high-level directive into a comprehensive, cited specification -- eliminating
the gap between what was said and what was meant.**

Deep research is the foundation of the entire pipeline. Every downstream phase depends on
the quality and completeness of the spec produced here. Skip this and you inherit
"intent-to-implementation deviation" in every task that follows.

---

## Table of Contents

1. [Why Deep Research Matters](#why-deep-research-matters)
2. [Provider Comparison](#provider-comparison)
3. [Internal Architecture: The Hidden 4-Agent Pipeline](#internal-architecture-the-hidden-4-agent-pipeline)
4. [Enterprise Integration via MCP](#enterprise-integration-via-mcp)
5. [Implementation Examples](#implementation-examples)
6. [Output Format Specification](#output-format-specification)
7. [Tips and Gotchas](#tips-and-gotchas)

---

## Why Deep Research Matters

Single-agent prompting suffers from **intent-to-implementation deviation**: the agent
executes what was literally said, not what was actually meant. The gap between those two
widens with task complexity.

Consider the difference:

| Approach | Prompt | Result |
|----------|--------|--------|
| Direct prompting | "Build an auth system" | Generic JWT boilerplate, no consideration of existing codebase patterns |
| Deep research first | "Build an auth system" | 5,000-word spec covering existing codebase patterns, library versions, compliance requirements, edge cases, competitor approaches, with citations |

The deep research output becomes a **shared truth document** that all downstream agents
reference. This eliminates the #1 cause of multi-agent drift: agents making different
assumptions about ambiguous requirements.

---

## Provider Comparison

| Provider | Model | Strengths | Limitations | Best For |
|----------|-------|-----------|-------------|----------|
| Gemini | `gemini-deep-research` | Long-form synthesis, cited sources, native MCP integration, follow-up queries without re-running | Can take 10-20 min for complex topics | Primary recommendation. Long-form synthesis with MCP cache integration |
| OpenAI | `o3-deep-research` | Strong enterprise reasoning, Azure Foundry deployment support | Less integrated with MCP ecosystem | Azure-first organizations, compliance-heavy domains |
| Anthropic | Claude + web search | Stays within the Claude ecosystem, no additional API keys | Not a dedicated deep-research model; manual web search orchestration | When provider consolidation matters more than research depth |

**Recommendation:** Use Gemini Deep Research as the default. Its native MCP integration
means the research output can be cached and queried by all downstream agents without
copying files around. Use o3-deep-research as a second opinion for high-stakes decisions.

---

## Internal Architecture: The Hidden 4-Agent Pipeline

Deep research models are not a single inference call. Under the hood, they operate as a
coordinated 4-agent pipeline:

```
User prompt (high-level directive)
    |
    v
[1. TRIAGE AGENT]
    Is the prompt specific enough to research?
    Does it contain implicit assumptions that need to be made explicit?
    |
    v (if context is insufficient)
[2. CLARIFIER AGENT] (lightweight model)
    Deduces missing context from the prompt
    Expands abbreviations, resolves ambiguities
    Infers the user's actual goal from the stated goal
    |
    v
[3. INSTRUCTION BUILDER]
    Translates the clarified intent into a precise research brief
    Defines search strategy: which domains, what depth, what comparisons
    Sets the structure of the final output
    |
    v
[4. RESEARCH AGENT]
    Executes web-scale empirical search
    Synthesizes across sources
    Resolves contradictions between sources
    Produces cited, structured markdown
    |
    v
Comprehensive markdown report with inline citations
```

**Why this matters for your pipeline:** You do not need to build this orchestration
yourself. The deep research API handles it. Your job is to craft prompts that give
the Triage Agent enough signal to avoid unnecessary clarification loops.

---

## Enterprise Integration via MCP

Public web research alone is insufficient for enterprise work. Internal knowledge must
be part of the research context. Connect these via MCP:

### Internal Vector Databases (RAG)
```bash
# Connect your existing vector DB as an MCP server
# The deep research agent queries it alongside web sources

# Example: Qdrant vector DB with company documentation
mcp-server-qdrant --collection company-docs --host localhost:6333
```

The research agent treats internal documents as first-class sources, citing them
alongside web references.

### Private GitHub Repos
```bash
# GitHub MCP server provides codebase-as-context
# Research agent can answer: "What patterns does this codebase already use?"

mcp-server-github --repo your-org/your-repo --branch main
```

This is critical for technical research. Without codebase context, the research output
will recommend approaches that conflict with existing patterns.

### Legacy Documentation
```bash
# For proprietary system specs, internal wikis, Confluence exports
# Convert to text and load into Gemini cache

cat legacy-docs/*.md > /tmp/legacy_combined.txt

# Create a Gemini cache (via MCP)
# gemini-create-cache filePath:/tmp/legacy_combined.txt \
#   displayName:legacy-systems ttlMinutes:120
```

Once cached, the research agent can query legacy knowledge inline:
```bash
# gemini-research-followup researchId:"[ID]" \
#   question:"How does the legacy auth system handle token refresh?"
```

---

## Implementation Examples

### Starting a Research Session (Gemini MCP)

```bash
# Step 1: Launch deep research
# gemini-deep-research \
#   query:"Design a multi-tenant authentication system for a SaaS platform \
#          that must support SSO via SAML 2.0 and OIDC, integrate with \
#          existing PostgreSQL user tables, and handle 10K concurrent sessions. \
#          Compare JWT vs opaque token approaches with security tradeoffs." \
#   format:"detailed technical report"

# Returns: { researchId: "abc123", status: "RUNNING" }
```

```bash
# Step 2: Poll for completion (typically 5-20 minutes)
# gemini-check-research researchId:"abc123"

# Returns: { status: "COMPLETED", resultLength: 8432 }
```

```bash
# Step 3: Follow-up without re-running the full research
# gemini-research-followup researchId:"abc123" \
#   question:"What are the specific PostgreSQL schema changes needed \
#            for the SAML assertion cache?"

# Returns: targeted answer drawing on the full research context
```

### Prompt Engineering for Deep Research

The quality of Phase 1 output is determined by prompt quality. Structure prompts with:

```
[DOMAIN]: What field is this in?
[OBJECTIVE]: What are you trying to accomplish?
[CONSTRAINTS]: What must be true? (compliance, tech stack, scale)
[EXISTING CONTEXT]: What already exists? (codebase, systems, decisions)
[COMPARISONS]: What alternatives should be evaluated?
[OUTPUT FORMAT]: What structure should the report take?
```

**Example of a well-structured prompt:**

```
DOMAIN: Enterprise SaaS backend engineering
OBJECTIVE: Design a rate limiting system that protects API endpoints
  from abuse while maintaining <50ms p99 latency overhead.
CONSTRAINTS: Must use Redis (already in stack), must support
  per-tenant and per-endpoint limits, must integrate with existing
  Express.js middleware chain.
EXISTING CONTEXT: Current codebase uses Express 4.x, Redis 7.2,
  TypeScript 5.3. No existing rate limiting. Auth middleware at
  src/auth/middleware.ts handles JWT validation.
COMPARISONS: Token bucket vs sliding window vs fixed window.
  In-memory vs Redis-backed. Evaluate express-rate-limit, rate-limiter-flexible,
  and custom implementation.
OUTPUT FORMAT: Technical report with architecture diagrams,
  code examples, benchmark projections, and implementation steps.
```

---

## Output Format Specification

The deep research output is a markdown document. For reliable downstream consumption
by Phase 2 (schema decomposition), structure it with these sections:

```markdown
# [Research Topic] -- Deep Research Report
## Generated: [timestamp]
## Sources consulted: [count]

## 1. Executive Summary
[2-3 paragraphs: what was found, key recommendation, confidence level]

## 2. Background and Context
[Existing systems, constraints, prior decisions]

## 3. Comparative Analysis
[Options evaluated, with pros/cons/tradeoffs for each]

## 4. Recommended Approach
[The chosen strategy, with justification]

## 5. Implementation Specification
[Detailed, step-by-step implementation plan]
[This section is what Phase 2 decomposes into task blueprints]

## 6. Risk Assessment
[What could go wrong, mitigations, fallback strategies]

## 7. Open Questions
[Items that require human decision or further research]

## References
[Inline citations throughout, compiled here]
```

**Critical:** Section 5 (Implementation Specification) is the primary input to Phase 2.
If this section is vague, the task decomposition will produce vague blueprints. Review
this section manually before proceeding. See [Phase 2](phase2-schema-decomposition.md)
for how the spec gets decomposed.

---

## Tips and Gotchas

### 1. Do not skip research for "obvious" tasks
Even seemingly simple tasks benefit from research context. A "simple JWT middleware"
can involve 15+ design decisions (algorithm, key rotation, claim validation, error
format, refresh strategy). Research surfaces these upfront.

### 2. Cache the research output immediately
```bash
# After research completes, cache it for all downstream agents
# gemini-create-cache filePath:/tmp/research_output.md \
#   displayName:project-research ttlMinutes:120
```
Without caching, every worker agent that needs context will re-read the full document,
burning tokens and context window space.

### 3. Use follow-up queries instead of new research
The `gemini-research-followup` command queries against the existing research context.
This is dramatically cheaper and faster than launching a new research session. Use it
when a downstream agent needs clarification on a specific point.

### 4. Research can take 10-20 minutes
Do not poll in a tight loop. Check every 60-90 seconds. The Gemini deep research
pipeline runs multiple internal passes, and rushing it produces shallower results.

### 5. Validate citations before trusting
Deep research cites sources, but citations can be stale or misattributed. For
high-stakes decisions, spot-check 3-5 citations manually. This is fast (2-3 minutes)
and catches the occasional hallucinated reference.

### 6. Multiple research passes for complex domains
For truly complex projects, run two research passes:
1. **Broad pass**: "Survey the landscape of X, compare all major approaches"
2. **Deep pass**: "Given that we chose approach Y from the first research, detail the implementation for our specific constraints"

The second pass can reference the first via follow-up queries.

### 7. Research output size matters
Typical output: 3,000-10,000 words. If your output is under 2,000 words, the prompt
was probably too narrow or too vague. If it is over 15,000 words, consider splitting
into multiple focused research sessions.

---

## What Comes Next

The deep research output feeds directly into **[Phase 2: Schema-Driven Task
Decomposition](phase2-schema-decomposition.md)**, where a Tier 3 model converts the
unstructured research into machine-executable JSON task contracts validated against
`schemas/task-blueprint.schema.json`.
