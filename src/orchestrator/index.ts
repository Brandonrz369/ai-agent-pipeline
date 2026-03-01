import { AntigravityClient } from '../utils/antigravity-client.js';
import type { TaskBlueprint } from '../types/index.js';
import { CompletionLoopDriver, type LoopDriverConfig, type LoopResult } from './loop-driver.js';
import { WorkerRegistry } from './registry.js';
import { loadPipelineConfig } from '../config/loader.js';
import { logger } from '../utils/logger.js';

export interface OrchestratorConfig {
  geminiApiKey?: string;
  dryRun?: boolean;
  cwd?: string;
}

export class GeminiOrchestrator {
  private client: AntigravityClient;
  private config: OrchestratorConfig;
  private loopDriver: CompletionLoopDriver | null = null;
  public registry: WorkerRegistry;

  constructor(config: OrchestratorConfig = {}) {
    this.client = new AntigravityClient('gemini-3.1-pro-high');
    this.config = config;
    this.registry = new WorkerRegistry();
    
    // Auto-register local node for Phase 4 coordination
    void this.initLocalNode();
  }

  private async initLocalNode() {
    const os = await import('node:os');
    await this.registry.registerNode({
      id: 'node-master',
      hostname: os.hostname(),
      ip: '127.0.0.1',
      port: 3847,
      status: 'ONLINE',
      capabilities: ['EXECUTE', 'ARCHITECT', 'SUPERVISE'],
      last_seen: new Date().toISOString(),
      load_average: os.loadavg()[0]
    });
  }

  private async getLoopDriver(): Promise<CompletionLoopDriver> {
    if (this.loopDriver) return this.loopDriver;

    const pipelineConfig = await loadPipelineConfig();
    const driverConfig: LoopDriverConfig = {
      geminiApiKey: this.config.geminiApiKey || process.env.GEMINI_API_KEY || '',
      orchestratorModel: 'gemini-3.1-pro-high',
      verifierModel: 'gemini-3.1-pro-high',
      ttlMax: pipelineConfig.anti_loop.ttl_max,
      deadLetterPath: pipelineConfig.dead_letter.path,
      cwd: this.config.cwd,
      dryRun: this.config.dryRun,
    };

    this.loopDriver = new CompletionLoopDriver(driverConfig);
    return this.loopDriver;
  }

  async dispatchTask(task: TaskBlueprint): Promise<LoopResult> {
    const driver = await this.getLoopDriver();
    logger.info('Orchestrator dispatching task', {
      task_id: task.task_id,
      type: task.task.type,
      tier: task.metadata.tier,
    });
    return driver.run(task);
  }

  async dispatchBatch(tasks: TaskBlueprint[], parallel = false): Promise<LoopResult[]> {
    if (parallel) {
      logger.info('Dispatching batch in parallel', { count: tasks.length });
      return Promise.all(tasks.map((t) => this.dispatchTask(t)));
    }

    logger.info('Dispatching batch sequentially', { count: tasks.length });
    const results: LoopResult[] = [];
    for (const task of tasks) {
      results.push(await this.dispatchTask(task));
    }
    return results;
  }

  async summarizeForMobile(results: LoopResult[]): Promise<string> {
    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    const deadLettered = results.filter((r) => r.status === 'DEAD_LETTER').length;

    const summary = [
      `Pipeline batch complete:`,
      `✓ ${passed} passed | ✗ ${failed} failed | ☠ ${deadLettered} dead-lettered`,
      '',
      ...results.map((r) => `${r.status === 'PASS' ? '✓' : '✗'} ${r.task_id}: ${r.output?.summary?.slice(0, 80) || 'no output'}`),
    ].join('\n');

    return summary;
  }
}

export { CompletionLoopDriver } from './loop-driver.js';
export { classifyTask } from './classifier.js';
export { formatPromptForMode } from './prompt-formatter.js';
