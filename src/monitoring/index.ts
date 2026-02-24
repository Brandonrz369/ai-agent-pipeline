/**
 * Error Monitoring + Alerting — T17 (Charlie)
 *
 * Tracks pipeline errors, aggregates metrics, and fires alerts when
 * configurable thresholds are breached. Reuses the Discord webhook
 * pattern from discord-hitl.ts for notifications.
 *
 * Features:
 * - Error event tracking with categorization (component + error type)
 * - Sliding-window threshold alerts (e.g., 3 failures in 5 min → CRITICAL)
 * - Discord webhook alerts with severity-colored embeds
 * - Dead-letter queue depth monitoring
 * - Rate-limited alerting (no duplicate spam)
 * - Health check aggregation across components
 * - Stats export for `pipeline status` command
 */

import { logger } from '../utils/logger.js';
import { logAuditEntry } from '../audit/index.js';
import { listDeadLetter } from '../anti-loop/dead-letter.js';

// ─── Types ──────────────────────────────────────────────────────

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type MonitorComponent =
  | 'adapter'
  | 'executor'
  | 'orchestrator'
  | 'verifier'
  | 'anti-loop'
  | 'hitl'
  | 'api'
  | 'dead-letter'
  | 'gateway';

export type ErrorType =
  | 'task_failure'
  | 'timeout'
  | 'api_error'
  | 'parse_error'
  | 'spawn_error'
  | 'webhook_error'
  | 'dead_letter'
  | 'ttl_exceeded'
  | 'backflow_detected'
  | 'escalation'
  | 'hitl_timeout'
  | 'disk_error';

export interface ErrorEvent {
  timestamp: string;
  component: MonitorComponent;
  errorType: ErrorType;
  message: string;
  taskId?: string;
  details?: Record<string, unknown>;
}

export interface AlertThreshold {
  component: MonitorComponent;
  errorType: ErrorType;
  maxCount: number;
  windowMs: number;
  severity: AlertSeverity;
  description: string;
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  threshold: AlertThreshold;
  triggerCount: number;
  firstEvent: string;
  lastEvent: string;
  firedAt: string;
  acknowledged: boolean;
}

export interface HealthStatus {
  healthy: boolean;
  components: Record<string, ComponentHealth>;
  deadLetterDepth: number;
  activeAlerts: number;
  timestamp: string;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'down';
  lastError?: string;
  lastErrorAt?: string;
  errorsInWindow: number;
}

export interface MonitorStats {
  totalErrors: number;
  errorsByComponent: Record<string, number>;
  errorsByType: Record<string, number>;
  alertsFired: number;
  alertsAcknowledged: number;
  deadLetterDepth: number;
  uptime: number;
  startedAt: string;
}

export interface MonitorConfig {
  discordWebhookUrl?: string;
  alertCooldownMs?: number;
  healthCheckIntervalMs?: number;
  deadLetterWarningThreshold?: number;
  thresholds?: AlertThreshold[];
}

// ─── Severity Colors (Discord embeds) ───────────────────────────

const SEVERITY_COLORS: Record<AlertSeverity, number> = {
  CRITICAL: 0xff0000,  // Red
  HIGH: 0xff8c00,      // Orange
  MEDIUM: 0xffd700,    // Yellow
  LOW: 0x4169e1,       // Royal blue
};

// ─── Default Thresholds ─────────────────────────────────────────

