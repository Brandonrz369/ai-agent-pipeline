/**
 * Human Escalation Aggregator -- T23 (Charlie)
 *
 * Aggregates all STUCK/ESCALATED tasks from:
 *   1. Dead-letter queue (tasks that exceeded TTL)
 *   2. Pending HITL approvals (waiting for human decision)
 *   3. TaskStore BLOCKED tasks (Legacy Agency tasks blocked)
 *   4. Dead-letter items with envelope.escalated === true
 */

import { listDeadLetter } from '../anti-loop/dead-letter.js';
import { listPendingApprovals } from '../security/discord-hitl.js';
import { getTaskStore } from '../adapters/task-store.js';

export type EscalationType = 'DEAD_LETTER' | 'HITL_PENDING' | 'BLOCKED' | 'ESCALATED';
export type EscalationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface EscalationItem {
  id: string;
  type: EscalationType;
  reason: string;
  taskId?: string;
  description?: string;
  ageMs: number;
  severity: EscalationSeverity;
  metadata: Record<string, unknown>;
}

export interface EscalationReport {
  generatedAt: string;
  totalCount: number;
  criticalCount: number;
  items: EscalationItem[];
  byType: Record<EscalationType, number>;
}

function ageMs(isoTimestamp: string): number {
  return Date.now() - new Date(isoTimestamp).getTime();
}

export function formatEscalationAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h ago';
}

const SEVERITY_ORDER: Record<EscalationSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export async function getEscalationReport(): Promise<EscalationReport> {
  const items: EscalationItem[] = [];

  const deadLetterItems = await listDeadLetter();
  for (const dl of deadLetterItems) {
    const escalated = dl.envelope.escalated;
    items.push({
      id: dl.id,
      type: escalated ? 'ESCALATED' : 'DEAD_LETTER',
      reason: dl.reason,
      taskId: dl.task?.task_id,
      description: dl.task?.task.objective,
      ageMs: ageMs(dl.sent_at),
      severity: escalated ? 'HIGH' : 'CRITICAL',
      metadata: {
        sent_at: dl.sent_at,
        hops: dl.envelope.hops,
        ttl_max: dl.envelope.ttl_max,
        consecutive_failures: dl.envelope.consecutive_failures,
        file_path: dl.file_path,
      },
    });
  }

  const pendingHitl = listPendingApprovals();
  for (const approval of pendingHitl) {
    items.push({
      id: approval.key,
      type: 'HITL_PENDING',
      reason: 'Awaiting human approval via Discord HITL',
      taskId: approval.taskId,
      description: 'Gate: ' + approval.gateId,
      ageMs: 0,
      severity: 'HIGH',
      metadata: {
        gate_id: approval.gateId,
        task_id: approval.taskId,
      },
    });
  }

  const store = getTaskStore();
  const blockedResult = store.list({ status: 'BLOCKED', limit: 100 });
  for (const task of blockedResult.data) {
    items.push({
      id: task.id,
      type: 'BLOCKED',
      reason: 'Legacy Agency task is BLOCKED',
      taskId: task.id,
      description: task.description,
      ageMs: ageMs(task.updatedAt),
      severity: 'MEDIUM',
      metadata: {
        assigned: task.assigned,
        clientName: task.clientName,
        applicationName: task.applicationName,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    });
  }

  items.sort((a, b) => {
    const sd = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sd !== 0) return sd;
    return b.ageMs - a.ageMs;
  });

  const byType: Record<EscalationType, number> = {
    DEAD_LETTER: 0,
    HITL_PENDING: 0,
    BLOCKED: 0,
    ESCALATED: 0,
  };
  for (const item of items) {
    byType[item.type]++;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalCount: items.length,
    criticalCount: items.filter((i) => i.severity === 'CRITICAL').length,
    items,
    byType,
  };
}
