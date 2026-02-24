import { logger } from './logger.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: RegExp[];
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  retryableErrors: [
    /RESOURCE_EXHAUSTED/i,
    /429/,
    /rate.?limit/i,
    /quota/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /503/,
    /502/,
    /500/,
  ],
};

function isRetryable(error: unknown, patterns: RegExp[]): boolean {
  const msg = String(error);
  return patterns.some((p) => p.test(msg));
}

function computeDelay(attempt: number, config: RetryConfig): number {
  const delay = Math.min(
    config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs,
  );
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(delay + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === cfg.maxRetries || !isRetryable(err, cfg.retryableErrors)) {
        logger.error(`${label}: Failed after ${attempt + 1} attempts`, {
          error: String(err),
          retryable: isRetryable(err, cfg.retryableErrors),
        });
        throw err;
      }

      const delay = computeDelay(attempt, cfg);
      logger.warn(`${label}: Attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
        error: String(err).slice(0, 200),
        nextAttempt: attempt + 2,
        maxRetries: cfg.maxRetries,
      });
      await sleep(delay);
    }
  }

  throw new Error(`${label}: Should not reach here`);
}
