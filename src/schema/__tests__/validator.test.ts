import { describe, it, expect } from 'vitest';
import { validateAgainstSchema } from '../validator.js';

describe('Schema Validator', () => {
  it('should validate a correct task envelope', async () => {
    const envelope = {
      id: 'env-test-1',
      ttl_max: 10,
      hops: 0,
      mode: 'EXECUTE',
    };
    const result = await validateAgainstSchema(envelope, 'task-envelope');
    expect(result.valid).toBe(true);
  });

  it('should reject an invalid task envelope', async () => {
    const envelope = {
      id: 'env-test-2',
      // missing required fields: ttl_max, hops, mode
    };
    const result = await validateAgainstSchema(envelope, 'task-envelope');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should validate a correct report', async () => {
    const report = {
      task_id: 'PIPE-2026-001-B1-N1',
      node: 1,
      status: 'PASS',
      timestamp: '2026-02-23T12:00:00Z',
      changes_made: [
        { file: 'src/test.ts', description: 'Created test file' },
      ],
    };
    const result = await validateAgainstSchema(report, 'report');
    expect(result.valid).toBe(true);
  });

  it('should reject report with BLOCKED status and no blocked_on', async () => {
    const report = {
      task_id: 'PIPE-2026-001-B1-N1',
      node: 1,
      status: 'BLOCKED',
      timestamp: '2026-02-23T12:00:00Z',
      changes_made: [],
      // missing blocked_on (required when status=BLOCKED)
    };
    const result = await validateAgainstSchema(report, 'report');
    expect(result.valid).toBe(false);
  });
});
