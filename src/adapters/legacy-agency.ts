/**
 * Legacy Automation Agency Adapter
 *
 * Converts task submissions from the Legacy Automation Agency Express server
 * (plain JS, port 3000) into pipeline TaskBlueprints that can be dispatched
 * through our completion loop.
 *
 * This replaces the agency's custom queue.js + openclaw-bridge.js with our
 * tested pipeline: anti-loop, hysteresis, HITL, audit trail, retry/backoff.
 */

import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GeminiOrchestrator } from '../orchestrator/index.js';
import type { LoopResult } from '../orchestrator/loop-driver.js';
import { logAuditEntry } from '../audit/index.js';
import { logger } from '../utils/logger.js';
import { getMonitor } from '../monitoring/index.js';
import type { TaskBlueprint, TaskType, PromptMode, Priority, Tier } from '../types/index.js';

export interface LegacyAgencyTask {
  id?: string;
  description: string;
  clientName?: string;
  applicationName?: string;  // e.g., "Dentrix", "QuickBooks", "SAP"
  taskType?: 'data_entry' | 'report_generation' | 'gui_automation' | 'document_processing';
  urgency?: 'low' | 'medium' | 'high' | 'critical';
  documents?: string[];      // uploaded file paths
  screenshots?: string[];    // reference screenshots
  instructions?: string;     // free-form client instructions
}

/**
 * Convert a Legacy Agency task into a pipeline TaskBlueprint.
 */
export function convertToBlueprint(agencyTask: LegacyAgencyTask): TaskBlueprint {
  const taskId = formatTaskId(agencyTask);
  const { pipelineType, mode, tier, priority } = classifyAgencyTask(agencyTask);

  const instructions = buildInstructions(agencyTask);

  return {
    task_id: taskId,
    metadata: {
      project: 'LEGACY-AGENCY',
      node: 1,
      workstream: agencyTask.applicationName || 'general',
      batch: 1,
      priority,
      tier,
    },
    task: {
      type: pipelineType,
      objective: agencyTask.description,
      instructions,
      dependencies: [],
      mcp_tools_required: getMcpTools(mode),
      context_queries: getContextQueries(agencyTask),
    },
    output: {
      report_file: `reports/${taskId}.md`,
      status_options: ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED'],
    },
    constraints: {
      write_scope: getWriteScope(agencyTask),
      read_scope: ['*'],
      forbidden: ['node_modules/', '.env', '.git/'],
      requires_human_approval: tier >= 3 || agencyTask.urgency === 'critical',
    },
  };
}

/**
 * Convert multiple agency tasks into a batch of blueprints.
 */
export function convertBatch(tasks: LegacyAgencyTask[]): TaskBlueprint[] {
  return tasks.map(convertToBlueprint);
}

// ─── Internal Helpers ────────────────────────────────────────────

function formatTaskId(task: LegacyAgencyTask): string {
  // Generate a deterministic 3-digit sequence from task id or random
  const source = task.id || randomUUID();
  const hash = source.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const seq = String(hash % 1000).padStart(3, '0');
  const year = new Date().getFullYear();
  return `LEGACY-${year}-${seq}-B1-N1`;
}

function classifyAgencyTask(task: LegacyAgencyTask): {
  pipelineType: TaskType;
  mode: PromptMode;
  tier: Tier;
  priority: Priority;
} {
  const urgencyMap: Record<string, Priority> = {
    critical: 'P1',
    high: 'P2',
    medium: 'P3',
    low: 'P4',
  };

  const priority = urgencyMap[task.urgency || 'medium'] || 'P3';

  switch (task.taskType) {
    case 'gui_automation':
      return { pipelineType: 'EXECUTE', mode: 'SUPERVISE', tier: 2, priority };
    case 'data_entry':
      return { pipelineType: 'EXECUTE', mode: 'SUPERVISE', tier: 2, priority };
    case 'report_generation':
      return { pipelineType: 'CREATE', mode: 'EXECUTE', tier: 2, priority };
    case 'document_processing':
      return { pipelineType: 'REVIEW', mode: 'EXECUTE', tier: 1, priority };
    default:
      return { pipelineType: 'EXECUTE', mode: 'EXECUTE', tier: 2, priority };
  }
}

