import { describe, it, expect } from 'vitest';
import { checkTTL, incrementHop } from '../ttl.js';
import { applyHysteresis } from '../hysteresis.js';
import { checkBackflow, recordStateHash } from '../backflow.js';
import { AntiLoopEngine } from '../index.js';
import type { TaskEnvelope } from '../../types/index.js';

function makeEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    id: 'test-envelope',
    ttl_max: 10,
    hops: 0,
    mode: 'EXECUTE',
    state_hashes: [],
    consecutive_failures: 0,
    consecutive_successes: 0,
    escalated: false,
    session_ids: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('TTL', () => {
  it('should not be expired when hops < ttl_max', () => {
    const env = makeEnvelope({ hops: 5, ttl_max: 10 });
    const result = checkTTL(env);
    expect(result.expired).toBe(false);
    expect(result.hopsRemaining).toBe(5);
  });

  it('should be expired when hops >= ttl_max', () => {
    const env = makeEnvelope({ hops: 10, ttl_max: 10 });
    const result = checkTTL(env);
    expect(result.expired).toBe(true);
    expect(result.hopsRemaining).toBe(0);
  });

  it('should increment hop count', () => {
    const env = makeEnvelope({ hops: 3 });
    const result = incrementHop(env);
    expect(result.hops).toBe(4);
    expect(result.last_hop_at).toBeDefined();
  });
});

describe('Hysteresis', () => {
  it('should escalate to ARCHITECT after 3 consecutive failures', () => {
    const env = makeEnvelope({ consecutive_failures: 2, mode: 'EXECUTE' });
    const result = applyHysteresis(env, 'RETRY');
    expect(result.envelope.mode).toBe('ARCHITECT');
    expect(result.envelope.escalated).toBe(true);
    expect(result.modeChanged).toBe(true);
  });

  it('should not escalate before 3 failures', () => {
    const env = makeEnvelope({ consecutive_failures: 1, mode: 'EXECUTE' });
    const result = applyHysteresis(env, 'RETRY');
    expect(result.envelope.mode).toBe('EXECUTE');
    expect(result.modeChanged).toBe(false);
  });

  it('should de-escalate after 2 consecutive successes in ARCHITECT', () => {
    const env = makeEnvelope({
      consecutive_successes: 1,
      mode: 'ARCHITECT',
      escalated: true,
    });
    const result = applyHysteresis(env, 'PASS');
    expect(result.envelope.mode).toBe('EXECUTE');
    expect(result.envelope.escalated).toBe(false);
    expect(result.modeChanged).toBe(true);
  });

  it('should reset failure count on success', () => {
    const env = makeEnvelope({ consecutive_failures: 2, mode: 'EXECUTE' });
    const result = applyHysteresis(env, 'PASS');
    expect(result.envelope.consecutive_failures).toBe(0);
    expect(result.envelope.consecutive_successes).toBe(1);
  });
});

describe('Backflow', () => {
  it('should detect A-B-A cycle', () => {
    const env = makeEnvelope({ state_hashes: ['hash-A', 'hash-B'] });
    const result = checkBackflow(env, 'hash-A');
    expect(result.detected).toBe(true);
    expect(result.matchedHop).toBe(0);
  });

  it('should not detect backflow with unique hash', () => {
    const env = makeEnvelope({ state_hashes: ['hash-A', 'hash-B'] });
    const result = checkBackflow(env, 'hash-C');
    expect(result.detected).toBe(false);
  });

  it('should record state hash', () => {
    const env = makeEnvelope({ state_hashes: ['hash-A'] });
    const result = recordStateHash(env, 'hash-B');
    expect(result.state_hashes).toEqual(['hash-A', 'hash-B']);
  });
});

describe('AntiLoopEngine', () => {
  it('should create envelope with defaults', () => {
    const engine = new AntiLoopEngine();
    const env = engine.createEnvelope('task-1');
    expect(env.ttl_max).toBe(10);
    expect(env.hops).toBe(0);
    expect(env.mode).toBe('EXECUTE');
  });

  it('should block pre-hop when TTL expired', () => {
    const engine = new AntiLoopEngine();
    const env = makeEnvelope({ hops: 10, ttl_max: 10 });
    const result = engine.preHopCheck(env);
    expect(result.allowed).toBe(false);
  });

  it('should allow pre-hop and increment when TTL ok', () => {
    const engine = new AntiLoopEngine();
    const env = makeEnvelope({ hops: 5, ttl_max: 10 });
    const result = engine.preHopCheck(env);
    expect(result.allowed).toBe(true);
    expect(result.envelope.hops).toBe(6);
  });
});
