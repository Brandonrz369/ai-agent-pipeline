/**
 * Error Monitoring + Alerting Tests — T17 (Charlie)
 *
 * Tests the ErrorMonitor class: event tracking, threshold alerts,
 * Discord notifications, health checks, stats, and pruning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ErrorMonitor,
  getMonitor,
  resetMonitor,
  type MonitorConfig,
  type AlertThreshold,
  type MonitorComponent,
  type ErrorType,
  type AlertSeverity,
} from '../index.js';

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../audit/index.js', () => ({
  logAuditEntry: vi.fn().mockResolvedValue({ timestamp: '2026-02-24T06:00:00Z', action: 'test', details: {}, hmac: 'test' }),
}));

vi.mock('../../anti-loop/dead-letter.js', () => ({
  listDeadLetter: vi.fn().mockResolvedValue([]),
}));

// Mock fetch for Discord webhook
const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
vi.stubGlobal('fetch', mockFetch);

function createTestConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    discordWebhookUrl: '',
    alertCooldownMs: 0, // No cooldown for testing
    healthCheckIntervalMs: 60_000,
    deadLetterWarningThreshold: 10,
    ...overrides,
  };
}

function createTestThreshold(overrides: Partial<AlertThreshold> = {}): AlertThreshold {
  return {
    component: 'executor',
    errorType: 'spawn_error',
    maxCount: 3,
    windowMs: 5 * 60_000,
    severity: 'CRITICAL',
    description: 'Test threshold — executor spawn failures',
    ...overrides,
  };
}

describe('ErrorMonitor', () => {
  let monitor: ErrorMonitor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    resetMonitor();
  });

  describe('recordError', () => {
    it('should record an error event', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'spawn_error', 'Claude CLI not found');

      const events = monitor.getRecentErrors();
      expect(events).toHaveLength(1);
      expect(events[0].component).toBe('executor');
      expect(events[0].errorType).toBe('spawn_error');
      expect(events[0].message).toBe('Claude CLI not found');
      expect(events[0].timestamp).toBeDefined();
    });

    it('should record error with taskId and details', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError(
        'adapter',
        'task_failure',
        'Blueprint conversion failed',
        'LEGACY-2026-001-B1-N1',
        { reason: 'invalid taskType' },
      );

      const events = monitor.getRecentErrors();
      expect(events[0].taskId).toBe('LEGACY-2026-001-B1-N1');
      expect(events[0].details).toEqual({ reason: 'invalid taskType' });
    });

    it('should accumulate multiple errors', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'Session timed out');
      await monitor.recordError('verifier', 'api_error', 'Gemini 429');
      await monitor.recordError('adapter', 'task_failure', 'Dispatch failed');

      const events = monitor.getRecentErrors();
      expect(events).toHaveLength(3);
    });
  });

  describe('threshold alerts', () => {
    it('should fire an alert when threshold is breached', async () => {
      const threshold = createTestThreshold({ maxCount: 2 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      const alert1 = await monitor.recordError('executor', 'spawn_error', 'Fail 1');
      expect(alert1).toBeNull(); // 1 of 2, no alert

      const alert2 = await monitor.recordError('executor', 'spawn_error', 'Fail 2');
      expect(alert2).not.toBeNull(); // 2 of 2, alert fires
      expect(alert2!.severity).toBe('CRITICAL');
      expect(alert2!.triggerCount).toBe(2);
      expect(alert2!.threshold.description).toBe('Test threshold — executor spawn failures');
    });

    it('should not fire alert below threshold', async () => {
      const threshold = createTestThreshold({ maxCount: 5 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      for (let i = 0; i < 4; i++) {
        const alert = await monitor.recordError('executor', 'spawn_error', `Fail ${i + 1}`);
        expect(alert).toBeNull();
      }
    });

    it('should not fire alert for non-matching component', async () => {
      const threshold = createTestThreshold({ component: 'executor', maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      const alert = await monitor.recordError('verifier', 'spawn_error', 'Wrong component');
      expect(alert).toBeNull();
    });

    it('should not fire alert for non-matching errorType', async () => {
      const threshold = createTestThreshold({ errorType: 'spawn_error', maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      const alert = await monitor.recordError('executor', 'timeout', 'Wrong type');
      expect(alert).toBeNull();
    });

    it('should respect cooldown between duplicate alerts', async () => {
      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({
        thresholds: [threshold],
        alertCooldownMs: 60_000, // 1 min cooldown
      }));

      const alert1 = await monitor.recordError('executor', 'spawn_error', 'First');
      expect(alert1).not.toBeNull();

      // Second should be suppressed by cooldown
      const alert2 = await monitor.recordError('executor', 'spawn_error', 'Second');
      expect(alert2).toBeNull();
    });

    it('should track alert in alerts list', async () => {
      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      await monitor.recordError('executor', 'spawn_error', 'Fail');

      const alerts = monitor.getAllAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toMatch(/^ALERT-\d+$/);
      expect(alerts[0].acknowledged).toBe(false);
    });

    it('should only count events within the time window', async () => {
      const threshold = createTestThreshold({ maxCount: 2, windowMs: 100 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      await monitor.recordError('executor', 'spawn_error', 'Old event');

      // Wait for the event to expire from window
      await new Promise((r) => setTimeout(r, 150));

      // This should be the only event in window — below threshold
      const alert = await monitor.recordError('executor', 'spawn_error', 'New event');
      expect(alert).toBeNull();
    });
  });

  describe('Discord alerts', () => {
    it('should send Discord webhook when alert fires', async () => {
      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({
        thresholds: [threshold],
        discordWebhookUrl: 'https://discord.com/api/webhooks/test',
      }));

      await monitor.recordError('executor', 'spawn_error', 'Fail');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://discord.com/api/webhooks/test');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.content).toContain('CRITICAL ALERT');
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toContain('CRITICAL');
      expect(body.embeds[0].color).toBe(0xff0000); // Red for CRITICAL
    });

    it('should not send Discord when no webhook configured', async () => {
      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({
        thresholds: [threshold],
        discordWebhookUrl: '',
      }));

      await monitor.recordError('executor', 'spawn_error', 'Fail');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle Discord webhook failure gracefully', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({
        thresholds: [threshold],
        discordWebhookUrl: 'https://discord.com/api/webhooks/test',
      }));

      // Should not throw
      await monitor.recordError('executor', 'spawn_error', 'Fail');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should handle Discord network error gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({
        thresholds: [threshold],
        discordWebhookUrl: 'https://discord.com/api/webhooks/test',
      }));

      await monitor.recordError('executor', 'spawn_error', 'Fail');
      // Should not throw — error is logged but non-blocking
    });

    it('should use correct color for each severity level', async () => {
      const severities: AlertSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
      const expectedColors = [0xff0000, 0xff8c00, 0xffd700, 0x4169e1];

      for (let i = 0; i < severities.length; i++) {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
        const threshold = createTestThreshold({
          maxCount: 1,
          severity: severities[i],
          component: ['executor', 'verifier', 'adapter', 'api'][i] as MonitorComponent,
        });
        monitor = new ErrorMonitor(createTestConfig({
          thresholds: [threshold],
          discordWebhookUrl: 'https://discord.com/api/webhooks/test',
        }));

        await monitor.recordError(
          threshold.component,
          'spawn_error',
          'Test',
        );

        const body = JSON.parse(mockFetch.mock.calls[i][1].body);
        expect(body.embeds[0].color).toBe(expectedColors[i]);

        monitor.reset();
      }
    });
  });

  describe('acknowledgeAlert', () => {
    it('should acknowledge an existing alert', async () => {
      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      const alert = await monitor.recordError('executor', 'spawn_error', 'Fail');
      expect(monitor.getActiveAlerts()).toHaveLength(1);

      const result = monitor.acknowledgeAlert(alert!.id);
      expect(result).toBe(true);
      expect(monitor.getActiveAlerts()).toHaveLength(0);
      expect(monitor.getAllAlerts()).toHaveLength(1); // Still in total list
    });

    it('should return false for non-existent alert', () => {
      monitor = new ErrorMonitor(createTestConfig());
      expect(monitor.acknowledgeAlert('ALERT-999')).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy when no errors', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      const health = await monitor.getHealthStatus();
      expect(health.healthy).toBe(true);
      expect(health.activeAlerts).toBe(0);
      expect(health.deadLetterDepth).toBe(0);
      expect(health.timestamp).toBeDefined();
    });

    it('should mark component as degraded with 2+ errors', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'Timeout 1');
      await monitor.recordError('executor', 'timeout', 'Timeout 2');

      const health = await monitor.getHealthStatus();
      expect(health.components['executor'].status).toBe('degraded');
      expect(health.components['executor'].errorsInWindow).toBe(2);
    });

    it('should mark component as down with 5+ errors', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      for (let i = 0; i < 5; i++) {
        await monitor.recordError('api', 'api_error', `Error ${i + 1}`);
      }

      const health = await monitor.getHealthStatus();
      expect(health.components['api'].status).toBe('down');
      expect(health.components['api'].errorsInWindow).toBe(5);
    });

    it('should track last error details', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('verifier', 'api_error', 'Gemini 503');

      const health = await monitor.getHealthStatus();
      expect(health.components['verifier'].lastError).toBe('Gemini 503');
      expect(health.components['verifier'].lastErrorAt).toBeDefined();
    });

    it('should report unhealthy when active alerts exist', async () => {
      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      await monitor.recordError('executor', 'spawn_error', 'Fail');

      const health = await monitor.getHealthStatus();
      expect(health.healthy).toBe(false);
      expect(health.activeAlerts).toBe(1);
    });

    it('should report unhealthy when dead-letter depth exceeds threshold', async () => {
      const { listDeadLetter } = await import('../../anti-loop/dead-letter.js');
      const mockListDL = vi.mocked(listDeadLetter);
      mockListDL.mockResolvedValueOnce(
        Array(15).fill({ id: 'x', envelope: {}, reason: 'test', sent_at: '', file_path: '' }),
      );

      monitor = new ErrorMonitor(createTestConfig({
        thresholds: [],
        deadLetterWarningThreshold: 10,
      }));

      const health = await monitor.getHealthStatus();
      expect(health.healthy).toBe(false);
      expect(health.deadLetterDepth).toBe(15);
    });

    it('should include all component names', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));
      const health = await monitor.getHealthStatus();

      const expectedComponents = [
        'adapter', 'executor', 'orchestrator', 'verifier',
        'anti-loop', 'hitl', 'api', 'dead-letter', 'gateway',
      ];
      for (const comp of expectedComponents) {
        expect(health.components[comp]).toBeDefined();
      }
    });
  });

  describe('getStats', () => {
    it('should return zeroed stats for fresh monitor', () => {
      monitor = new ErrorMonitor(createTestConfig());

      const stats = monitor.getStats();
      expect(stats.totalErrors).toBe(0);
      expect(stats.alertsFired).toBe(0);
      expect(stats.alertsAcknowledged).toBe(0);
      expect(stats.startedAt).toBeDefined();
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should aggregate errors by component', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'T1');
      await monitor.recordError('executor', 'timeout', 'T2');
      await monitor.recordError('verifier', 'api_error', 'V1');

      const stats = monitor.getStats();
      expect(stats.totalErrors).toBe(3);
      expect(stats.errorsByComponent).toEqual({ executor: 2, verifier: 1 });
    });

    it('should aggregate errors by type', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'T1');
      await monitor.recordError('adapter', 'timeout', 'T2');
      await monitor.recordError('verifier', 'api_error', 'V1');

      const stats = monitor.getStats();
      expect(stats.errorsByType).toEqual({ timeout: 2, api_error: 1 });
    });

    it('should track alert counts', async () => {
      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      const alert = await monitor.recordError('executor', 'spawn_error', 'Fail');
      monitor.acknowledgeAlert(alert!.id);

      const stats = monitor.getStats();
      expect(stats.alertsFired).toBe(1);
      expect(stats.alertsAcknowledged).toBe(1);
    });
  });

  describe('getRecentErrors', () => {
    it('should return errors in reverse chronological order', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'First');
      await monitor.recordError('verifier', 'api_error', 'Second');

      const events = monitor.getRecentErrors();
      expect(events[0].message).toBe('Second');
      expect(events[1].message).toBe('First');
    });

    it('should filter by component', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'E1');
      await monitor.recordError('verifier', 'api_error', 'V1');
      await monitor.recordError('executor', 'spawn_error', 'E2');

      const events = monitor.getRecentErrors({ component: 'executor' });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.component === 'executor')).toBe(true);
    });

    it('should filter by errorType', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'T1');
      await monitor.recordError('executor', 'spawn_error', 'S1');
      await monitor.recordError('adapter', 'timeout', 'T2');

      const events = monitor.getRecentErrors({ errorType: 'timeout' });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.errorType === 'timeout')).toBe(true);
    });

    it('should respect limit', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      for (let i = 0; i < 10; i++) {
        await monitor.recordError('executor', 'timeout', `Error ${i}`);
      }

      const events = monitor.getRecentErrors({ limit: 3 });
      expect(events).toHaveLength(3);
    });

    it('should filter by time window', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'Old');

      // Wait and add a new one
      await new Promise((r) => setTimeout(r, 50));

      await monitor.recordError('executor', 'timeout', 'Recent');

      const events = monitor.getRecentErrors({ sinceMs: 30 });
      expect(events).toHaveLength(1);
      expect(events[0].message).toBe('Recent');
    });
  });

  describe('pruneEvents', () => {
    it('should remove events older than retention period', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));

      await monitor.recordError('executor', 'timeout', 'Old');

      // Wait briefly
      await new Promise((r) => setTimeout(r, 50));

      await monitor.recordError('executor', 'timeout', 'Recent');

      // Prune with 30ms retention — should remove the first event
      const pruned = monitor.pruneEvents(30);
      expect(pruned).toBe(1);
      expect(monitor.getRecentErrors()).toHaveLength(1);
      expect(monitor.getRecentErrors()[0].message).toBe('Recent');
    });

    it('should return 0 when nothing to prune', async () => {
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [] }));
      await monitor.recordError('executor', 'timeout', 'Recent');

      const pruned = monitor.pruneEvents(60_000);
      expect(pruned).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      await monitor.recordError('executor', 'spawn_error', 'Fail');

      monitor.reset();

      expect(monitor.getRecentErrors()).toHaveLength(0);
      expect(monitor.getAllAlerts()).toHaveLength(0);
      expect(monitor.getActiveAlerts()).toHaveLength(0);
      expect(monitor.getStats().totalErrors).toBe(0);
    });
  });

  describe('singleton', () => {
    it('should return same instance on repeated getMonitor calls', () => {
      resetMonitor();
      const m1 = getMonitor();
      const m2 = getMonitor();
      expect(m1).toBe(m2);
    });

    it('should return fresh instance after resetMonitor', () => {
      const m1 = getMonitor();
      resetMonitor();
      const m2 = getMonitor();
      expect(m1).not.toBe(m2);
    });
  });

  describe('audit integration', () => {
    it('should log audit entry when alert fires', async () => {
      const { logAuditEntry } = await import('../../audit/index.js');
      const mockAudit = vi.mocked(logAuditEntry);

      const threshold = createTestThreshold({ maxCount: 1 });
      monitor = new ErrorMonitor(createTestConfig({ thresholds: [threshold] }));

      await monitor.recordError('executor', 'spawn_error', 'Fail');

      expect(mockAudit).toHaveBeenCalledWith(
        'MONITOR_ALERT_FIRED',
        expect.objectContaining({
          severity: 'CRITICAL',
          component: 'executor',
          errorType: 'spawn_error',
        }),
      );
    });
  });

  describe('default thresholds', () => {
    it('should have default thresholds when none specified', () => {
      monitor = new ErrorMonitor({ alertCooldownMs: 0 });
      // The monitor should work with defaults — just record errors
      // and verify no crash
      expect(monitor.getStats().totalErrors).toBe(0);
    });

    it('should fire CRITICAL alert for 5 API errors in 5 min', async () => {
      monitor = new ErrorMonitor({ alertCooldownMs: 0 });

      for (let i = 0; i < 4; i++) {
        await monitor.recordError('api', 'api_error', `API error ${i + 1}`);
      }
      expect(monitor.getActiveAlerts()).toHaveLength(0);

      const alert = await monitor.recordError('api', 'api_error', 'API error 5');
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('CRITICAL');
    });
  });
});
