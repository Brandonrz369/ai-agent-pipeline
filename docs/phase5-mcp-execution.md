# Phase 5: MCP Execution + TypeScript Wrappers

**Enable reliable tool execution across all model tiers by wrapping MCP calls in
TypeScript functions -- eliminating JSON-RPC failures that plague budget models.**

Direct JSON-RPC tool calls are the #1 failure mode for Tier 1 models. TypeScript wrappers
convert unreliable JSON-RPC into reliable function calls that any model can generate.

---

## Table of Contents

1. [Why Direct JSON-RPC Fails](#why-direct-json-rpc-fails)
2. [The TypeScript Wrapper Pattern](#the-typescript-wrapper-pattern)
3. [N8n as MCP Client](#n8n-as-mcp-client)
4. [N8n as MCP Server](#n8n-as-mcp-server)
5. [Error Handling and Retry Patterns](#error-handling-and-retry-patterns)
6. [The Distilled Results Pattern](#the-distilled-results-pattern)

---

## Why Direct JSON-RPC Fails

The Model Context Protocol (MCP) uses JSON-RPC for tool calls. When a model needs to
read a file, it generates something like:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "read_file",
    "arguments": {
      "path": "/project/src/auth/middleware.ts"
    }
  },
  "id": 1
}
```

This works reliably with Tier 3 models (Opus, o3) that have been extensively trained
on structured output generation. But Tier 1 models (Haiku, Flash, 4o-mini) frequently
produce:

```
Common Tier 1 failures:
- Missing closing braces: {"jsonrpc": "2.0", "method": "tools/call", "params": {
- Incorrect nesting: arguments placed at the wrong level
- String escaping errors: file paths with special characters break JSON
- Hallucinated parameter names: "file_path" instead of "path"
- Extra fields: model adds "explanation" field that breaks strict parsing
```

The result is a failure-retry loop that burns tokens without making progress:

```
Attempt 1: Malformed JSON → Error
Attempt 2: Still malformed → Error
Attempt 3: Model adds "Let me try again..." preamble → Still fails
...
Task stalls after 10+ retries, $2 in wasted tokens
```

---

## The TypeScript Wrapper Pattern

Instead of asking models to produce JSON-RPC, provide them with a TypeScript module
that wraps every MCP call as a typed function. Models are trained extensively on
TypeScript and produce it with far higher reliability than raw JSON-RPC.

### The Wrapper Module

```typescript
// mcp-wrapper.ts -- provided to agents as execution context
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["./mcp-server.js"] });
const client = new Client({ name: "agent-wrapper", version: "1.0.0" });
await client.connect(transport);

export async function readFile(path: string): Promise<string> {
  const result = await client.callTool({ name: "read_file", arguments: { path } });
  return result.content[0].text;
}

export async function writeFile(path: string, content: string): Promise<void> {
  await client.callTool({ name: "write_file", arguments: { path, content } });
}

export async function queryCache(cacheName: string, question: string): Promise<string> {
  const result = await client.callTool({ name: "gemini_query_cache", arguments: { cacheName, question } });
  return result.content[0].text;
}

export async function executeCommand(cmd: string): Promise<{
  exitCode: number; stdout: string; stderr: string; summary: string;
}> {
  const result = await client.callTool({ name: "execute_command", arguments: { command: cmd } });
  const raw = JSON.parse(result.content[0].text);
  return {
    exitCode: raw.exitCode,
    stdout: raw.stdout.slice(0, 2000),  // Distill: never return 50K lines
    stderr: raw.stderr.slice(0, 2000),
    summary: raw.exitCode === 0
      ? `Command succeeded: ${cmd}`
      : `Command failed (exit ${raw.exitCode}): ${raw.stderr.split('\n')[0]}`
  };
}
```

### How Agents Use It

Instead of generating JSON-RPC, the agent writes a task script:

```typescript
// Agent-generated task execution script
import { readFile, writeFile, queryCache, executeCommand } from './mcp-wrapper';

async function executeTask(): Promise<TaskReport> {
  // Step 1: Get context from knowledge base
  const authPattern = await queryCache('project-kb',
    'What authentication pattern does this codebase use?'
  );

  // Step 2: Read the target file
  const currentCode = await readFile('src/auth/middleware.ts');

  // Step 3: Read the types file for interface definitions
  const types = await readFile('src/auth/types.ts');

  // Step 4: Generate the new implementation
  // (Agent's own reasoning produces the code here)
  const newMiddleware = `
    import { Request, Response, NextFunction } from 'express';
    import * as jose from 'jose';
    // ... implementation based on authPattern and types ...
  `;

  // Step 5: Write the result
  await writeFile('src/auth/middleware.ts', newMiddleware);

  // Step 6: Run tests
  const testResult = await executeCommand('npm test -- auth');

  // Step 7: Return structured report
  return {
    status: testResult.exitCode === 0 ? 'PASS' : 'FAIL',
    files_changed: ['src/auth/middleware.ts'],
    tests_added: ['tests/auth/middleware.test.ts'],
    test_result: testResult.summary,
    issues_found: testResult.exitCode !== 0
      ? [testResult.stderr]
      : []
  };
}
```

**Why this is more reliable:**
- TypeScript function calls have typed signatures -- the model knows exactly what arguments to provide
- No nested JSON to mess up -- just function calls with string/array arguments
- Models are trained on vastly more TypeScript than JSON-RPC
- IDE-style autocomplete in the prompt (if you list the function signatures)
- Error handling is in the wrapper, not in the model's output

---

## N8n as MCP Client

N8n can connect to MCP servers and expose their tools to agent sub-workflows. This
centralizes tool access and applies security policies before any tool call executes.

### Server Connections

```javascript
// N8n MCP Client configuration -- each provides tools to agent workflows
const mcpServers = {
  filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"] },
  bash:       { command: "docker", args: ["run", "--rm", "--read-only", "-v", "/project:/workspace", "mcp-bash-server:pinned"] },
  github:     { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } },
  knowledge:  { command: "npx", args: ["-y", "@anthropic/gemini-mcp-server"], env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY } },
  search:     { command: "npx", args: ["-y", "@anthropic/brave-search-mcp-server"], env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY } }
};
```

### Security Layer Between N8n and MCP

N8n applies RBAC checks (see [Phase 6](phase6-security.md)) before forwarding any tool
call to the MCP server:

```javascript
// N8n Function Node: RBAC Check
function checkPermission(nodeId, toolName, args) {
  const rbac = loadConfig('security/rbac-config.yaml');
  const nodePerms = rbac.nodes[nodeId];

  // Check write scope
  if (toolName === 'write_file') {
    const targetPath = args.path;
    const allowed = nodePerms.write.some(scope =>
      targetPath.startsWith(scope)
    );
    if (!allowed) {
      throw new Error(
        `RBAC DENIED: Node ${nodeId} cannot write to ${targetPath}`
      );
    }
  }

  // Check forbidden patterns
  if (nodePerms.forbidden) {
    const forbidden = nodePerms.forbidden.some(pattern =>
      matchGlob(args.path || args.command, pattern)
    );
    if (forbidden) {
      throw new Error(
        `RBAC DENIED: Node ${nodeId} attempted forbidden action`
      );
    }
  }

  return true;  // Allowed
}
```

---

## N8n as MCP Server

N8n can also expose its own workflows as MCP tools, making complex multi-step
operations available as simple function calls to agents.

### Example: Project Ticket Creation

Without MCP server exposure, an agent would need to:
1. Authenticate to Jira
2. Create an epic
3. Set dependencies
4. Link to a GitHub milestone
5. Send a Slack notification

With N8n as MCP server:

```typescript
// What the agent calls:
await callTool("create_project_ticket", {
  title: "Implement auth middleware",
  description: "JWT validation with RS256",
  priority: "P1"
});

// What N8n actually executes (hidden from the agent):
// 1. Authenticate to Jira via stored credentials
// 2. Create epic with proper fields
// 3. Set dependency links from config
// 4. Create GitHub milestone via API
// 5. Post to Slack #engineering channel
// 6. Return ticket ID to agent
```

The N8n MCP Server Trigger node configuration exposes the workflow with a JSON Schema
`inputSchema` (title, description, priority). The agent does not need credentials,
does not need to know the Jira API, and cannot accidentally misconfigure the integration.

---

## Error Handling and Retry Patterns

### Wrapper-Level Retries with Timeout

The TypeScript wrapper handles transient failures internally with exponential backoff
and per-call timeouts, so the agent never sees network blips:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>, retries = 3, delayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error('Unreachable');
}

async function withTimeout<T>(fn: () => Promise<T>, ms = 30000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
  ]);
}

// Combined: every wrapper function uses retry + timeout
export async function readFile(path: string): Promise<string> {
  return withRetry(() => withTimeout(() =>
    client.callTool({ name: "read_file", arguments: { path } })
      .then(r => r.content[0].text)
  ));
}
```

### Structured Error Reporting

Unrecoverable errors are captured in the task report, not swallowed silently:

```typescript
try {
  const testResult = await executeCommand('npm test -- auth');
} catch (error) {
  report.errors.push({ step: 'run_tests', error: error.message, recoverable: false });
  report.status = 'FAIL';
}
```

---

## The Distilled Results Pattern

This is one of the most important architectural decisions in the pipeline. Raw tool
output must NEVER be returned directly to a model's context.

### The Problem

A `npm test` run on a large project produces 2,000+ lines of output. If that raw
output goes back into the model's context:

1. **Token cost**: 2,000 lines * ~20 tokens/line = 40K tokens burned on test output
2. **Context pollution**: Important information drowns in noise
3. **Hallucination risk**: Model may misinterpret verbose output as instructions
4. **Context overflow**: Repeated tool calls accumulate, eventually exceeding the window

### The Solution

The wrapper distills every result before returning it to the model:

```typescript
// BAD: Raw output returned to model
const testOutput = await executeCommand('npm test');
// Returns 2,000 lines of TAP output, coverage tables, timing data...

// GOOD: Distilled result returned to model
const testResult = await executeCommand('npm test -- auth');
// Returns: { exitCode: 0, summary: "12 tests passed, 0 failed", ... }
```

### Distillation Examples

| Tool | Raw Output | Distilled Result |
|------|-----------|-----------------|
| `npm test` | 2000+ lines of TAP/Jest output | `{ passed: 12, failed: 0, summary: "All auth tests pass" }` |
| `read_file` (large) | 500-line source file | Relevant section only (if agent specified a query) |
| `git log` | Full commit history | Last 5 commits with messages |
| `executeCommand('ls -la')` | Full directory listing | File count + relevant matches |
| Web search | Full page HTML | Extracted answer paragraphs |

### When to Return Full Output

Sometimes the full output IS the goal (e.g., reading a file to edit it). The distillation
rule is:

- **Full output**: When the agent needs to process the content itself (reading a file to modify it)
- **Distilled output**: When the agent needs to make a decision based on the result (did tests pass? does the file exist? what error occurred?)

```typescript
// Full output: agent needs the file content to edit
const fileContent = await readFile('src/auth/middleware.ts');
// Returns: full file content (needed for editing)

// Distilled output: agent needs to know if tests passed
const testResult = await runTests('auth');
// Returns: { passed: true, summary: "12/12 passed" }
// Does NOT return: 2000 lines of Jest output
```

---

## What Comes Next

Reliable execution is only safe if the system prevents misuse. [Phase 6: Security
& Governance](phase6-security.md) covers the threat model, containerized sandboxing,
RBAC enforcement, and the audit trail that ensures every tool call is authorized
and logged.
