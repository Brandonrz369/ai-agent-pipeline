import type { TaskBlueprint, Tier } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface RoutingDecision {
  task_id: string;
  tier: Tier;
  reason: string;
}

// Keyword-based tier routing rules (from routing-config.schema.json)
const TIER_RULES: { pattern: RegExp; tier: Tier; label: string }[] = [
  // Tier 1 — Runners (simple reads, queries, boilerplate)
  { pattern: /\b(read|list|check|validate|count|query|fetch|cache)\b/i, tier: 1, label: 'simple tool operation' },
  // Tier 3 — Synthesis (architecture, deep analysis)
  { pattern: /\b(architect|design|research|analyze deeply|strategy|decompose|plan)\b/i, tier: 3, label: 'architecture/synthesis' },
  // Tier 2 — Workers (code gen, editing, most tasks) — default
  { pattern: /\b(create|write|edit|implement|build|code|fix|update|refactor|test)\b/i, tier: 2, label: 'code generation/editing' },
];

export function routeTask(task: TaskBlueprint): RoutingDecision {
  // 1. Explicit tier in metadata takes precedence
  if (task.metadata.tier) {
    return {
      task_id: task.task_id,
      tier: task.metadata.tier,
      reason: `Tier ${task.metadata.tier} specified in task metadata`,
    };
  }

  // 2. Priority-based routing
  if (task.metadata.priority === 'P1') {
    return {
      task_id: task.task_id,
      tier: 3,
      reason: 'P1 priority → tier 3 synthesis',
    };
  }

  // 3. Task type routing
  if (task.task.type === 'RESEARCH') {
    return { task_id: task.task_id, tier: 3, reason: 'RESEARCH type → tier 3' };
  }
  if (task.task.type === 'REVIEW') {
    return { task_id: task.task_id, tier: 1, reason: 'REVIEW type → tier 1' };
  }

  // 4. Keyword-based routing
  const combined = `${task.task.objective} ${task.task.instructions.join(' ')}`;
  for (const rule of TIER_RULES) {
    if (rule.pattern.test(combined)) {
      return {
        task_id: task.task_id,
        tier: rule.tier,
        reason: `Keyword match: ${rule.label}`,
      };
    }
  }

  // 5. Default to tier 2
  return {
    task_id: task.task_id,
    tier: 2,
    reason: 'Default routing → tier 2 worker',
  };
}

export function routeBatch(tasks: TaskBlueprint[]): RoutingDecision[] {
  const decisions = tasks.map(routeTask);

  const tierCounts = { 1: 0, 2: 0, 3: 0 };
  for (const d of decisions) tierCounts[d.tier]++;

  logger.info('Batch routing complete', {
    total: tasks.length,
    tier1: tierCounts[1],
    tier2: tierCounts[2],
    tier3: tierCounts[3],
  });

  return decisions;
}
