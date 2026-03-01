import type { PromptMode, TaskBlueprint, ClaudeOutput, TaskEnvelope, TaskStatus } from '../types/index.js';
import { spawnClaudeSession, type SessionResult } from './session.js';
import { getModeConfig, getTemplatePath } from './modes.js';
import { loadTemplate } from '../utils/template.js';
import { logger } from '../utils/logger.js';
import { runSuperviseSession, type SuperviseHandlerOptions } from './supervise.js';
import { enforceToolPermission } from '../security/rbac.js';

export interface ExecutorOptions {
  cwd?: string;
  timeoutMs?: number;
  superviseOptions?: SuperviseHandlerOptions;
}

export class ClaudeCodeExecutor {
  private options: ExecutorOptions;
  constructor(options: ExecutorOptions = {}) { this.options = options; }
  async formatPrompt(task: TaskBlueprint, envelope: TaskEnvelope): Promise<string> {
    const mode = envelope.mode;
    const templatePath = getTemplatePath(mode);
    const variables: Record<string, string> = {
      task_id: task.task_id,
      objective: task.task.objective,
      workstream: task.metadata.workstream,
      priority: task.metadata.priority,
      tier: String(task.metadata.tier),
      instructions: task.task.instructions.join('\n- '),
      ttl_remaining: String(envelope.ttl_max - envelope.hops),
      current_hop: String(envelope.hops),
      mode: envelope.mode,
      write_scope: (task.constraints.write_scope || []).join(', '),
      read_scope: (task.constraints.read_scope || []).join(', '),
      forbidden: (task.constraints.forbidden || []).join(', '),
    };
    try {
      const template = await loadTemplate(templatePath, variables);
      return template;
    } catch {
      return this.buildDirectPrompt(task, envelope);
    }
  }
  private buildDirectPrompt(task: TaskBlueprint, envelope: TaskEnvelope): string {
    const modeConfig = getModeConfig(envelope.mode);
    return [
      '# Task: ' + task.task_id,
      '## Mode: ' + envelope.mode + ' -- ' + modeConfig.description,
      '## Objective', task.task.objective,
      '## Instructions', ...task.task.instructions.map((i) => '- ' + i),
      '## Constraints',
      '- Write scope: ' + (task.constraints.write_scope || []).join(', '),
      '- Read scope: ' + (task.constraints.read_scope || []).join(', '),
      '- Forbidden: ' + (task.constraints.forbidden || []).join(', '),
    ].join('\n');
  }
  async execute(task: TaskBlueprint, envelope: TaskEnvelope): Promise<{ result: SessionResult; output: ClaudeOutput }> {
    // RBAC Enforcement: Verify tool permissions (T39)
    const requiredTools = task.task.mcp_tools_required || [];
    for (const tool of requiredTools) {
      await enforceToolPermission(task.metadata.node, tool, task.task_id);
    }

    if (envelope.mode === 'SUPERVISE') { return this.executeSupervise(task, envelope); }
    const prompt = await this.formatPrompt(task, envelope);
    logger.info('Executing task via Claude Code', { task_id: task.task_id, mode: envelope.mode, hop: envelope.hops });
    const result = await spawnClaudeSession({ mode: envelope.mode, prompt, sessionId: envelope.session_ids[envelope.session_ids.length - 1], timeoutMs: this.options.timeoutMs, cwd: this.options.cwd });
    const output: ClaudeOutput = result.output || { task_id: task.task_id, status: result.success ? 'PASS' : 'FAIL', summary: result.rawOutput.slice(0, 500) || result.rawError.slice(0, 500) || 'No output' };
    if (result.sessionId) { envelope.session_ids.push(result.sessionId); }
    return { result, output };
  }
  private async executeSupervise(task: TaskBlueprint, envelope: TaskEnvelope): Promise<{ result: SessionResult; output: ClaudeOutput }> {
    const startTime = Date.now();
    if (!this.options.superviseOptions?.provider) {
      logger.warn('SUPERVISE mode: no ComputerUseProvider configured', { task_id: task.task_id });
      const output: ClaudeOutput = { task_id: task.task_id, status: 'FAIL', summary: 'SUPERVISE mode: no ComputerUseProvider configured in executor options.', duration_ms: 1 };
      return { result: { success: false, output, rawOutput: '', rawError: 'No provider', exitCode: 1, durationMs: 1 }, output };
    }
    const superviseResult = await runSuperviseSession(task, envelope, this.options.superviseOptions as SuperviseHandlerOptions);
    const status: TaskStatus = superviseResult.status === 'PASS' ? 'PASS' : superviseResult.status === 'STUCK' ? 'BLOCKED' : 'FAIL';
    const output: ClaudeOutput = {
      task_id: superviseResult.task_id,
      status,
      summary: superviseResult.summary,
      affected_files: [], // Supervise result would need to track this if it modifies local files
      duration_ms: superviseResult.duration_ms,
    };
    if (superviseResult.mcp_cache_key) { envelope.mcp_cache_key = superviseResult.mcp_cache_key; }
    const durationMs = superviseResult.duration_ms || Date.now() - startTime;
    return { result: { success: status === 'PASS', output, rawOutput: JSON.stringify(superviseResult), rawError: '', exitCode: status === 'PASS' ? 0 : 1, durationMs }, output };
  }
}

export { spawnClaudeSession } from './session.js';
export { getModeConfig, getCliFlags, getTemplatePath } from './modes.js';
export { runSuperviseSession, StubComputerUseProvider } from './supervise.js';