const DEFAULT_THRESHOLDS: AlertThreshold[] = [
  // CRITICAL: Pipeline can't function
  {
    component: 'executor',
    errorType: 'spawn_error',
    maxCount: 3,
    windowMs: 5 * 60_000,
    severity: 'CRITICAL',
    description: 'Claude Code executor spawn failures — pipeline cannot execute tasks',
  },
  {
    component: 'api',
    errorType: 'api_error',
    maxCount: 5,
    windowMs: 5 * 60_000,
    severity: 'CRITICAL',
    description: 'Antigravity proxy API failures — classifier/verifier unavailable',
  },
  {
    component: 'dead-letter',
    errorType: 'dead_letter',
    maxCount: 5,
    windowMs: 60 * 60_000,
    severity: 'CRITICAL',
    description: 'Dead-letter queue growing rapidly — systemic task failures',
  },

  // HIGH: Significant degradation
  {
    component: 'adapter',
    errorType: 'task_failure',
    maxCount: 3,
    windowMs: 10 * 60_000,
    severity: 'HIGH',
    description: 'Legacy Agency adapter failures — task dispatch broken',
  },
  {
    component: 'executor',
    errorType: 'timeout',
    maxCount: 3,
    windowMs: 15 * 60_000,
    severity: 'HIGH',
    description: 'Claude Code execution timeouts — sessions hanging',
  },
  {
    component: 'verifier',
    errorType: 'api_error',
    maxCount: 3,
    windowMs: 10 * 60_000,
    severity: 'HIGH',
    description: 'Verifier API failures — task verification degraded',
  },
  {
    component: 'hitl',
    errorType: 'webhook_error',
    maxCount: 3,
    windowMs: 5 * 60_000,
    severity: 'HIGH',
    description: 'Discord HITL webhook failures — approval mechanism broken',
  },

  // MEDIUM: Notable but not blocking
  {
    component: 'anti-loop',
    errorType: 'ttl_exceeded',
    maxCount: 3,
    windowMs: 30 * 60_000,
    severity: 'MEDIUM',
    description: 'Multiple tasks hitting TTL limits — possible task complexity issue',
  },
  {
    component: 'anti-loop',
    errorType: 'backflow_detected',
    maxCount: 3,
    windowMs: 30 * 60_000,
    severity: 'MEDIUM',
    description: 'Repeated backflow detection — tasks looping on same state',
  },
  {
    component: 'hitl',
    errorType: 'hitl_timeout',
    maxCount: 5,
    windowMs: 60 * 60_000,
    severity: 'MEDIUM',
    description: 'HITL approval timeouts — approvals not being handled in time',
  },
  {
    component: 'executor',
    errorType: 'parse_error',
    maxCount: 5,
    windowMs: 30 * 60_000,
    severity: 'MEDIUM',
    description: 'Claude output JSON parse failures — output format issues',
  },
];

// ─── ErrorMonitor Class ─────────────────────────────────────────

export class ErrorMonitor {
  private config: Required<MonitorConfig>;
  private events: ErrorEvent[] = [];
  private alerts: Map<string, Alert> = new Map();
  private alertCooldowns: Map<string, number> = new Map();
  private startedAt: string;
  private alertCounter = 0;

  constructor(config: MonitorConfig = {}) {
    this.config = {
      discordWebhookUrl: config.discordWebhookUrl || process.env.DISCORD_ALERT_WEBHOOK || '',
      alertCooldownMs: config.alertCooldownMs ?? 15 * 60_000,
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 60_000,
      deadLetterWarningThreshold: config.deadLetterWarningThreshold ?? 10,
      thresholds: config.thresholds ?? DEFAULT_THRESHOLDS,
    };
    this.startedAt = new Date().toISOString();
  }

  /**
   * Record an error event and check thresholds.
   */
  async recordError(
    component: MonitorComponent,
    errorType: ErrorType,
    message: string,
    taskId?: string,
    details?: Record<string, unknown>,
  ): Promise<Alert | null> {
    const event: ErrorEvent = {
      timestamp: new Date().toISOString(),
      component,
      errorType,
      message,
      taskId,
      details,
    };

    this.events.push(event);
    logger.warn('Error event recorded', {
      component,
      errorType,
      message,
      taskId,
    });

    // Check thresholds
    const alert = this.checkThresholds(component, errorType);

    if (alert) {
      await this.fireAlert(alert);
    }

    return alert;
  }

