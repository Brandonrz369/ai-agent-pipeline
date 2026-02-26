import type {
  TaskBlueprint,
  TaskEnvelope,
  ClaudeOutput,
  VerifierResult,
  LoopState,
  LoopAction,
} from '../types/index.js';
import { AntiLoopEngine } from '../anti-loop/index.js';
import { ClaudeCodeExecutor } from '../executor/index.js';
import { GeminiVerifier } from '../verifier/index.js';
import { classifyTask, type ClassificationResult } from './classifier.js';
import { formatPromptForMode } from './prompt-formatter.js';
import { logger } from '../utils/logger.js';
import { getMonitor } from '../monitoring/index.js';

export interface LoopDriverConfig {
  geminiApiKey: string;
  orchestratorModel?: string;
  verifierModel?: string;
  ttlMax?: number;
  deadLetterPath?: string;
  cwd?: string;
  dryRun?: boolean;
}

export interface LoopResult {
  task_id: string;
  status: 'PASS' | 'FAIL' | 'DEAD_LETTER';
  totalHops: number;
  finalMode: string;
  output: ClaudeOutput | null;
  classification: ClassificationResult | null;
  deadLettered: boolean;
  history: LoopHistoryEntry[];
}

export interface LoopHistoryEntry {
  hop: number;
  mode: string;
  action: LoopAction;
  verifierResult?: VerifierResult;
  claudeStatus?: string;
  timestamp: string;
}

export class CompletionLoopDriver {
  private antiLoop: AntiLoopEngine;
  private executor: ClaudeCodeExecutor;
  private verifier: GeminiVerifier;
  private config: LoopDriverConfig;

  constructor(config: LoopDriverConfig) {
    this.config = config;

    this.antiLoop = new AntiLoopEngine({
      ttlMax: config.ttlMax || 10,
      deadLetterPath: config.deadLetterPath || '~/.openclaw/dead-letter/',
    });

    this.executor = new ClaudeCodeExecutor({
      cwd: config.cwd,
    });

    this.verifier = new GeminiVerifier(
      undefined,
      config.verifierModel || 'gemini-3.1-pro-high',
    );
  }

  async run(task: TaskBlueprint): Promise<LoopResult> {
    // Create or use existing envelope
    let envelope: TaskEnvelope = task.envelope || this.antiLoop.createEnvelope(task.task_id, task.task_id);
    const history: LoopHistoryEntry[] = [];

    // Step 1: CLASSIFY
    logger.info('Loop: CLASSIFY', { task_id: task.task_id });
    const classification = await classifyTask(task, this.config.geminiApiKey);

    // Apply classification to envelope if not already escalated
    if (!envelope.escalated) {
      envelope.mode = classification.promptMode;
    }

    if (this.config.dryRun) {
      logger.info('Dry run — skipping execution', { classification });
      return {
        task_id: task.task_id,
        status: 'PASS',
        totalHops: 0,
        finalMode: envelope.mode,
        output: null,
        classification,
        deadLettered: false,
        history,
      };
    }

    // Step 2: LOOP until PASS, DEAD_LETTER, or TTL expired
    let lastOutput: ClaudeOutput | null = null;

    while (true) {
      // Pre-hop check (TTL)
      const preHop = this.antiLoop.preHopCheck(envelope);
      if (!preHop.allowed) {
        logger.warn('Loop: TTL expired', { task_id: task.task_id, reason: preHop.reason });
        void getMonitor().recordError('orchestrator','ttl_exceeded','Task TTL expired after '+envelope.hops+' hops: '+preHop.reason,task.task_id,{ hops: envelope.hops, ttl_max: envelope.ttl_max });
        history.push({
          hop: envelope.hops,
          mode: envelope.mode,
          action: 'DEAD_LETTER',
          timestamp: new Date().toISOString(),
        });
        return {
          task_id: task.task_id,
          status: 'DEAD_LETTER',
          totalHops: envelope.hops,
          finalMode: envelope.mode,
          output: lastOutput,
          classification,
          deadLettered: true,
          history,
        };
      }
      envelope = preHop.envelope;

      // FORMAT prompt
      logger.info('Loop: FORMAT + EXECUTE', {
        task_id: task.task_id,
        hop: envelope.hops,
        mode: envelope.mode,
      });

      // EXECUTE via Claude Code
      const { result, output } = await this.executor.execute(task, envelope);
      lastOutput = output;

      history.push({
        hop: envelope.hops,
        mode: envelope.mode,
        action: 'EXECUTE',
        claudeStatus: output.status,
        timestamp: new Date().toISOString(),
      });

      // Record executor failure
      if (!result.success) {
        void getMonitor().recordError("executor","task_failure","Executor returned failure: "+(output.summary||"").slice(0,200),task.task_id,{ exitCode: result.exitCode, hop: envelope.hops });
      }

      // VERIFY via Gemini
      logger.info('Loop: VERIFY', { task_id: task.task_id, claudeStatus: output.status });
      const verification = await this.verifier.verify(task, output);

      history.push({
        hop: envelope.hops,
        mode: envelope.mode,
        action: 'VERIFY',
        verifierResult: verification.verdict,
        timestamp: new Date().toISOString(),
      });

      // Record ESCALATE verdict
      if (verification.verdict === 'ESCALATE') {
        void getMonitor().recordError('verifier','escalation','Verifier returned ESCALATE: '+verification.reasoning,task.task_id,{ issues: verification.issues, hop: envelope.hops });
      }

      // If PASS, we're done
      if (verification.verdict === 'PASS') {
        logger.info('Loop: PASS', { task_id: task.task_id, totalHops: envelope.hops });
        return {
          task_id: task.task_id,
          status: 'PASS',
          totalHops: envelope.hops,
          finalMode: envelope.mode,
          output: lastOutput,
          classification,
          deadLettered: false,
          history,
        };
      }

      // ANTI-LOOP update
      const postHop = await this.antiLoop.postHopUpdate(
        envelope,
        verification.verdict,
        [],  // affected files (would need to be tracked per task)
        task,
      );

      history.push({
        hop: envelope.hops,
        mode: postHop.envelope.mode,
        action: 'ANTI_LOOP',
        verifierResult: verification.verdict,
        timestamp: new Date().toISOString(),
      });

      if (postHop.deadLettered) {
        logger.warn('Loop: dead-lettered', {
          task_id: task.task_id,
          reason: postHop.message,
        });
        void getMonitor().recordError('dead-letter','dead_letter','Task dead-lettered: '+postHop.message,task.task_id,{ totalHops: envelope.hops, finalMode: postHop.envelope.mode });
        return {
          task_id: task.task_id,
          status: 'DEAD_LETTER',
          totalHops: envelope.hops,
          finalMode: postHop.envelope.mode,
          output: lastOutput,
          classification,
          deadLettered: true,
          history,
        };
      }

      envelope = postHop.envelope;

      if (postHop.modeChanged) {
        logger.info('Loop: mode changed', {
          task_id: task.task_id,
          newMode: envelope.mode,
        });
      }
    }
  }
}
