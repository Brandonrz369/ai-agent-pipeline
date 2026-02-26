import { getMonitor } from '../monitoring/index.js';
import { listDeadLetter } from '../anti-loop/dead-letter.js';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  timestamp: string;
  version: string;
  checks: {
    antigravityProxy: CheckResult;
    deadLetter: CheckResult;
    monitoring: CheckResult;
  };
}

export interface CheckResult {
  status: 'ok' | 'degraded' | 'down';
  message: string;
  details?: Record<string, unknown>;
}

const ANTIGRAVITY_URL = process.env.ANTIGRAVITY_URL || 'http://127.0.0.1:8080';

async function checkAntigravityProxy(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(ANTIGRAVITY_URL + '/health', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return { status: 'ok', message: 'Antigravity proxy reachable', details: { url: ANTIGRAVITY_URL, statusCode: res.status } };
    }
    return { status: 'degraded', message: 'Antigravity proxy responded with ' + res.status, details: { url: ANTIGRAVITY_URL, statusCode: res.status } };
  } catch (err) {
    return { status: 'down', message: 'Antigravity proxy unreachable: ' + String(err), details: { url: ANTIGRAVITY_URL } };
  }
}

async function checkDeadLetter(): Promise<CheckResult> {
  try {
    const items = await listDeadLetter();
    const depth = items.length;
    if (depth === 0) return { status: 'ok', message: 'Dead-letter queue empty', details: { depth } };
    if (depth < 10) return { status: 'ok', message: depth + ' items in dead-letter queue', details: { depth } };
    return { status: 'degraded', message: depth + ' items in dead-letter queue (threshold: 10)', details: { depth } };
  } catch {
    return { status: 'ok', message: 'Dead-letter queue not initialized', details: { depth: 0 } };
  }
}

function checkMonitoring(): CheckResult {
  try {
    const monitor = getMonitor();
    const stats = monitor.getStats();
    const activeAlerts = monitor.getActiveAlerts().length;
    if (activeAlerts > 0) {
      return { status: 'degraded', message: activeAlerts + ' active alerts', details: { activeAlerts, totalErrors: stats.totalErrors } };
    }
    return { status: 'ok', message: 'No active alerts', details: { totalErrors: stats.totalErrors, uptime: stats.uptime } };
  } catch {
    return { status: 'ok', message: 'Monitor not initialized' };
  }
}

function overallStatus(checks: HealthReport['checks']): 'ok' | 'degraded' | 'down' {
  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.includes('down')) return 'down';
  if (statuses.includes('degraded')) return 'degraded';
  return 'ok';
}

export async function getHealthReport(): Promise<HealthReport> {
  const [antigravityProxy, deadLetter] = await Promise.all([
    checkAntigravityProxy(),
    checkDeadLetter(),
  ]);
  const monitoring = checkMonitoring();
  const checks = { antigravityProxy, deadLetter, monitoring };
  return {
    status: overallStatus(checks),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    checks,
  };
}
