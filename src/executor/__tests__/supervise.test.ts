/**
 * SUPERVISE Mode Tests -- T27 (Charlie)
 *
 * Tests:
 *  1. SUPERVISE mode routes to the supervise handler
 *  2. Safety: payment page detection
 *  3. Safety: URL allowlist enforcement
 *  4. Max-actions limit
 *  5. Context offloading trigger at 5-action intervals
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runSuperviseSession,
  StubComputerUseProvider,
  detectPaymentPage,
  isUrlAllowed,
} from '../supervise.js';
import { ClaudeCodeExecutor } from '../index.js';
import type { TaskBlueprint, TaskEnvelope, ScreenshotAction } from '../../types/index.js';

function makeTask(overrides: Partial<TaskBlueprint> = {}): TaskBlueprint {
  return { task_id: 'TEST-SUPERVISE-001', metadata: { project: 'test', node: 1, workstream: 'gui-automation', batch: 1, priority: 'P2', tier: 3 }, task: { type: 'EXECUTE', objective: 'Click the submit button and verify the form was submitted.', instructions: ['Take a screenshot', 'Click the submit button'] }, output: { report_file: 'reports/test.json', status_options: ['PASS', 'FAIL'] }, constraints: { requires_human_approval: false }, ...overrides };
}

function makeEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return { id: 'env-sup-001', ttl_max: 5, hops: 0, mode: 'SUPERVISE', state_hashes: [], consecutive_failures: 0, consecutive_successes: 0, escalated: false, session_ids: [], created_at: new Date().toISOString(), ...overrides };
}

describe('detectPaymentPage', () => {
  it('returns true for payment keywords', () => {
    expect(detectPaymentPage('Please enter your credit card number')).toBe(true);
    expect(detectPaymentPage('Checkout now')).toBe(true);
    expect(detectPaymentPage('Buy now for $9.99')).toBe(true);
    expect(detectPaymentPage('Pay now to continue')).toBe(true);
  });
  it('returns false for safe content', () => {
    expect(detectPaymentPage('Click the submit button')).toBe(false);
    expect(detectPaymentPage('Enter your username and password')).toBe(false);
    expect(detectPaymentPage('Dashboard overview')).toBe(false);
  });
});

describe('isUrlAllowed', () => {
  it('rejects all URLs when allowlist is empty', () => {
    expect(isUrlAllowed('https://example.com', [])).toBe(false);
    expect(isUrlAllowed('http://anything.com', [])).toBe(false);
  });
  it('allows matching hostname', () => {
    expect(isUrlAllowed('https://example.com/path', ['https://example.com'])).toBe(true);
    expect(isUrlAllowed('https://sub.example.com', ['https://example.com'])).toBe(true);
  });
  it('rejects non-matching hostname', () => {
    expect(isUrlAllowed('https://evil.com', ['https://example.com'])).toBe(false);
  });
});

describe('runSuperviseSession', () => {
  let provider: StubComputerUseProvider;
  beforeEach(() => { provider = new StubComputerUseProvider(); });

  it('aborts with FAIL when hitlApproved is false', async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    const result = await runSuperviseSession(task, envelope, { provider, config: { hitlApproved: false, maxActions: 10, contextOffloadEvery: 5, urlAllowlist: [] } });
    expect(result.status).toBe('FAIL');
    expect(result.screenshots_taken).toBe(0);
    expect(result.issues.some((i) => i.includes('HITL-013'))).toBe(true);
    expect(provider.callCount('screenshot')).toBe(0);
  });

  it('completes with PASS when analyzeScreenshot returns null on first call', async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    const result = await runSuperviseSession(task, envelope, {
      provider,
      config: { hitlApproved: true, maxActions: 10, contextOffloadEvery: 5, urlAllowlist: [] },
      analyzeScreenshot: async () => null,
    });
    expect(result.status).toBe('PASS');
    expect(result.screenshots_taken).toBeGreaterThan(0);
    expect(result.actions_performed).toBe(0);
  });

  it('stops with STUCK when payment page is detected', async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    let callCount = 0;
    const result = await runSuperviseSession(task, envelope, {
      provider,
      config: { hitlApproved: true, maxActions: 10, contextOffloadEvery: 5, urlAllowlist: [] },
      analyzeScreenshot: async () => {
        callCount++;
        return { type: 'click' as const, x: 100, y: 200, description: 'Click the checkout button on billing page' };
      },
    });
    expect(result.status).toBe('STUCK');
    expect(result.issues.some((i) => i.includes('SAFETY') && i.includes('Payment page'))).toBe(true);
  });

  it('stops with STUCK when URL is not on allowlist', async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    const result = await runSuperviseSession(task, envelope, {
      provider,
      config: { hitlApproved: true, maxActions: 10, contextOffloadEvery: 5, urlAllowlist: [] },
      analyzeScreenshot: async () => {
        return { type: 'click' as const, x: 100, y: 200, text: 'https://evil.com/malicious', description: 'Navigate to external page' };
      },
    });
    expect(result.status).toBe('STUCK');
    expect(result.issues.some((i) => i.includes('allowlist'))).toBe(true);
  });

  it('stops with STUCK when max-actions limit is reached', async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    const result = await runSuperviseSession(task, envelope, {
      provider,
      config: { hitlApproved: true, maxActions: 3, contextOffloadEvery: 5, urlAllowlist: [] },
      analyzeScreenshot: async () => ({ type: 'click' as const, x: 10, y: 10, description: 'safe click' }),
    });
    expect(result.status).toBe('STUCK');
    expect(result.actions_performed).toBe(3);
    expect(result.issues.some((i) => i.includes('Max-actions'))).toBe(true);
  });

  it('offloads context every contextOffloadEvery actions', async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    const offloadedKeys: string[] = [];
    let actionCount = 0;
    const result = await runSuperviseSession(task, envelope, {
      provider,
      config: { hitlApproved: true, maxActions: 15, contextOffloadEvery: 5, urlAllowlist: [] },
      contextOffloadFn: async (key: string) => { offloadedKeys.push(key); },
      analyzeScreenshot: async () => {
        actionCount++;
        if (actionCount > 12) return null;
        return { type: 'click' as const, x: 10, y: 10, description: 'safe action' };
      },
    });
    expect(result.context_offloads).toBeGreaterThanOrEqual(2);
    expect(offloadedKeys.length).toBeGreaterThanOrEqual(2);
    expect(offloadedKeys[0]).toContain('supervise-TEST-SUPERVISE-001-offload-1');
  });
});

describe('ClaudeCodeExecutor SUPERVISE routing', () => {
  it('returns FAIL when no provider is configured', async () => {
    const executor = new ClaudeCodeExecutor();
    const task = makeTask();
    const envelope = makeEnvelope({ mode: 'SUPERVISE' });
    const { output } = await executor.execute(task, envelope);
    expect(output.status).toBe('FAIL');
    expect(output.summary).toContain('no ComputerUseProvider');
  });

  it('routes to supervise handler when mode is SUPERVISE and provider is set', async () => {
    const provider = new StubComputerUseProvider();
    const executor = new ClaudeCodeExecutor({
      superviseOptions: {
        provider,
        config: { hitlApproved: true, maxActions: 2, contextOffloadEvery: 5, urlAllowlist: [] },
        analyzeScreenshot: async () => null,
      },
    });
    const task = makeTask();
    const envelope = makeEnvelope({ mode: 'SUPERVISE' });
    const { output } = await executor.execute(task, envelope);
    expect(output.status).toBe('PASS');
    expect(provider.callCount('screenshot')).toBeGreaterThan(0);
  });
});
