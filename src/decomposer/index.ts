import { AntigravityClient } from '../utils/antigravity-client.js';
import { readFile } from 'node:fs/promises';
import type { TaskBlueprint } from '../types/index.js';
import { validateAgainstSchema } from '../schema/validator.js';
import { logger } from '../utils/logger.js';

export interface DecompositionResult {
  tasks: TaskBlueprint[];
  validationErrors: string[];
  raw_response: string;
}

export class TaskDecomposer {
  private client: AntigravityClient;

  constructor(_apiKeyUnused?: string, model = 'gemini-3.1-pro-high') {
    this.client = new AntigravityClient(model);
  }

  async decomposeFromResearch(researchContent: string, project = 'PIPELINE'): Promise<DecompositionResult> {
    const prompt = this.buildDecompositionPrompt(researchContent, project);

    const response = await this.client.generateContent(prompt, 8192);

    const text = response.text ?? '';
    return this.parseAndValidate(text);
  }

  async decomposeFromFile(filePath: string, project = 'PIPELINE'): Promise<DecompositionResult> {
    const content = await readFile(filePath, 'utf-8');
    return this.decomposeFromResearch(content, project);
  }

  private buildDecompositionPrompt(research: string, project: string): string {
    return `You are a task decomposer for an autonomous AI agent pipeline. Given the research/requirements below, break them into independently executable task blueprints.

Each task must follow this JSON schema:
{
  "task_id": "${project}-2026-XXX-B1-N1" (unique, sequential),
  "metadata": { "project": "${project}", "node": 1-4, "workstream": "...", "batch": 1, "priority": "P1-P4", "tier": 1-3 },
  "task": { "type": "CREATE|EDIT|REVIEW|RESEARCH|EXECUTE", "objective": "...", "instructions": ["..."], "dependencies": [], "mcp_tools_required": [], "context_queries": [] },
  "output": { "report_file": "reports/...", "status_options": ["PASS","FAIL","PARTIAL","BLOCKED"] },
  "constraints": { "write_scope": ["..."], "read_scope": ["*"], "forbidden": [], "requires_human_approval": false }
}

RULES:
- Each task must be independently executable (no circular deps)
- Tasks should be small enough for one Claude Code session (~50K tokens)
- Assign tier: 1 for simple reads, 2 for code/edit, 3 for architecture/research
- Set dependencies only when truly required

RESEARCH/REQUIREMENTS:
${research}

Return a JSON array of task blueprints. No other text.`;
  }

  private async parseAndValidate(text: string): Promise<DecompositionResult> {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return {
        tasks: [],
        validationErrors: ['Could not extract JSON array from Gemini response'],
        raw_response: text,
      };
    }

    let tasks: TaskBlueprint[];
    try {
      tasks = JSON.parse(jsonMatch[0]);
    } catch (err) {
      return {
        tasks: [],
        validationErrors: [`JSON parse error: ${String(err)}`],
        raw_response: text,
      };
    }

    // Validate each task
    const errors: string[] = [];
    const validTasks: TaskBlueprint[] = [];

    for (const task of tasks) {
      const result = await validateAgainstSchema(task, 'task-blueprint');
      if (result.valid) {
        validTasks.push(task);
      } else {
        errors.push(`${task.task_id || 'unknown'}: ${result.errors.join('; ')}`);
        // Include anyway with a note
        validTasks.push(task);
      }
    }

    logger.info('Decomposition complete', {
      total: tasks.length,
      valid: validTasks.length - errors.length,
      withErrors: errors.length,
    });

    return {
      tasks: validTasks,
      validationErrors: errors,
      raw_response: text,
    };
  }
}