function buildInstructions(task: LegacyAgencyTask): string[] {
  const instructions: string[] = [];

  if (task.applicationName) {
    instructions.push(`Target application: ${task.applicationName}`);
  }

  if (task.instructions) {
    instructions.push(task.instructions);
  }

  instructions.push(task.description);

  if (task.documents && task.documents.length > 0) {
    instructions.push(`Reference documents: ${task.documents.join(', ')}`);
  }

  if (task.screenshots && task.screenshots.length > 0) {
    instructions.push(`Reference screenshots: ${task.screenshots.join(', ')}`);
  }

  instructions.push('Return JSON with task_id, status (PASS/FAIL), and summary');

  return instructions;
}

function getMcpTools(mode: PromptMode): string[] {
  switch (mode) {
    case 'SUPERVISE':
      return ['filesystem', 'bash', 'computer_use', 'gemini-cache'];
    case 'ARCHITECT':
      return ['filesystem', 'gemini-cache'];
    default:
      return ['filesystem', 'bash', 'gemini-cache'];
  }
}

function getContextQueries(task: LegacyAgencyTask): string[] {
  const queries: string[] = [];

  if (task.applicationName) {
    queries.push(`What are the standard procedures for automating ${task.applicationName}?`);
    queries.push(`What GUI patterns does ${task.applicationName} use?`);
  }

  return queries;
}

function getWriteScope(task: LegacyAgencyTask): string[] {
  return [
    'reports/',
    'results/',
    'screenshots/',
  ];
}

// ─── Pipeline Adapter (async bridge) ────────────────────────────

export type AdapterTaskStatus =
  | 'submitted'
  | 'dispatching'
  | 'running'
  | 'completed'
  | 'failed'
  | 'dead_letter';

export interface TrackedTask {
  legacyId: string;
  pipelineTaskId: string;
  blueprint: TaskBlueprint;
  status: AdapterTaskStatus;
  submittedAt: string;
  completedAt?: string;
  result?: LoopResult;
  error?: string;
}

export interface PipelineAdapterConfig {
  pipelineDir: string;
  resultsDir?: string;
  dryRun?: boolean;
  onStatusChange?: (legacyId: string, status: AdapterTaskStatus, result?: LoopResult) => void;
}

/**
 * PipelineAdapter — bridges the Legacy Agency Express server to our pipeline.
 *
 * Usage from Legacy Agency server.js:
 *   const adapter = new PipelineAdapter({ pipelineDir: '/home/brans/ai-agent-pipeline' });
 *   const { taskId } = await adapter.submit(legacyTask);
 *   // later:
 *   const status = adapter.getStatus(taskId);
 */
export class PipelineAdapter {
  private config: PipelineAdapterConfig;
  private orchestrator: GeminiOrchestrator;
  private tasks: Map<string, TrackedTask> = new Map();

  constructor(config: PipelineAdapterConfig) {
    this.config = config;
    this.orchestrator = new GeminiOrchestrator({
      dryRun: config.dryRun,
      cwd: config.pipelineDir,
    });
  }

