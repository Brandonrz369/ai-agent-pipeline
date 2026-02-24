import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../retry.js';

describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable error and succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, 'test', {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid argument'));

    await expect(
      withRetry(fn, 'test', { maxRetries: 3, baseDelayMs: 10 }),
    ).rejects.toThrow('invalid argument');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should exhaust retries on persistent retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('RESOURCE_EXHAUSTED quota'));

    await expect(
      withRetry(fn, 'test', { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 20 }),
    ).rejects.toThrow('RESOURCE_EXHAUSTED');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('should retry on 503 errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, 'test', { baseDelayMs: 10 });
    expect(result).toBe('recovered');
  });
});
