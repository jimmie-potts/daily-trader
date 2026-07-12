import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketDataAdapterError } from '@daily-trader/market-data';

import { RedisDeliveryError } from './delivery/redis-stream.js';
import {
  awaitUnlessRuntimeStopped,
  awaitWithinRuntimeDeadline,
  preferRuntimeBoundaryFailure,
  runtimeFailureReason,
} from './paper-runtime.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('paper market-data runtime shutdown deadline', () => {
  it('returns a completed cleanup operation', async () => {
    await expect(awaitWithinRuntimeDeadline(Promise.resolve('closed'), 100)).resolves.toBe(
      'closed',
    );
  });

  it('fails a cleanup operation that exceeds its bounded deadline', async () => {
    vi.useFakeTimers();
    const waiting = awaitWithinRuntimeDeadline(new Promise<never>(() => undefined), 100);
    const expectation = expect(waiting).rejects.toThrow(
      'Paper market-data runtime shutdown deadline expired',
    );

    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });

  it('stops waiting for startup work immediately when shutdown is requested', async () => {
    const controller = new AbortController();
    const waiting = awaitUnlessRuntimeStopped(
      new Promise<never>(() => undefined),
      controller.signal,
    );
    controller.abort();

    await expect(waiting).rejects.toThrow();
  });

  it('retains an application-boundary failure when an adapter translates its callback error', () => {
    const redisFailure = new RedisDeliveryError('publish_failed');

    expect(
      preferRuntimeBoundaryFailure(new Error('translated provider callback failure'), redisFailure),
    ).toBe(redisFailure);
  });

  it('maps terminal runtime failures to bounded metric reasons', () => {
    expect(runtimeFailureReason(new RedisDeliveryError('retention_gap'))).toBe('redis');
    expect(
      runtimeFailureReason(
        new MarketDataAdapterError('entitlement', 'ALPACA_ENTITLEMENT_REJECTED', 'safe'),
      ),
    ).toBe('entitlement');
    expect(
      runtimeFailureReason(
        new MarketDataAdapterError('retryable_transport', 'ALPACA_BACKPRESSURE', 'safe'),
      ),
    ).toBe('backpressure');
    expect(runtimeFailureReason(new Error('unknown'))).toBeUndefined();
  });
});
