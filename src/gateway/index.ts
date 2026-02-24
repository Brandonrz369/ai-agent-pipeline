import { GeminiOrchestrator } from '../orchestrator/index.js';
import { createWebhookServer, type WebhookConfig } from './webhook.js';
import { installSkill } from './skill.js';
import type { TaskBlueprint } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface GatewayConfig {
  port?: number;
  geminiApiKey?: string;
  cwd?: string;
}

export class PipelineGateway {
  private orchestrator: GeminiOrchestrator;
  private webhook: ReturnType<typeof createWebhookServer> | null = null;
  private config: GatewayConfig;

  constructor(config: GatewayConfig = {}) {
    this.config = config;
    this.orchestrator = new GeminiOrchestrator({
      geminiApiKey: config.geminiApiKey,
      cwd: config.cwd,
    });
  }

  async startWebhookServer() {
    const webhookConfig: WebhookConfig = {
      port: this.config.port || 3847,
      onTaskReceived: async (body) => {
        const tasks = Array.isArray(body) ? body : [body];
        logger.info('Gateway received tasks', { count: tasks.length });
        await this.orchestrator.dispatchBatch(tasks as TaskBlueprint[], true);
      },
      onHITLResponse: async (gateId, decision) => {
        logger.info('Gateway received HITL response', { gateId, decision });
      },
    };

    this.webhook = createWebhookServer(webhookConfig);
    await this.webhook.start();
    return this.webhook;
  }

  async stopWebhookServer() {
    if (this.webhook) {
      await this.webhook.stop();
      this.webhook = null;
    }
  }

  async installSkill() {
    return installSkill();
  }

  getOrchestrator() {
    return this.orchestrator;
  }
}

export { createWebhookServer } from './webhook.js';
export { installSkill } from './skill.js';