  /**
   * Check if any threshold is breached for this component+errorType.
   */
  private checkThresholds(
    component: MonitorComponent,
    errorType: ErrorType,
  ): Alert | null {
    const now = Date.now();
    const matchingThresholds = this.config.thresholds.filter(
      (t) => t.component === component && t.errorType === errorType,
    );

    for (const threshold of matchingThresholds) {
      const thresholdKey = `${threshold.component}:${threshold.errorType}:${threshold.severity}`;

      // Check cooldown
      const lastFired = this.alertCooldowns.get(thresholdKey);
      if (lastFired && now - lastFired < this.config.alertCooldownMs) {
        continue;
      }

      // Count events in window
      const windowStart = new Date(now - threshold.windowMs).toISOString();
      const eventsInWindow = this.events.filter(
        (e) =>
          e.component === component &&
          e.errorType === errorType &&
          e.timestamp >= windowStart,
      );

      if (eventsInWindow.length >= threshold.maxCount) {
        this.alertCounter++;
        const alert: Alert = {
          id: `ALERT-${this.alertCounter}`,
          severity: threshold.severity,
          threshold,
          triggerCount: eventsInWindow.length,
          firstEvent: eventsInWindow[0].timestamp,
          lastEvent: eventsInWindow[eventsInWindow.length - 1].timestamp,
          firedAt: new Date().toISOString(),
          acknowledged: false,
        };

        this.alerts.set(alert.id, alert);
        this.alertCooldowns.set(thresholdKey, now);
        return alert;
      }
    }

    return null;
  }

  /**
   * Fire an alert — log it and send Discord notification.
   */
  private async fireAlert(alert: Alert): Promise<void> {
    logger.error('ALERT FIRED', {
      id: alert.id,
      severity: alert.severity,
      description: alert.threshold.description,
      triggerCount: alert.triggerCount,
      component: alert.threshold.component,
      errorType: alert.threshold.errorType,
    });

    await logAuditEntry('MONITOR_ALERT_FIRED', {
      alertId: alert.id,
      severity: alert.severity,
      component: alert.threshold.component,
      errorType: alert.threshold.errorType,
      triggerCount: alert.triggerCount,
      description: alert.threshold.description,
    });

    if (this.config.discordWebhookUrl) {
      await this.sendDiscordAlert(alert);
    }
  }

