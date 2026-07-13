import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoundedPoolShutdown } from './shutdown.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('bounded signal-worker shutdown', () => {
  it('aborts immediately and force-destroys PostgreSQL at the original deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const destroy = vi.fn(() => Promise.resolve());
    const shutdown = createBoundedPoolShutdown({
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

  it('cancels the forced close after graceful pool shutdown', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn(() => Promise.resolve());
    const shutdown = createBoundedPoolShutdown({
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
