import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync, spawn } from 'node:child_process';
import type { TaskBlueprint, TaskEnvelope, LoopAction, ClaudeOutput } from '../types/index.js';
import { AntiLoopEngine } from '../anti-loop/index.js';
import { FlashLiteVerifier } from '../verifier/index.js';
import { classifyTask } from '../orchestrator/classifier.js';
import { formatPromptForMode } from '../orchestrator/prompt-formatter.js';
import { logAuditEntry } from '../audit/index.js';
import { AntigravityClient } from '../utils/antigravity-client.js';
import { logger } from '../utils/logger.js';

/**
 * OpenClaw Bridge — Uses OpenClaw as the orchestration brain.
 *
 * Instead of our standalone GeminiOrchestrator calling the Gemini API directly,
 * this bridge leverages OpenClaw's existing infrastructure:
 *
 * 1. OpenClaw's Gemini 3.1 Pro → classifies and routes tasks
 * 2. OpenClaw's coding-agent skill → spawns Claude Code sessions
 * 3. OpenClaw's tmux skill → monitors long-running sessions
 * 4. OpenClaw's Discord → HITL notifications and approvals
 * 5. OpenClaw's cron → scheduled pipeline runs and cache refreshes
 * 6. OpenClaw's watchdog → restarts dead sessions
 *
 * The pipeline's knowledge base (pipeline-kb, pipeline-deliverables) lives
 * in Gemini caches, queryable via the gemini MCP skill.
 */

const OPENCLAW_STATE_DIR = join(homedir(), '.openclaw', 'state');
const OPENCLAW_WORKSPACE = join(homedir(), '.openclaw', 'workspace');
const PIPELINE_STATE_FILE = join(OPENCLAW_STATE_DIR, 'pipeline-state.json');

export interface PipelineState {
  activeTasks: Map<string, TaskEnvelope>;
  completedTasks: string[];
  deadLettered: string[];
  lastRun: string;
  totalHops: number;
  cacheNames: {
    kb: string;
    deliverables: string;
    brainContext: string;
  };
}

export interface OpenClawBridgeConfig {
  geminiApiKey: string;
  pipelineDir: string;
  useOpenClawCodingAgent?: boolean;  // true = spawn via openclaw, false = direct claude CLI
  discordNotifications?: boolean;
  cacheKbName?: string;
  cacheDeliverablesName?: string;
}

export class OpenClawBridge {
  private config: OpenClawBridgeConfig;
  private antiLoop: AntiLoopEngine;
  private verifier: FlashLiteVerifier;

  constructor(config: OpenClawBridgeConfig) {
    this.config = config;
    this.antiLoop = new AntiLoopEngine();
    this.verifier = new FlashLiteVerifier(config.geminiApiKey);
  }

  /**
   * Query the pipeline knowledge base cache for context before executing.
   * This is what makes OpenClaw the "brain" — every task gets grounded
   * in the architecture docs before Claude executes.
   */
  async queryKnowledgeBase(question: string): Promise<string> {
    const cacheName = this.config.cacheKbName || 'pipeline-kb';
    try {
      // Use openclaw's gemini skill to query the cache
      const result = execSync(
        `openclaw agent -m "Use gemini-query-cache with cacheName '${cacheName}' to answer: ${question.replace(/'/g, "'\\''")}" --json 2>/dev/null`,
        { timeout: 30000, encoding: 'utf-8' },
      );
      return result.trim();
    } catch {
      logger.warn('KB cache query failed, falling back to direct Gemini');
      return '';
    }
  }

