import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import {
  MarketDataAdapterError,
  ScriptedMarketDataAdapter,
  createOneMinuteBarEvent,
  type MarketDataAdapter,
  type MarketDataAdapterConnection,
  type MarketDataAdapterRequest,
  type MarketDataSubscription,
} from '@daily-trader/market-data';
import { describe, expect, it, vi } from 'vitest';

import { MarketDataStreamSupervisor, type RetrySleeper } from './supervisor.js';

class FailingAdapter implements MarketDataAdapter {
  public connections = 0;
  readonly #error: MarketDataAdapterError;

  public constructor(error: MarketDataAdapterError) {
    this.#error = error;
  }

  public connect(): Promise<MarketDataAdapterConnection> {
    this.connections += 1;
    return Promise.resolve({
      done: Promise.reject(this.#error),
      cancel: (): Promise<void> => Promise.resolve(),
    });
  }
}

class CapturingAdapter implements MarketDataAdapter {
  public constructor(
    private readonly inner: MarketDataAdapter,
    private readonly subscriptions: MarketDataSubscription[],
  ) {}

  public connect(request: MarketDataAdapterRequest): Promise<MarketDataAdapterConnection> {
    this.subscriptions.push(request.subscription);
    return this.inner.connect(request);
  }
}

class ReconnectingFailureAdapter implements MarketDataAdapter {
  public connect(request: MarketDataAdapterRequest): Promise<MarketDataAdapterConnection> {
    const done = Promise.resolve(
      request.handlers.onStatus({
        state: 'reconnecting',
        occurredAt: createUtcTimestamp('2026-07-06T13:30:00.000Z'),
      }),
    ).then(() => {
      throw new MarketDataAdapterError('retryable_transport', 'DISCONNECTED', 'disconnected');
    });
    return Promise.resolve({ done, cancel: (): Promise<void> => Promise.resolve() });
  }
}

describe('MarketDataStreamSupervisor', () => {
  it('uses bounded exponential retries and reports terminal exhaustion', async () => {
    const adapter = new FailingAdapter(
      new MarketDataAdapterError('retryable_transport', 'DISCONNECTED', 'disconnected'),
    );
    const waits: number[] = [];
    const statuses: string[] = [];
    const sleeper: RetrySleeper = {
      wait: (milliseconds): Promise<void> => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
    };
    const supervisor = new MarketDataStreamSupervisor({
      adapterFactory: () => adapter,
      clock: new FixedClock(createUtcTimestamp('2026-07-06T13:30:00.000Z')),
      handlers: {
        onEvent: vi.fn(),
        onInactivity: vi.fn(),
        onStatus: (status): void => {
          statuses.push(status.state);
        },
      },
      jitter: { sample: () => 0.5 },
      reconnectPolicy: {
        baseDelayMs: 100,
        maximumDelayMs: 250,
        maximumAttempts: 3,
        jitterRatio: 0,
      },
      sleeper,
    });

    await expect(supervisor.run()).rejects.toMatchObject({
      code: 'RECONNECT_ATTEMPTS_EXHAUSTED',
    });
    expect(waits).toEqual([100, 200, 250]);
    expect(adapter.connections).toBe(4);
    expect(statuses).toContain('terminal_failure');
  });

  it('does not retry authentication failures', async () => {
    const adapter = new FailingAdapter(
      new MarketDataAdapterError('authentication', 'AUTH_REJECTED', 'rejected'),
    );
    const sleeper = { wait: vi.fn<RetrySleeper['wait']>() };
    const supervisor = new MarketDataStreamSupervisor({
      adapterFactory: () => adapter,
      clock: new FixedClock(createUtcTimestamp('2026-07-06T13:30:00.000Z')),
      handlers: { onEvent: vi.fn(), onInactivity: vi.fn(), onStatus: vi.fn() },
      jitter: { sample: () => 0.5 },
      reconnectPolicy: {
        baseDelayMs: 100,
        maximumDelayMs: 200,
        maximumAttempts: 3,
        jitterRatio: 0,
      },
      sleeper,
    });

    await expect(supervisor.run()).rejects.toMatchObject({ classification: 'authentication' });
    expect(adapter.connections).toBe(1);
    expect(sleeper.wait).not.toHaveBeenCalled();
  });

  it('stops cleanly during backoff without another connection', async () => {
    const adapter = new FailingAdapter(
      new MarketDataAdapterError('retryable_transport', 'DISCONNECTED', 'disconnected'),
    );
    let rejectSleep: ((error: Error) => void) | undefined;
    const sleeper: RetrySleeper = {
      wait: (_milliseconds, signal): Promise<void> =>
        new Promise((_resolve, reject) => {
          rejectSleep = reject;
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        }),
    };
    const supervisor = new MarketDataStreamSupervisor({
      adapterFactory: () => adapter,
      clock: new FixedClock(createUtcTimestamp('2026-07-06T13:30:00.000Z')),
      handlers: { onEvent: vi.fn(), onInactivity: vi.fn(), onStatus: vi.fn() },
      jitter: { sample: () => 0.5 },
      reconnectPolicy: {
        baseDelayMs: 100,
        maximumDelayMs: 200,
        maximumAttempts: 3,
        jitterRatio: 0,
      },
      sleeper,
    });

    const running = supervisor.run();
    await vi.waitFor(() => expect(rejectSleep).toBeTypeOf('function'));
    await supervisor.stop();
    await expect(running).resolves.toBeUndefined();
    expect(adapter.connections).toBe(1);
  });

  it('resubscribes exactly once to the approved scope and accepts a post-reconnect bar', async () => {
    const clock = new FixedClock(createUtcTimestamp('2026-07-06T13:31:01.000Z'));
    const subscriptions: MarketDataSubscription[] = [];
    const statuses: string[] = [];
    const controller = new AbortController();
    const recovered = new ScriptedMarketDataAdapter(clock, [
      { kind: 'status', state: 'connecting' },
      { kind: 'status', state: 'authenticating' },
      { kind: 'status', state: 'subscribed' },
      {
        kind: 'event',
        event: createOneMinuteBarEvent({
          symbol: 'AAPL',
          venue: 'XNAS',
          providerTimestamp: '2026-07-06T13:30:00Z',
          receivedAt: '2026-07-06T13:31:00.100Z',
          processedAt: '2026-07-06T13:31:00.200Z',
          open: '100',
          high: '101',
          low: '99',
          close: '100.5',
          volume: '1000',
        }),
      },
      { kind: 'await_cancellation' },
    ]);
    const adapters = [new ReconnectingFailureAdapter(), recovered];
    let adapterIndex = 0;
    const supervisor = new MarketDataStreamSupervisor({
      adapterFactory: () =>
        new CapturingAdapter(
          adapters[Math.min(adapterIndex++, adapters.length - 1)]!,
          subscriptions,
        ),
      clock,
      handlers: {
        onEvent: (): void => controller.abort(),
        onInactivity: vi.fn(),
        onStatus: ({ state }): void => {
          statuses.push(state);
        },
      },
      jitter: { sample: () => 0.5 },
      reconnectPolicy: {
        baseDelayMs: 1,
        maximumDelayMs: 1,
        maximumAttempts: 2,
        jitterRatio: 0,
      },
      sleeper: { wait: (): Promise<void> => Promise.resolve() },
    });

    await supervisor.run(controller.signal);

    expect(subscriptions).toHaveLength(2);
    expect(
      subscriptions.map((subscription) =>
        subscription.instruments.map(({ symbol, venue }) => `${venue}:${symbol}`),
      ),
    ).toEqual([
      ['XNAS:AAPL', 'ARCX:SPY'],
      ['XNAS:AAPL', 'ARCX:SPY'],
    ]);
    expect(statuses).toContain('reconnecting');
    expect(statuses).toContain('subscribed');
  });
});
