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
  const seq = String(Math.floor(Math.random() * 999)).padStart(3, '0');
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
      return ['filesystem', 'bash', 'gemini-cache'];
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
