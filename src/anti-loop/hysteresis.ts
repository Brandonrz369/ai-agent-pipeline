import type { TaskEnvelope, PromptMode, VerifierResult } from '../types/index.js';

export interface HysteresisConfig {
  failuresToEscalate: number;
  successesToDeescalate: number;
}

const DEFAULT_CONFIG: HysteresisConfig = {
  failuresToEscalate: 3,
  successesToDeescalate: 2,
};

export interface HysteresisResult {
  envelope: TaskEnvelope;
  modeChanged: boolean;
  previousMode: PromptMode;
  message: string;
}

export function applyHysteresis(
  envelope: TaskEnvelope,
  result: VerifierResult,
  config: HysteresisConfig = DEFAULT_CONFIG,
): HysteresisResult {
  const previousMode = envelope.mode;
  let updated = { ...envelope };

  if (result === 'PASS') {
    updated.consecutive_successes += 1;
    updated.consecutive_failures = 0;

    // De-escalate: 2 consecutive successes in ARCHITECT → back to EXECUTE
    if (
      updated.escalated &&
      updated.mode === 'ARCHITECT' &&
      updated.consecutive_successes >= config.successesToDeescalate
    ) {
      updated.mode = 'EXECUTE';
      updated.escalated = false;
      updated.consecutive_successes = 0;
      return {
        envelope: updated,
        modeChanged: true,
        previousMode,
        message: `De-escalated: ${config.successesToDeescalate} consecutive successes → EXECUTE mode`,
      };
    }
  } else {
    // RETRY or ESCALATE
    updated.consecutive_failures += 1;
    updated.consecutive_successes = 0;

    // Escalate: 3 consecutive failures → ARCHITECT mode
    if (
      updated.consecutive_failures >= config.failuresToEscalate &&
      updated.mode === 'EXECUTE'
    ) {
      updated.mode = 'ARCHITECT';
      updated.escalated = true;
      updated.consecutive_failures = 0;
      return {
        envelope: updated,
        modeChanged: true,
        previousMode,
        message: `Escalated: ${config.failuresToEscalate} consecutive failures → ARCHITECT mode`,
      };
    }
  }

  return {
    envelope: updated,
    modeChanged: false,
    previousMode,
    message: `Hysteresis: failures=${updated.consecutive_failures}, successes=${updated.consecutive_successes}, mode=${updated.mode}`,
  };
}