  /**
   * Send an alert notification to Discord.
   */
  private async sendDiscordAlert(alert: Alert): Promise<void> {
    const embed = {
      title: `Pipeline Alert — ${alert.severity}`,
      description: alert.threshold.description,
      color: SEVERITY_COLORS[alert.severity],
      fields: [
        { name: 'Component', value: alert.threshold.component, inline: true },
        { name: 'Error Type', value: alert.threshold.errorType, inline: true },
        { name: 'Count', value: `${alert.triggerCount} in ${Math.round(alert.threshold.windowMs / 60_000)}m`, inline: true },
        { name: 'Alert ID', value: alert.id, inline: true },
        { name: 'Threshold', value: `${alert.threshold.maxCount} / ${Math.round(alert.threshold.windowMs / 60_000)}m`, inline: true },
      ],
      footer: { text: `Pipeline Error Monitor | ${alert.firedAt}` },
      timestamp: alert.firedAt,
    };

    try {
      const response = await fetch(this.config.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `@here **${alert.severity} ALERT** — ${alert.threshold.component}`,
          embeds: [embed],
        }),
      });

      if (!response.ok) {
        logger.error('Discord alert webhook failed', {
          status: response.status,
          alertId: alert.id,
        });
      }
    } catch (err) {
      logger.error('Discord alert webhook error', {
        error: String(err),
        alertId: alert.id,
      });
    }
  }

  /**
   * Acknowledge an alert (prevents re-firing until cooldown expires).
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  /**
   * Get all active (unacknowledged) alerts.
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter((a) => !a.acknowledged);
  }

  /**
   * Get all alerts (including acknowledged).
   */
  getAllAlerts(): Alert[] {
    return Array.from(this.alerts.values());
  }

  /**
   * Get health status of all monitored components.
   */
  async getHealthStatus(): Promise<HealthStatus> {
    const now = Date.now();
    const windowMs = this.config.healthCheckIntervalMs;
    const windowStart = new Date(now - windowMs).toISOString();

    const components: Record<string, ComponentHealth> = {};
    const allComponents: MonitorComponent[] = [
      'adapter', 'executor', 'orchestrator', 'verifier',
      'anti-loop', 'hitl', 'api', 'dead-letter', 'gateway',
    ];

    for (const comp of allComponents) {
      const recentErrors = this.events.filter(
        (e) => e.component === comp && e.timestamp >= windowStart,
      );
      const lastError = recentErrors[recentErrors.length - 1];

      let status: ComponentHealth['status'] = 'healthy';
      if (recentErrors.length >= 5) {
        status = 'down';
      } else if (recentErrors.length >= 2) {
        status = 'degraded';
      }

      components[comp] = {
        status,
        lastError: lastError?.message,
        lastErrorAt: lastError?.timestamp,
        errorsInWindow: recentErrors.length,
      };
    }

    let deadLetterDepth = 0;
    try {
      const dlItems = await listDeadLetter();
      deadLetterDepth = dlItems.length;
    } catch {
      // Dead-letter dir may not exist yet
    }

    const activeAlerts = this.getActiveAlerts().length;
    const healthy = activeAlerts === 0 &&
      Object.values(components).every((c) => c.status === 'healthy') &&
      deadLetterDepth < this.config.deadLetterWarningThreshold;

    return {
      healthy,
      components,
      deadLetterDepth,
      activeAlerts,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get aggregated stats for `pipeline status`.
   */
  getStats(): MonitorStats {
    const errorsByComponent: Record<string, number> = {};
    const errorsByType: Record<string, number> = {};

    for (const event of this.events) {
      errorsByComponent[event.component] = (errorsByComponent[event.component] || 0) + 1;
      errorsByType[event.errorType] = (errorsByType[event.errorType] || 0) + 1;
    }

    return {
      totalErrors: this.events.length,
      errorsByComponent,
      errorsByType,
      alertsFired: this.alerts.size,
      alertsAcknowledged: Array.from(this.alerts.values()).filter((a) => a.acknowledged).length,
      deadLetterDepth: 0, // sync version — use getHealthStatus for async
      uptime: Date.now() - new Date(this.startedAt).getTime(),
      startedAt: this.startedAt,
    };
  }

  /**
   * Get recent error events, optionally filtered.
   */
  getRecentErrors(opts?: {
    component?: MonitorComponent;
    errorType?: ErrorType;
    limit?: number;
    sinceMs?: number;
  }): ErrorEvent[] {
    let filtered = this.events;

    if (opts?.component) {
      filtered = filtered.filter((e) => e.component === opts.component);
    }
    if (opts?.errorType) {
      filtered = filtered.filter((e) => e.errorType === opts.errorType);
    }
    if (opts?.sinceMs) {
      const since = new Date(Date.now() - opts.sinceMs).toISOString();
      filtered = filtered.filter((e) => e.timestamp >= since);
    }

    // Most recent first
    filtered = [...filtered].reverse();

    if (opts?.limit) {
      filtered = filtered.slice(0, opts.limit);
    }

    return filtered;
  }

  /**
   * Prune old events to prevent memory growth.
   * Keeps events from the last `retentionMs` (default 24h).
   */
  pruneEvents(retentionMs: number = 24 * 60 * 60_000): number {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    const before = this.events.length;
    this.events = this.events.filter((e) => e.timestamp >= cutoff);
    return before - this.events.length;
  }

  /**
   * Reset all state (for testing).
   */
  reset(): void {
    this.events = [];
    this.alerts.clear();
    this.alertCooldowns.clear();
    this.alertCounter = 0;
    this.startedAt = new Date().toISOString();
  }
}

// ─── Singleton Instance ─────────────────────────────────────────

let monitorInstance: ErrorMonitor | null = null;

/**
 * Get the global ErrorMonitor singleton.
 */
export function getMonitor(config?: MonitorConfig): ErrorMonitor {
  if (!monitorInstance) {
    monitorInstance = new ErrorMonitor(config);
  }
  return monitorInstance;
}

/**
 * Reset the global singleton (for testing).
 */
export function resetMonitor(): void {
  monitorInstance = null;
}
