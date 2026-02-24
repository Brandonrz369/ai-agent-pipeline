/**
 * Integration Test Suite — T04 (Charlie)
 *
 * Tests the full completion loop: classify → format → execute → verify → anti-loop → audit
 * All external dependencies (Gemini API, Claude CLI) are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AntiLoopEngine } from '../anti-loop/index.js';
import { classifyTask, type ClassificationResult } from '../orchestrator/classifier.js';
import { formatPromptForMode } from '../orchestrator/prompt-formatter.js';
import { FlashLiteVerifier } from '../verifier/index.js';
import { ClaudeCodeExecutor } from '../executor/index.js';
import { logAuditEntry, verifyAuditEntry, readAuditLog } from '../audit/index.js';
import { routeTask, routeBatch } from '../router/index.js';
import type {
  TaskBlueprint,
  TaskEnvelope,
  ClaudeOutput,
  PromptMode,
} from '../types/index.js';

// ─── Test Fixtures ──────────────────────────────────────────────

function makeTask(overrides: Partial<TaskBlueprint> = {}): TaskBlueprint {
  return {
    task_id: 'TEST-2026-001-B1-N1',
    metadata: {
      project: 'test-project',
      node: 1,
      workstream: 'test-stream',
      batch: 1,
      priority: 'P2',
      tier: 2,
    },
    task: {
      type: 'CREATE',
      target_file: 'src/test-output.ts',
      objective: 'Create a hello world module with export',
      instructions: [
        'Create src/test-output.ts',
        'Export a function helloWorld() returning "Hello, World!"',
        'Run tests to verify',
      ],
      dependencies: [],
      mcp_tools_required: ['filesystem', 'bash'],
      context_queries: [],
    },
    output: {
      report_file: 'reports/n1_test.md',
      status_options: ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED'],
    },
    constraints: {
      write_scope: ['src/'],
      read_scope: ['src/', 'docs/'],
      forbidden: ['node_modules/', '.env'],
    },
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    id: 'env-test-001',
    task_id_ref: 'TEST-2026-001-B1-N1',
    ttl_max: 10,
    hops: 0,
    mode: 'EXECUTE' as PromptMode,
    state_hashes: [],
    consecutive_failures: 0,
    consecutive_successes: 0,
    escalated: false,
    session_ids: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaudeOutput(overrides: Partial<ClaudeOutput> = {}): ClaudeOutput {
  return {
    task_id: 'TEST-2026-001-B1-N1',
    status: 'PASS',
    summary: 'Created hello world module. All tests pass.',
    report_file: 'reports/n1_test.md',
    ...overrides,
  };
}

// ─── Mocks ──────────────────────────────────────────────────────

// Mock child_process.spawn for Claude CLI
vi.mock('node:child_process', () => {
  const EventEmitter = require('node:events');
  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();

      // Simulate successful Claude response
      setTimeout(() => {
        const response = JSON.stringify({
          task_id: 'TEST-2026-001-B1-N1',
          status: 'PASS',
          summary: 'Task completed successfully',
          report_file: 'reports/n1_test.md',
        });
        proc.stdout.emit('data', Buffer.from(response));
        proc.emit('close', 0);
      }, 10);

      return proc;
    }),
  };
});

// Mock AntigravityClient — the verifier and classifier now use this instead of @google/genai
vi.mock('../utils/antigravity-client.js', () => {
  return {
    AntigravityClient: vi.fn().mockImplementation(() => ({
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          verdict: 'PASS',
          reasoning: 'Objective clearly met — module created, tests pass',
          issues: [],
        }),
      }),
    })),
    getAntigravityClient: vi.fn(() => ({
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          verdict: 'PASS',
          reasoning: 'Objective clearly met',
          issues: [],
        }),
      }),
    })),
  };
});

// ─── Tests ──────────────────────────────────────────────────────

describe('Integration: Task Classification', () => {
  it('should classify a CREATE task as code/EXECUTE/tier 2 via rules', async () => {
    const task = makeTask();
    const result = await classifyTask(task);

    expect(result.taskType).toBe('code');
    expect(result.promptMode).toBe('EXECUTE');
    expect(result.tier).toBe(2);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('should classify a GUI task as SUPERVISE mode', async () => {
    const task = makeTask({
      task: {
        type: 'EXECUTE',
        objective: 'Install Discord app via GUI wizard and navigate setup',
        instructions: ['Click through installer', 'Screenshot each step'],
        mcp_tools_required: ['computer_use'],
      },
    });
    const result = await classifyTask(task);

    expect(result.taskType).toBe('gui');
    expect(result.promptMode).toBe('SUPERVISE');
  });

  it('should classify a RESEARCH task as tier 3', async () => {
    const task = makeTask({
      task: {
        type: 'RESEARCH',
        objective: 'Deep dive research into authentication patterns',
        instructions: ['Investigate OAuth vs JWT', 'Analyze tradeoffs'],
      },
    });
    const result = await classifyTask(task);

    expect(result.taskType).toBe('research');
    expect(result.tier).toBe(3);
  });

  it('should classify a REVIEW task as tier 1', async () => {
    const task = makeTask({
      task: {
        type: 'REVIEW',
        objective: 'Check all files for consistency',
        instructions: ['Read each file', 'List issues found'],
      },
    });
    const result = await classifyTask(task);

    expect(result.taskType).toBe('simple_tool');
    expect(result.tier).toBe(1);
  });

  it('should use explicit tier from metadata when rules dont match', async () => {
    const task = makeTask({
      task: {
        type: 'EXECUTE',
        objective: 'Do something ambiguous',
        instructions: ['Step one', 'Step two'],
      },
      metadata: {
        project: 'test',
        node: 1,
        workstream: 'test',
        batch: 1,
        priority: 'P1',
        tier: 3,
      },
    });
    const result = await classifyTask(task);

    expect(result.tier).toBe(3);
    expect(result.confidence).toBe(1.0);
  });
});

describe('Integration: Prompt Formatting', () => {
  it('should format an EXECUTE mode prompt with task variables', async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    const prompt = await formatPromptForMode(task, envelope);

    expect(prompt).toContain('TEST-2026-001-B1-N1');
    expect(prompt).toContain('hello world');
    expect(prompt).toContain('EXECUTE');
    expect(prompt).toContain('INJECTION DEFENSE');
  });

  it('should format an ARCHITECT mode prompt', async () => {
    const task = makeTask();
    const envelope = makeEnvelope({ mode: 'ARCHITECT', escalated: true });
    const prompt = await formatPromptForMode(task, envelope);

    expect(prompt).toContain('ARCHITECT');
    expect(prompt).toContain('TEST-2026-001-B1-N1');
  });

  it('should include TTL remaining in prompt', async () => {
    const task = makeTask();
    const envelope = makeEnvelope({ hops: 3, ttl_max: 10 });
    const prompt = await formatPromptForMode(task, envelope);

    // Should reference 7 remaining or 3/10
    expect(prompt).toMatch(/7|3\/10|3.*10/);
  });
});

describe('Integration: Anti-Loop Engine', () => {
  let engine: AntiLoopEngine;

  beforeEach(() => {
    engine = new AntiLoopEngine({ ttlMax: 5 });
  });

  it('should create envelope with custom TTL', () => {
    const env = engine.createEnvelope('task-1', 'TEST-001');
    expect(env.ttl_max).toBe(5);
    expect(env.mode).toBe('EXECUTE');
    expect(env.task_id_ref).toBe('TEST-001');
  });

  it('should allow pre-hop and increment', () => {
    const env = makeEnvelope({ hops: 2, ttl_max: 5 });
    const result = engine.preHopCheck(env);
    expect(result.allowed).toBe(true);
    expect(result.envelope.hops).toBe(3);
  });

  it('should block when TTL expired', () => {
    const env = makeEnvelope({ hops: 5, ttl_max: 5 });
    const result = engine.preHopCheck(env);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('should escalate to ARCHITECT after 3 failures', async () => {
    const env = makeEnvelope({ consecutive_failures: 2, mode: 'EXECUTE' });
    const result = await engine.postHopUpdate(env, 'RETRY');
    expect(result.envelope.mode).toBe('ARCHITECT');
    expect(result.envelope.escalated).toBe(true);
    expect(result.modeChanged).toBe(true);
  });

  it('should de-escalate after 2 successes in ARCHITECT', async () => {
    const env = makeEnvelope({
      consecutive_successes: 1,
      mode: 'ARCHITECT',
      escalated: true,
    });
    const result = await engine.postHopUpdate(env, 'PASS');
    expect(result.envelope.mode).toBe('EXECUTE');
    expect(result.envelope.escalated).toBe(false);
    expect(result.modeChanged).toBe(true);
  });

  it('should NOT de-escalate after only 1 success', async () => {
    const env = makeEnvelope({
      consecutive_successes: 0,
      mode: 'ARCHITECT',
      escalated: true,
    });
    const result = await engine.postHopUpdate(env, 'PASS');
    expect(result.envelope.mode).toBe('ARCHITECT');
    expect(result.envelope.escalated).toBe(true);
  });

  it('should reset failure counter on success', async () => {
    const env = makeEnvelope({ consecutive_failures: 2, mode: 'EXECUTE' });
    const result = await engine.postHopUpdate(env, 'PASS');
    expect(result.envelope.consecutive_failures).toBe(0);
    expect(result.envelope.consecutive_successes).toBe(1);
  });

  it('should dead-letter on ESCALATE verdict after TTL check', async () => {
    // ESCALATE increments failures; once at TTL boundary → dead-letter
    const env = makeEnvelope({ hops: 5, ttl_max: 5 });
    const result = await engine.postHopUpdate(env, 'ESCALATE');
    expect(result.deadLettered).toBe(true);
  });
});

describe('Integration: Full Completion Loop (mocked)', () => {
  it('should run classify → format → execute → verify → pass on first hop', async () => {
    const task = makeTask();
    const engine = new AntiLoopEngine({ ttlMax: 10 });
    const envelope = engine.createEnvelope(task.task_id, task.task_id);

    // Step 1: CLASSIFY
    const classification = await classifyTask(task);
    expect(classification.promptMode).toBe('EXECUTE');

    // Step 2: PRE-HOP CHECK
    const preHop = engine.preHopCheck(envelope);
    expect(preHop.allowed).toBe(true);

    // Step 3: FORMAT prompt
    const prompt = await formatPromptForMode(task, preHop.envelope);
    expect(prompt.length).toBeGreaterThan(100);

    // Step 4: EXECUTE (mocked — Claude CLI returns PASS)
    const executor = new ClaudeCodeExecutor({ cwd: '/tmp' });
    const { output } = await executor.execute(task, preHop.envelope);
    expect(output.status).toBe('PASS');

    // Step 5: VERIFY (mocked — Flash-Lite returns PASS)
    const verifier = new FlashLiteVerifier('mock-api-key');
    const verification = await verifier.verify(task, output);
    expect(verification.verdict).toBe('PASS');

    // Step 6: POST-HOP (should NOT escalate on PASS)
    const postHop = await engine.postHopUpdate(preHop.envelope, 'PASS');
    expect(postHop.deadLettered).toBe(false);
    expect(postHop.modeChanged).toBe(false);
  });

  it('should escalate to ARCHITECT after 3 consecutive RETRY verdicts', async () => {
    const task = makeTask();
    const engine = new AntiLoopEngine({ ttlMax: 10 });
    let envelope = engine.createEnvelope(task.task_id, task.task_id);

    // Simulate 3 RETRY hops
    for (let i = 0; i < 3; i++) {
      const preHop = engine.preHopCheck(envelope);
      expect(preHop.allowed).toBe(true);
      const postHop = await engine.postHopUpdate(preHop.envelope, 'RETRY');
      envelope = postHop.envelope;
    }

    // After 3 failures, should be in ARCHITECT mode
    // Note: hysteresis resets consecutive_failures to 0 upon escalation
    expect(envelope.mode).toBe('ARCHITECT');
    expect(envelope.escalated).toBe(true);
    expect(envelope.consecutive_failures).toBe(0);
    expect(envelope.hops).toBe(3);
  });

  it('should dead-letter after TTL exhaustion', async () => {
    const task = makeTask();
    const engine = new AntiLoopEngine({ ttlMax: 3 });
    let envelope = engine.createEnvelope(task.task_id, task.task_id);
    // Override ttl_max
    envelope.ttl_max = 3;

    // Exhaust all 3 hops
    for (let i = 0; i < 3; i++) {
      const preHop = engine.preHopCheck(envelope);
      if (!preHop.allowed) break;
      const postHop = await engine.postHopUpdate(preHop.envelope, 'RETRY');
      envelope = postHop.envelope;
    }

    // 4th attempt should be blocked
    const finalCheck = engine.preHopCheck(envelope);
    expect(finalCheck.allowed).toBe(false);
  });

  it('should de-escalate from ARCHITECT back to EXECUTE after 2 PASS verdicts', async () => {
    const task = makeTask();
    const engine = new AntiLoopEngine({ ttlMax: 10 });
    let envelope = makeEnvelope({
      mode: 'ARCHITECT',
      escalated: true,
      consecutive_failures: 0,
      consecutive_successes: 0,
      hops: 4,
    });

    // First PASS
    let postHop = await engine.postHopUpdate(envelope, 'PASS');
    envelope = postHop.envelope;
    expect(envelope.mode).toBe('ARCHITECT'); // Still ARCHITECT after 1 success

    // Second PASS
    postHop = await engine.postHopUpdate(envelope, 'PASS');
    envelope = postHop.envelope;
    expect(envelope.mode).toBe('EXECUTE'); // De-escalated
    expect(envelope.escalated).toBe(false);
  });
});

describe('Integration: Task Routing', () => {
  it('should route a CREATE task to tier 2', () => {
    const task = makeTask();
    const decision = routeTask(task);
    expect(decision.tier).toBe(2);
  });

  it('should route a RESEARCH task to tier 3', () => {
    const task = makeTask({
      task: {
        type: 'RESEARCH',
        objective: 'Research auth patterns',
        instructions: ['Investigate'],
      },
    });
    // Remove explicit tier so router falls through to type-based routing
    delete (task.metadata as Record<string, unknown>).tier;
    const decision = routeTask(task);
    expect(decision.tier).toBe(3);
  });

  it('should route a REVIEW task to tier 1', () => {
    const task = makeTask({
      task: {
        type: 'REVIEW',
        objective: 'Check file consistency',
        instructions: ['Read and validate'],
      },
    });
    // Remove tier so router falls through to type-based routing
    delete (task.metadata as Record<string, unknown>).tier;
    const decision = routeTask(task);
    expect(decision.tier).toBe(1);
  });

  it('should respect explicit tier in metadata', () => {
    const task = makeTask({
      metadata: {
        project: 'test',
        node: 1,
        workstream: 'test',
        batch: 1,
        priority: 'P1',
        tier: 3,
      },
    });
    const decision = routeTask(task);
    expect(decision.tier).toBe(3);
  });

  it('should route a batch and return decisions for all tasks', () => {
    const t1 = makeTask({ task_id: 'T1' });
    const t2 = makeTask({
      task_id: 'T2',
      task: { type: 'RESEARCH', objective: 'Research', instructions: ['Go'] },
    });
    const t3 = makeTask({
      task_id: 'T3',
      task: { type: 'REVIEW', objective: 'Review', instructions: ['Check'] },
    });
    // Remove tier from t2 and t3 so type-based routing works
    delete (t2.metadata as Record<string, unknown>).tier;
    delete (t3.metadata as Record<string, unknown>).tier;

    const decisions = routeBatch([t1, t2, t3]);
    expect(decisions).toHaveLength(3);
    expect(decisions[0].tier).toBe(2); // CREATE → tier 2 (metadata.tier=2)
    expect(decisions[1].tier).toBe(3); // RESEARCH → tier 3 (type routing)
    expect(decisions[2].tier).toBe(1); // REVIEW → tier 1 (type routing)
  });
});

describe('Integration: Verifier (mocked Gemini)', () => {
  it('should return PASS when Gemini says PASS', async () => {
    const task = makeTask();
    const output = makeClaudeOutput({ status: 'PASS' });
    const verifier = new FlashLiteVerifier('mock-key');
    const result = await verifier.verify(task, output);

    expect(result.verdict).toBe('PASS');
    expect(result.issues).toHaveLength(0);
  });

  it('should handle FAIL output gracefully', async () => {
    const task = makeTask();
    const output = makeClaudeOutput({ status: 'FAIL', summary: 'Tests failed: 3 errors' });
    const verifier = new FlashLiteVerifier('mock-key');
    const result = await verifier.verify(task, output);

    // Mock always returns PASS in our setup, but the call should succeed
    expect(result.verdict).toBeDefined();
    expect(['PASS', 'RETRY', 'ESCALATE']).toContain(result.verdict);
  });
});

describe('Integration: Audit Trail', () => {
  it('should log an audit entry with HMAC', async () => {
    const entry = await logAuditEntry(
      'INTEGRATION_TEST',
      { component: 'integration-test', hop: 1 },
      'TEST-001',
      1,
    );

    expect(entry.action).toBe('INTEGRATION_TEST');
    expect(entry.task_id).toBe('TEST-001');
    expect(entry.hmac).toBeDefined();
    expect(entry.hmac.length).toBe(64); // SHA-256 hex
  });

  it('should verify a valid audit entry', async () => {
    const entry = await logAuditEntry(
      'VERIFY_TEST',
      { test: true },
      'TEST-002',
    );
    const valid = await verifyAuditEntry(entry);
    expect(valid).toBe(true);
  });

  it('should detect tampered audit entry', async () => {
    const entry = await logAuditEntry(
      'TAMPER_TEST',
      { original: true },
      'TEST-003',
    );

    // Tamper with the entry
    const tampered = { ...entry, details: { original: false } };
    const valid = await verifyAuditEntry(tampered);
    expect(valid).toBe(false);
  });

  it('should read audit log for today', async () => {
    // We already wrote entries above
    const entries = await readAuditLog();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[entries.length - 1].action).toBeDefined();
  });
});

describe('Integration: Executor (mocked Claude CLI)', () => {
  it('should spawn Claude and parse JSON output', async () => {
    const task = makeTask();
    const envelope = makeEnvelope({ hops: 1 });
    const executor = new ClaudeCodeExecutor({ cwd: '/tmp' });

    const { result, output } = await executor.execute(task, envelope);

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(output.status).toBe('PASS');
    expect(output.task_id).toBe('TEST-2026-001-B1-N1');
  });

  it('should format prompt with task variables', async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    const executor = new ClaudeCodeExecutor();

    const prompt = await executor.formatPrompt(task, envelope);
    expect(prompt).toContain('TEST-2026-001-B1-N1');
    expect(prompt).toContain('hello world');
  });

  it('should remove CLAUDECODE env var to allow nested sessions', async () => {
    // Simulate running inside a Claude Code session
    process.env.CLAUDECODE = '1';
    const { spawn: mockSpawn } = await import('node:child_process');
    const task = makeTask();
    const envelope = makeEnvelope({ hops: 1 });
    const executor = new ClaudeCodeExecutor({ cwd: '/tmp' });

    await executor.execute(task, envelope);

    // Verify spawn was called and check the env
    expect(mockSpawn).toHaveBeenCalled();
    const spawnCall = (mockSpawn as ReturnType<typeof vi.fn>).mock.calls[
      (mockSpawn as ReturnType<typeof vi.fn>).mock.calls.length - 1
    ];
    const spawnOpts = spawnCall[2];
    // CLAUDECODE should NOT be in the child env
    expect(spawnOpts.env?.CLAUDECODE).toBeUndefined();

    delete process.env.CLAUDECODE;
  });

  it('should use ignore for stdin to prevent Claude from hanging', async () => {
    const { spawn: mockSpawn } = await import('node:child_process');
    const task = makeTask();
    const envelope = makeEnvelope({ hops: 1 });
    const executor = new ClaudeCodeExecutor({ cwd: '/tmp' });

    await executor.execute(task, envelope);

    const spawnCall = (mockSpawn as ReturnType<typeof vi.fn>).mock.calls[
      (mockSpawn as ReturnType<typeof vi.fn>).mock.calls.length - 1
    ];
    const spawnOpts = spawnCall[2];
    // stdin must be 'ignore' to prevent hanging
    expect(spawnOpts.stdio).toBeDefined();
    expect(spawnOpts.stdio[0]).toBe('ignore');
  });
});

describe('Integration: End-to-End Pipeline Flow', () => {
  it('should process a task from classification through audit logging', async () => {
    const task = makeTask();
    const engine = new AntiLoopEngine({ ttlMax: 10 });

    // 1. Create envelope
    const envelope = engine.createEnvelope(task.task_id, task.task_id);

    // 2. Classify
    const classification = await classifyTask(task);
    expect(classification.promptMode).toBe('EXECUTE');

    // 3. Route
    const routing = routeTask(task);
    expect(routing.tier).toBe(2);

    // 4. Pre-hop check
    const preHop = engine.preHopCheck(envelope);
    expect(preHop.allowed).toBe(true);

    // 5. Format prompt
    const prompt = await formatPromptForMode(task, preHop.envelope);
    expect(prompt).toBeTruthy();

    // 6. Execute (mocked)
    const executor = new ClaudeCodeExecutor({ cwd: '/tmp' });
    const { output } = await executor.execute(task, preHop.envelope);
    expect(output.status).toBe('PASS');

    // 7. Verify (mocked)
    const verifier = new FlashLiteVerifier('mock-key');
    const verification = await verifier.verify(task, output);
    expect(verification.verdict).toBe('PASS');

    // 8. Post-hop
    const postHop = await engine.postHopUpdate(preHop.envelope, verification.verdict);
    expect(postHop.deadLettered).toBe(false);

    // 9. Audit log
    const auditEntry = await logAuditEntry(
      'PIPELINE_TASK_PASS',
      {
        task_id: task.task_id,
        classification: classification.taskType,
        tier: routing.tier,
        hops: preHop.envelope.hops,
        mode: preHop.envelope.mode,
        verdict: verification.verdict,
      },
      task.task_id,
      task.metadata.node,
    );
    expect(auditEntry.action).toBe('PIPELINE_TASK_PASS');
    expect(auditEntry.hmac).toBeDefined();

    // 10. Verify audit integrity
    const valid = await verifyAuditEntry(auditEntry);
    expect(valid).toBe(true);
  });
});
