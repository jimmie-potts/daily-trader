import { describe, expect, it, vi } from 'vitest';

import { withPortfolioRetry } from './retry.js';

const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, jitterPercent: 20 };

describe('portfolio retry', () => {
  it('retries only bounded retryable failures with observable delay', async () => {
    const failure = new Error('bounded failure');
    const operation = vi.fn((attempt: number) => {
      if (attempt < 3) return Promise.reject(failure);
      return Promise.resolve('complete');
    });
    const delay = vi.fn<(milliseconds: number, signal: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const onRetry = vi.fn();

    await expect(
      withPortfolioRetry({
        policy,
        signal: new AbortController().signal,
        operation,
        classify: () => ({ retryable: true }),
        dependencies: { random: () => 0.5, delay, onRetry },
      }),
    ).resolves.toBe('complete');

    expect(operation).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([100, 200]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does not retry fail-closed classifications', async () => {
    const operation = vi.fn(() => Promise.reject(new Error('authentication')));
    await expect(
      withPortfolioRetry({
        policy,
        signal: new AbortController().signal,
        operation,
        classify: () => ({ retryable: false }),
        dependencies: { random: () => 0.5, delay: () => Promise.resolve() },
      }),
    ).rejects.toThrow('authentication');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('honors a bounded provider retry delay without exceeding the configured maximum', async () => {
    const delay = vi.fn<(milliseconds: number, signal: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    await expect(
      withPortfolioRetry({
        policy: { ...policy, maxAttempts: 2 },
        signal: new AbortController().signal,
        operation: () => Promise.reject(new Error('rate limited')),
        classify: () => ({ retryable: true, retryAfterMs: 50_000 }),
        dependencies: { random: () => 0.5, delay },
      }),
    ).rejects.toThrow('rate limited');
    expect(delay).toHaveBeenCalledWith(1_000, expect.any(AbortSignal));
  });
});
