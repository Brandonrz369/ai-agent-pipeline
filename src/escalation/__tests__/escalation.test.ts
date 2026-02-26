import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEscalationReport, formatEscalationAge } from '../index.js';

vi.mock('../../anti-loop/dead-letter.js', () => ({ listDeadLetter: vi.fn(async () => []) }));
vi.mock('../../security/discord-hitl.js', () => ({ listPendingApprovals: vi.fn(() => []) }));
vi.mock('../../adapters/task-store.js', () => ({
  getTaskStore: vi.fn(() => ({
    list: vi.fn(() => ({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  })),
}));

import { listDeadLetter } from '../../anti-loop/dead-letter.js';
import { listPendingApprovals } from '../../security/discord-hitl.js';
import { getTaskStore } from '../../adapters/task-store.js';

describe('getEscalationReport', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty report when nothing is stuck', async () => {
    const report = await getEscalationReport();
    expect(report.totalCount).toBe(0);
    expect(report.criticalCount).toBe(0);
    expect(report.items).toHaveLength(0);
    expect(report.byType.DEAD_LETTER).toBe(0);
    expect(report.byType.HITL_PENDING).toBe(0);
    expect(report.byType.BLOCKED).toBe(0);
  });

  it('includes dead-letter items as CRITICAL', async () => {
    vi.mocked(listDeadLetter).mockResolvedValueOnce([{
      id: 'dl-abc',
      envelope: { escalated: false, hops: 10, ttl_max: 10, consecutive_failures: 3 } as any,
      task: { task_id: 't-1', task: { objective: 'Test objective' } } as any,
      reason: 'TTL exceeded',
      sent_at: new Date(Date.now() - 3600000).toISOString(),
      file_path: '/tmp/dl-abc.json',
    }]);
    const report = await getEscalationReport();
    expect(report.totalCount).toBe(1);
    expect(report.criticalCount).toBe(1);
    expect(report.items[0].type).toBe('DEAD_LETTER');
    expect(report.items[0].severity).toBe('CRITICAL');
    expect(report.items[0].reason).toBe('TTL exceeded');
    expect(report.byType.DEAD_LETTER).toBe(1);
  });

  it('marks escalated dead-letter items as ESCALATED/HIGH', async () => {
    vi.mocked(listDeadLetter).mockResolvedValueOnce([{
      id: 'dl-esc',
      envelope: { escalated: true, hops: 5, ttl_max: 10, consecutive_failures: 2 } as any,
      task: undefined,
      reason: 'Escalated after retries',
      sent_at: new Date(Date.now() - 1000).toISOString(),
      file_path: '/tmp/dl-esc.json',
    }]);
    const report = await getEscalationReport();
    expect(report.items[0].type).toBe('ESCALATED');
    expect(report.items[0].severity).toBe('HIGH');
    expect(report.criticalCount).toBe(0);
    expect(report.byType.ESCALATED).toBe(1);
  });

  it('includes pending HITL approvals as HIGH severity', async () => {
    vi.mocked(listPendingApprovals).mockReturnValueOnce([
      { key: 'gate-1:task-1', gateId: 'gate-1', taskId: 'task-1' },
    ]);
    const report = await getEscalationReport();
    expect(report.totalCount).toBe(1);
    expect(report.criticalCount).toBe(0);
    expect(report.items[0].type).toBe('HITL_PENDING');
    expect(report.items[0].severity).toBe('HIGH');
    expect(report.items[0].taskId).toBe('task-1');
    expect(report.byType.HITL_PENDING).toBe(1);
  });

  it('includes BLOCKED legacy tasks as MEDIUM severity', async () => {
    const mockStore = {
      list: vi.fn(() => ({
        data: [{ id: 'blocked-1', description: 'Blocked task desc', status: 'BLOCKED',
          createdAt: new Date(Date.now() - 7200000).toISOString(),
          updatedAt: new Date(Date.now() - 3600000).toISOString() }],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      })),
    };
    vi.mocked(getTaskStore).mockReturnValueOnce(mockStore as any);
    const report = await getEscalationReport();
    expect(report.totalCount).toBe(1);
    expect(report.items[0].type).toBe('BLOCKED');
    expect(report.items[0].severity).toBe('MEDIUM');
    expect(report.items[0].description).toBe('Blocked task desc');
    expect(report.byType.BLOCKED).toBe(1);
  });

  it('sorts: CRITICAL before HIGH before MEDIUM', async () => {
    vi.mocked(listDeadLetter).mockResolvedValueOnce([{
      id: 'dl-1', envelope: { escalated: false, hops: 10, ttl_max: 10, consecutive_failures: 3 } as any,
      task: undefined, reason: 'TTL exceeded', sent_at: new Date().toISOString(), file_path: '',
    }]);
    vi.mocked(listPendingApprovals).mockReturnValueOnce([{ key: 'g:t', gateId: 'g', taskId: 't' }]);
    const mockStore = {
      list: vi.fn(() => ({
        data: [{ id: 'b-1', description: 'blocked', status: 'BLOCKED',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      })),
    };
    vi.mocked(getTaskStore).mockReturnValueOnce(mockStore as any);
    const report = await getEscalationReport();
    expect(report.totalCount).toBe(3);
    expect(report.items[0].severity).toBe('CRITICAL');
    expect(report.items[1].severity).toBe('HIGH');
    expect(report.items[2].severity).toBe('MEDIUM');
  });

  it('counts criticalCount correctly', async () => {
    vi.mocked(listDeadLetter).mockResolvedValueOnce([
      { id: 'dl-1', envelope: { escalated: false, hops: 10, ttl_max: 10, consecutive_failures: 3 } as any,
        task: undefined, reason: 'TTL', sent_at: new Date().toISOString(), file_path: '' },
      { id: 'dl-2', envelope: { escalated: true, hops: 5, ttl_max: 10, consecutive_failures: 2 } as any,
        task: undefined, reason: 'Escalated', sent_at: new Date().toISOString(), file_path: '' },
    ]);
    const report = await getEscalationReport();
    expect(report.criticalCount).toBe(1);
    expect(report.totalCount).toBe(2);
  });
});

describe('formatEscalationAge', () => {
  it('formats seconds correctly', () => { expect(formatEscalationAge(30000)).toBe('30s ago'); });
  it('formats minutes correctly', () => { expect(formatEscalationAge(90000)).toBe('1m 30s ago'); });
  it('formats hours correctly', () => { expect(formatEscalationAge(3660000)).toBe('1h 1m ago'); });
  it('formats days correctly', () => { expect(formatEscalationAge(90000000)).toBe('1d 1h ago'); });
  it('formats zero seconds', () => { expect(formatEscalationAge(500)).toBe('0s ago'); });
});