  /**
   * Spawn a Claude Code session via OpenClaw's coding-agent skill.
   * This uses tmux for session management and the watchdog for recovery.
   */
  async spawnViaOpenClaw(
    prompt: string,
    sessionName: string,
    cwd: string,
  ): Promise<{ sessionId: string; output: string }> {
    const escapedPrompt = prompt.replace(/'/g, "'\\''").replace(/\n/g, '\\n');

    if (this.config.useOpenClawCodingAgent) {
      // Route through OpenClaw's coding-agent skill (uses tmux, watchdog, etc.)
      try {
        const result = execSync(
          `openclaw agent -m "Use coding-agent to run claude -p '${escapedPrompt.slice(0, 500)}...' --output-format json in ${cwd}" --json 2>/dev/null`,
          { timeout: 300000, encoding: 'utf-8', cwd },
        );
        return { sessionId: sessionName, output: result.trim() };
      } catch (err) {
        logger.warn('OpenClaw coding-agent failed, falling back to direct spawn');
      }
    }

    // Direct Claude CLI spawn (fallback)
    return new Promise((resolve) => {
      // Remove CLAUDECODE env var to allow nested sessions
      const childEnv = { ...process.env };
      delete childEnv.CLAUDECODE;

      const proc = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
        cwd,
        timeout: 300000,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],  // stdin must be 'ignore' — Claude hangs on piped stdin
      });

      let stdout = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.on('close', () => {
        resolve({ sessionId: sessionName, output: stdout });
      });
      proc.on('error', () => {
        resolve({ sessionId: sessionName, output: '' });
      });
    });
  }

  /**
   * Send HITL notification via OpenClaw's Discord integration.
   */
  async notifyDiscord(channel: string, message: string): Promise<void> {
    if (!this.config.discordNotifications) return;

    try {
      execSync(
        `openclaw agent -m "Send a Discord message to ${channel}: ${message.replace(/"/g, '\\"')}" 2>/dev/null`,
        { timeout: 15000 },
      );
    } catch {
      logger.warn('Discord notification failed');
    }
  }

  /**
   * THE CORE: Run a task through the full pipeline using OpenClaw as brain.
   *
   * Flow:
   * 1. Query pipeline-kb cache for architectural context (Gemini = brain)
   * 2. Classify task type + select mode
   * 3. Format prompt with injected KB context
   * 4. Spawn Claude Code (via OpenClaw coding-agent or direct CLI)
   * 5. Verify output via Flash-Lite
   * 6. Anti-loop check (TTL, hysteresis, backflow)
   * 7. Retry or return
   */
  async runTask(task: TaskBlueprint): Promise<{
    status: 'PASS' | 'FAIL' | 'DEAD_LETTER';
    output: string;
    hops: number;
  }> {
    let envelope = task.envelope || this.antiLoop.createEnvelope(task.task_id, task.task_id);

    await logAuditEntry('PIPELINE_TASK_START', {
      task_id: task.task_id,
      type: task.task.type,
      tier: task.metadata.tier,
    }, task.task_id);

    // Step 1: Query knowledge base for context
    logger.info('Querying knowledge base for task context', { task_id: task.task_id });
    const kbContext = await this.queryKnowledgeBase(
      `What architecture guidance applies to a ${task.task.type} task for ${task.metadata.workstream}? Objective: ${task.task.objective}`,
    );

    // Step 2: Classify
    const classification = await classifyTask(task, this.config.geminiApiKey);
    if (!envelope.escalated) {
      envelope.mode = classification.promptMode;
    }

    logger.info('Task classified', {
      task_id: task.task_id,
      type: classification.taskType,
      mode: envelope.mode,
      tier: classification.tier,
    });

    // Step 3-7: Completion loop
    while (true) {
      const preHop = this.antiLoop.preHopCheck(envelope);
      if (!preHop.allowed) {
        await this.notifyDiscord('#dead-letter',
          `Task ${task.task_id} expired after ${envelope.hops} hops: ${preHop.reason}`);
        return { status: 'DEAD_LETTER', output: preHop.reason || '', hops: envelope.hops };
      }
      envelope = preHop.envelope;

      // Format prompt with KB context injected
      let prompt = await formatPromptForMode(task, envelope);
      if (kbContext) {
        prompt = `## Architecture Context (from pipeline knowledge base)\n${kbContext}\n\n${prompt}`;
      }

      // Execute via OpenClaw or direct
      const sessionName = `pipeline-${task.task_id}-hop${envelope.hops}`;
      logger.info('Executing', { task_id: task.task_id, hop: envelope.hops, mode: envelope.mode });

      const { output } = await this.spawnViaOpenClaw(prompt, sessionName, this.config.pipelineDir);

      // Parse output
      let parsedOutput;
      try {
        const json = JSON.parse(output);
        parsedOutput = {
          task_id: task.task_id,
          status: (json.result ? 'PASS' : json.status) || 'FAIL',
          summary: json.result || json.summary || output.slice(0, 500),
        };
      } catch {
        parsedOutput = {
          task_id: task.task_id,
          status: 'FAIL' as const,
          summary: output.slice(0, 500) || 'No output',
        };
      }

      // Verify
      const verification = await this.verifier.verify(task, parsedOutput as ClaudeOutput);

      if (verification.verdict === 'PASS') {
        await this.notifyDiscord('#agent-status',
          `Task ${task.task_id} PASSED (${envelope.hops} hops)`);
        await logAuditEntry('PIPELINE_TASK_PASS', {
          task_id: task.task_id,
          hops: envelope.hops,
          mode: envelope.mode,
        }, task.task_id);
        return { status: 'PASS', output: parsedOutput.summary, hops: envelope.hops };
      }

      // Anti-loop
      const postHop = await this.antiLoop.postHopUpdate(envelope, verification.verdict, [], task);
      envelope = postHop.envelope;

      if (postHop.deadLettered) {
        await this.notifyDiscord('#dead-letter',
          `Task ${task.task_id} dead-lettered: ${postHop.message}`);
        return { status: 'DEAD_LETTER', output: postHop.message, hops: envelope.hops };
      }

      if (postHop.modeChanged) {
        await this.notifyDiscord('#agent-status',
          `Task ${task.task_id} mode changed to ${envelope.mode}`);
      }
    }
  }

  /**
   * Save pipeline state to OpenClaw's state directory so the watchdog
   * and other sessions can see what's happening.
   */
  async savePipelineState(state: Record<string, unknown>): Promise<void> {
    await mkdir(OPENCLAW_STATE_DIR, { recursive: true });
    await writeFile(PIPELINE_STATE_FILE, JSON.stringify({
      ...state,
      updated_at: new Date().toISOString(),
      cache_names: {
        kb: this.config.cacheKbName || 'pipeline-kb',
        deliverables: this.config.cacheDeliverablesName || 'pipeline-deliverables',
      },
    }, null, 2));
  }
}
