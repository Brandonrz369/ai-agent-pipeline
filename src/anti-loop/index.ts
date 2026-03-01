import type { TaskEnvelope, TaskBlueprint, VerifierResult, DeadLetterBackend } from '../types/index.js';
import { checkTTL, incrementHop } from './ttl.js';
import { applyHysteresis, type HysteresisConfig } from './hysteresis.js';
import { checkBackflow, recordStateHash, computeStateHash } from './backflow.js';
import { sendToDeadLetter } from './dead-letter.js';
import { logger } from '../utils/logger.js';

export interface AntiLoopConfig {
  ttlMax: number;
  hysteresis: HysteresisConfig;
  backflowDetection: boolean;
  deadLetterPath: string;
  deadLetterBackend?: DeadLetterBackend;
}

const DEFAULT_CONFIG: AntiLoopConfig = {
  ttlMax: 10,
  hysteresis: { failuresToEscalate: 3, successesToDeescalate: 2 },
  backflowDetection: true,
  deadLetterPath: '~/.openclaw/dead-letter/',
};

export interface PreHopResult {
  allowed: boolean;
  envelope: TaskEnvelope;
  reason?: string;
}

export interface PostHopResult {
  envelope: TaskEnvelope;
  modeChanged: boolean;
  backflowDetected: boolean;
  deadLettered: boolean;
  message: string;
}

export class AntiLoopEngine {
  private config: AntiLoopConfig;

  constructor(config: Partial<AntiLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  createEnvelope(taskId: string, taskIdRef?: string): TaskEnvelope {
    return {
      id: `env-${taskId}-${Date.now()}`,
      task_id_ref: taskIdRef,
      trace_id: `trace-${taskId}-${Math.random().toString(36).slice(2, 11)}`,
      ttl_max: this.config.ttlMax,
      hops: 0,
      mode: 'EXECUTE',
      state_hashes: [],
      consecutive_failures: 0,
      consecutive_successes: 0,
      escalated: false,
      session_ids: [],
      created_at: new Date().toISOString(),
    };
  }

  preHopCheck(envelope: TaskEnvelope): PreHopResult {
    const ttlResult = checkTTL(envelope);

    if (ttlResult.expired) {
      logger.warn('Pre-hop: TTL expired', {
        id: envelope.id,
        hops: envelope.hops,
        ttl_max: envelope.ttl_max,
      });
      return { allowed: false, envelope, reason: ttlResult.message };
    }

    const incremented = incrementHop(envelope);
    logger.debug('Pre-hop: OK', {
      id: envelope.id,
      hops: incremented.hops,
      remaining: ttlResult.hopsRemaining - 1,
    });

    return { allowed: true, envelope: incremented };
  }

  async postHopUpdate(
    envelope: TaskEnvelope,
    verifierResult: VerifierResult,
    affectedFiles: string[] = [],
    task?: TaskBlueprint,
  ): Promise<PostHopResult> {
    let updated = { ...envelope };
    let backflowDetected = false;
    let deadLettered = false;

    // 1. Apply hysteresis
    const hysteresisResult = applyHysteresis(updated, verifierResult, this.config.hysteresis);
    updated = hysteresisResult.envelope;
    logger.info('Post-hop: hysteresis', { message: hysteresisResult.message });

    // 2. Backflow detection (if enabled and files provided)
    if (this.config.backflowDetection && affectedFiles.length > 0) {
      const currentHash = await computeStateHash(affectedFiles);
      const backflowResult = checkBackflow(updated, currentHash);

      if (backflowResult.detected) {
        backflowDetected = true;
        logger.warn('Post-hop: backflow detected', {
          id: updated.id,
          matchedHop: backflowResult.matchedHop,
        });

        // Send to dead-letter on backflow
        await sendToDeadLetter(updated, backflowResult.message, task, this.config.deadLetterPath, this.config.deadLetterBackend);
        deadLettered = true;
      }

      updated = recordStateHash(updated, currentHash);
    }

    // 3. Check TTL after hop
    const ttlResult = checkTTL(updated);
    if (ttlResult.expired && !deadLettered) {
      await sendToDeadLetter(updated, ttlResult.message, task, this.config.deadLetterPath, this.config.deadLetterBackend);
      deadLettered = true;
    }

    return {
      envelope: updated,
      modeChanged: hysteresisResult.modeChanged,
      backflowDetected,
      deadLettered,
      message: deadLettered
        ? `Dead-lettered: ${backflowDetected ? 'backflow' : 'TTL expired'}`
        : hysteresisResult.message,
    };
  }
}

export { checkTTL, incrementHop } from './ttl.js';
export { applyHysteresis } from './hysteresis.js';
export { checkBackflow, recordStateHash, computeStateHash } from './backflow.js';
export { sendToDeadLetter, listDeadLetter, inspectDeadLetter, retryFromDeadLetter } from './dead-letter.js';
