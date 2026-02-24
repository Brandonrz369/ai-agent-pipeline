import { describe, it, expect } from 'vitest';
import { checkPermission } from '../rbac.js';
import { checkHITL } from '../hitl.js';

describe('RBAC', () => {
  it('should allow orchestrator to read everything', () => {
    expect(checkPermission(0, 'any/file.ts', 'read')).toBe(true);
  });

  it('should allow orchestrator to write prompts', () => {
    expect(checkPermission(0, 'prompts/task.json', 'write')).toBe(true);
  });

  it('should block worker from writing outside scope', () => {
    // Node 1 (docs worker) should not write to schemas/
    expect(checkPermission(1, 'schemas/test.json', 'write')).toBe(false);
  });

  it('should allow worker to write within scope', () => {
    expect(checkPermission(1, 'docs/phase1.md', 'write')).toBe(true);
  });

  it('should allow red team to read everything', () => {
    expect(checkPermission(5, 'src/anything.ts', 'read')).toBe(true);
  });

  it('should block red team from writing non-redteam reports', () => {
    expect(checkPermission(5, 'reports/n1_docs.md', 'write')).toBe(false);
  });

  it('should allow red team to write redteam reports', () => {
    expect(checkPermission(5, 'reports/redteam_batch1.md', 'write')).toBe(true);
  });
});

describe('HITL', () => {
  it('should trigger on git push', () => {
    const result = checkHITL('git push origin main');
    expect(result.needsApproval).toBe(true);
    expect(result.gate?.id).toBe('HITL-001');
  });

  it('should trigger on rm -rf', () => {
    const result = checkHITL('rm -rf /some/dir');
    expect(result.needsApproval).toBe(true);
    expect(result.gate?.severity).toBe('CRITICAL');
  });

  it('should auto-approve read operations', () => {
    const result = checkHITL('read src/index.ts');
    expect(result.needsApproval).toBe(false);
    expect(result.autoApproved).toBe(true);
  });

  it('should auto-approve npm test', () => {
    const result = checkHITL('npm test');
    expect(result.needsApproval).toBe(false);
    expect(result.autoApproved).toBe(true);
  });

  it('should not trigger on normal operations', () => {
    const result = checkHITL('create file src/hello.ts');
    expect(result.needsApproval).toBe(false);
  });
});
