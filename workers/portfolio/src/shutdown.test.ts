import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoundedPortfolioShutdown } from './shutdown.js';

afterEach(() => vi.useRealTimers());

describe('bounded portfolio-worker shutdown', () => {
  it('aborts provider reads and destroys the pool only at the original deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const destroy = vi.fn(() => Promise.resolve());
    const shutdown = createBoundedPortfolioShutdown({
      controller,
      pool: { destroy },
      timeoutMs: 10_000,
    });

    shutdown.stop();
    shutdown.stop();
    expect(controller.signal.aborted).toBe(true);
    expect(destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('cancels forced destruction after graceful close', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn(() => Promise.resolve());
    const shutdown = createBoundedPortfolioShutdown({
      controller: new AbortController(),
      pool: { destroy },
      timeoutMs: 1_000,
    });

    shutdown.stop();
    shutdown.cancel();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(destroy).not.toHaveBeenCalled();
  });
});
