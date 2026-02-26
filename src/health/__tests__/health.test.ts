import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getHealthReport } from '../index.js';

vi.mock('../../monitoring/index.js', () => ({
  getMonitor: vi.fn(() => ({
    getStats: () => ({ totalErrors: 0, uptime: 1000 }),
    getActiveAlerts: () => [],
  })),
}));

vi.mock('../../anti-loop/dead-letter.js', () => ({
  listDeadLetter: vi.fn(async () => []),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Health Check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok when all checks pass', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const report = await getHealthReport();
    expect(report.status).toBe('ok');
    expect(report.version).toBe('2.0.0');
    expect(report.uptime).toBeGreaterThan(0);
    expect(report.timestamp).toBeTruthy();
    expect(report.checks.antigravityProxy.status).toBe('ok');
    expect(report.checks.deadLetter.status).toBe('ok');
    expect(report.checks.monitoring.status).toBe('ok');
  });

  it('returns degraded when proxy returns non-ok status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    const report = await getHealthReport();
    expect(report.status).toBe('degraded');
    expect(report.checks.antigravityProxy.status).toBe('degraded');
  });

  it('returns down when proxy is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const report = await getHealthReport();
    expect(report.checks.antigravityProxy.status).toBe('down');
  });

  it('returns correct structure', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const report = await getHealthReport();
    expect(report).toHaveProperty('status');
    expect(report).toHaveProperty('uptime');
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('version');
    expect(report).toHaveProperty('checks');
    expect(report.checks).toHaveProperty('antigravityProxy');
    expect(report.checks).toHaveProperty('deadLetter');
    expect(report.checks).toHaveProperty('monitoring');
  });

  it('returns degraded when dead-letter exceeds threshold', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { listDeadLetter } = await import('../../anti-loop/dead-letter.js');
    const mockList = vi.mocked(listDeadLetter);
    mockList.mockResolvedValue(Array.from({ length: 15 }, (_, i) => ({
      id: 'dl-' + i, reason: 'test', sent_at: new Date().toISOString(), envelope: {}, task: {},
    })) as any);
    const report = await getHealthReport();
    expect(report.checks.deadLetter.status).toBe('degraded');
  });

  it('returns degraded when monitoring has active alerts', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { getMonitor } = await import('../../monitoring/index.js');
    const mockGetMonitor = vi.mocked(getMonitor);
    mockGetMonitor.mockReturnValue({
      getStats: () => ({ totalErrors: 5, uptime: 1000 }),
      getActiveAlerts: () => [{ id: 'ALERT-1' }],
    } as any);
    const report = await getHealthReport();
    expect(report.checks.monitoring.status).toBe('degraded');
  });
});