  /**
   * Submit a legacy agency task for pipeline processing.
   * Returns immediately with task IDs. Dispatches asynchronously.
   */
  async submit(legacyTask: LegacyAgencyTask): Promise<{
    legacyId: string;
    pipelineTaskId: string;
  }> {
    const legacyId = legacyTask.id || `LEGACY-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const blueprint = convertToBlueprint({ ...legacyTask, id: legacyId });

    const tracked: TrackedTask = {
      legacyId,
      pipelineTaskId: blueprint.task_id,
      blueprint,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
    };
    this.tasks.set(legacyId, tracked);

    // Save blueprint to disk for audit trail
    const resultsDir = this.config.resultsDir || join(this.config.pipelineDir, '.pipeline-run');
    await mkdir(resultsDir, { recursive: true });
    await writeFile(
      join(resultsDir, `${blueprint.task_id}.blueprint.json`),
      JSON.stringify(blueprint, null, 2),
    );

    logger.info('Legacy task submitted to pipeline', {
      legacyId,
      pipelineTaskId: blueprint.task_id,
      type: blueprint.task.type,
      tier: blueprint.metadata.tier,
    });

    await logAuditEntry('LEGACY_TASK_SUBMITTED', {
      legacyId,
      pipelineTaskId: blueprint.task_id,
      description: legacyTask.description?.slice(0, 200),
    }, blueprint.task_id);

    // Dispatch asynchronously — don't block the caller
    this.dispatchAsync(tracked);

    return { legacyId, pipelineTaskId: blueprint.task_id };
  }

  /**
   * Get the current status of a tracked task.
   */
  getStatus(legacyId: string): TrackedTask | null {
    return this.tasks.get(legacyId) || null;
  }

  /**
   * List all tracked tasks.
   */
  listTasks(): TrackedTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get counts by status.
   */
  getCounts(): Record<AdapterTaskStatus, number> {
    const counts: Record<AdapterTaskStatus, number> = {
      submitted: 0,
      dispatching: 0,
      running: 0,
      completed: 0,
      failed: 0,
      dead_letter: 0,
    };
    for (const task of this.tasks.values()) {
      counts[task.status]++;
    }
    return counts;
  }

  // ─── Internal ─────────────────────────────────────────────────

  private async dispatchAsync(tracked: TrackedTask): Promise<void> {
    try {
      this.updateStatus(tracked, 'dispatching');
      this.updateStatus(tracked, 'running');

      const result = await this.orchestrator.dispatchTask(tracked.blueprint);

      tracked.result = result;
      tracked.completedAt = new Date().toISOString();

      if (result.deadLettered) {
        this.updateStatus(tracked, 'dead_letter');
        await getMonitor().recordError(
          'dead-letter', 'dead_letter',
          `Task dead-lettered after ${result.totalHops} hops`,
          tracked.pipelineTaskId,
          { legacyId: tracked.legacyId, hops: result.totalHops },
        );
      } else if (result.status === 'PASS') {
        this.updateStatus(tracked, 'completed');
      } else {
        this.updateStatus(tracked, 'failed');
        await getMonitor().recordError(
          'adapter', 'task_failure',
          `Task completed with status ${result.status}`,
          tracked.pipelineTaskId,
          { legacyId: tracked.legacyId, status: result.status, hops: result.totalHops },
        );
      }

      // Save result to disk
      const resultsDir = this.config.resultsDir || join(this.config.pipelineDir, '.pipeline-run');
      await writeFile(
        join(resultsDir, `${tracked.pipelineTaskId}.result.json`),
        JSON.stringify({ tracked, result }, null, 2),
      );

      await logAuditEntry('LEGACY_TASK_COMPLETE', {
        legacyId: tracked.legacyId,
        pipelineTaskId: tracked.pipelineTaskId,
        status: tracked.status,
        hops: result.totalHops,
      }, tracked.pipelineTaskId);

      logger.info('Legacy task completed', {
        legacyId: tracked.legacyId,
        status: tracked.status,
        hops: result.totalHops,
      });
    } catch (err) {
      tracked.error = String(err);
      tracked.completedAt = new Date().toISOString();
      this.updateStatus(tracked, 'failed');

      logger.error('Legacy task dispatch failed', {
        legacyId: tracked.legacyId,
        error: String(err),
      });

      await getMonitor().recordError(
        'adapter', 'task_failure',
        `Dispatch exception: ${String(err).slice(0, 200)}`,
        tracked.pipelineTaskId,
        { legacyId: tracked.legacyId },
      );
    }
  }

  private updateStatus(tracked: TrackedTask, status: AdapterTaskStatus): void {
    tracked.status = status;
    this.config.onStatusChange?.(tracked.legacyId, status, tracked.result);
  }
}
