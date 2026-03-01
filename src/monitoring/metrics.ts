import { randomUUID } from 'node:crypto';
import { getDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import type { ClaudeOutput, TaskEnvelope } from '../types/index.js';

export interface PerformanceMetric {
  id: string;
  task_id: string;
  trace_id: string;
  node_id: string;
  hop: number;
  mode: string;
  duration_ms: number;
  cost_usd: number;
  status: string;
  timestamp: string;
}

export async function recordPerformanceMetric(
  envelope: TaskEnvelope,
  output: ClaudeOutput,
  nodeId: string = 'node-master'
): Promise<void> {
  try {
    const db = getDb();
    const metric: PerformanceMetric = {
      id: randomUUID(),
      task_id: output.task_id || envelope.task_id_ref || 'unknown',
      trace_id: envelope.trace_id,
      node_id: nodeId,
      hop: envelope.hops,
      mode: envelope.mode,
      duration_ms: output.duration_ms || 0,
      cost_usd: output.cost_usd || 0,
      status: output.status,
      timestamp: new Date().toISOString()
    };

    db.prepare(`
      INSERT INTO performance_metrics (id, task_id, trace_id, node_id, hop, mode, duration_ms, cost_usd, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metric.id,
      metric.task_id,
      metric.trace_id,
      metric.node_id,
      metric.hop,
      metric.mode,
      metric.duration_ms,
      metric.cost_usd,
      metric.status,
      metric.timestamp
    );

    logger.debug('Performance metric recorded', { taskId: metric.task_id, duration: metric.duration_ms });
  } catch (err) {
    logger.error('Failed to record performance metric', { error: String(err) });
  }
}

export function getSummaryMetrics() {
  const db = getDb();
  return db.prepare(`
    SELECT 
      count(*) as total_hops,
      avg(duration_ms) as avg_duration,
      sum(cost_usd) as total_cost,
      count(CASE WHEN status = 'PASS' THEN 1 END) as success_count
    FROM performance_metrics
  `).get() as { total_hops: number, avg_duration: number, total_cost: number, success_count: number };
}
