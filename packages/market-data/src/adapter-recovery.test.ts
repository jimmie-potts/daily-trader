import { FixedClock, createInstrumentId, createUtcTimestamp } from '@daily-trader/domain';
import { describe, expect, it } from 'vitest';

import {
  MarketDataAdapterError,
  createPhase2MarketDataSubscription,
  type MarketDataAdapterHandlers,
} from './adapter.js';
import { createOneMinuteBarEvent, type OneMinuteBarEvent } from './bar-event.js';
import {
  calculateReconnectDecision,
  transitionMarketDataConnection,
  type ReconnectPolicy,
} from './recovery.js';
import { ScriptedMarketDataAdapter } from './scripted-adapter.js';

function event(): OneMinuteBarEvent {
  return createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: '2026-07-13T13:30:00Z',
    receivedAt: '2026-07-13T13:31:00.100Z',
    processedAt: '2026-07-13T13:31:00.200Z',
    open: '100',
    high: '101',
    low: '99',
    close: '100.5',
    volume: '1000',
  });
}

function handlers(overrides: Partial<MarketDataAdapterHandlers> = {}): MarketDataAdapterHandlers {
  return {
    onEvent: () => undefined,
    onInactivity: () => undefined,
    onStatus: () => undefined,
    ...overrides,
  };
}

const clock = new FixedClock(createUtcTimestamp('2026-07-13T13:31:01.000Z'));

describe('ScriptedMarketDataAdapter', () => {
  it('delivers lifecycle, events, inactivity, and bounded shutdown in script order', async () => {
    const observed: string[] = [];
    const adapter = new ScriptedMarketDataAdapter(clock, [
      { kind: 'status', state: 'connecting' },
      { kind: 'status', state: 'authenticating' },
      { kind: 'status', state: 'subscribed' },
      { kind: 'event', event: event() },
      { kind: 'inactivity' },
    ]);
    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      handlers: handlers({
        onStatus: (status) => {
          observed.push(`status:${status.state}:${status.occurredAt}`);
        },
        onEvent: (value) => {
          observed.push(`event:${value.eventId}`);
        },
        onInactivity: (occurredAt) => {
          observed.push(`inactive:${occurredAt}`);
        },
      }),
    });
    await connection.done;

    expect(observed.map((value) => value.split(':', 2).join(':'))).toEqual([
      'status:connecting',
      'status:authenticating',
      'status:subscribed',
      `event:${event().eventId}`,
      'inactive:2026-07-13T13',
      'status:stopped',
    ]);
  });

  it('awaits one event callback before delivering the next event', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let deliveries = 0;
    let inFlight = 0;
    let maximumInFlight = 0;
    const adapter = new ScriptedMarketDataAdapter(clock, [
      { kind: 'status', state: 'connecting' },
      { kind: 'status', state: 'authenticating' },
      { kind: 'status', state: 'subscribed' },
      { kind: 'event', event: event() },
      { kind: 'event', event: event() },
    ]);
    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      handlers: handlers({
        onEvent: async () => {
          deliveries += 1;
          inFlight += 1;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          if (deliveries === 1) {
            markFirstStarted?.();
            await firstGate;
          }
          inFlight -= 1;
        },
      }),
    });
    await firstStarted;
    expect(deliveries).toBe(1);
    releaseFirst?.();
    await connection.done;

    expect(deliveries).toBe(2);
    expect(maximumInFlight).toBe(1);
  });

  it('supports idempotent cancellation while waiting without emitting an error', async () => {
    const statuses: string[] = [];
    const adapter = new ScriptedMarketDataAdapter(clock, [
      { kind: 'status', state: 'connecting' },
      { kind: 'status', state: 'authenticating' },
      { kind: 'status', state: 'subscribed' },
      { kind: 'await_cancellation' },
    ]);
    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      handlers: handlers({
        onStatus: ({ state }) => {
          statuses.push(state);
        },
      }),
    });
    await Promise.all([connection.cancel(), connection.cancel()]);

    expect(statuses.at(-1)).toBe('stopped');
  });

  it('rejects event delivery before subscription acknowledgement', async () => {
    const adapter = new ScriptedMarketDataAdapter(clock, [
      { kind: 'status', state: 'connecting' },
      { kind: 'event', event: event() },
    ]);
    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      handlers: handlers(),
    });

    await expect(connection.done).rejects.toMatchObject({
      classification: 'contract',
      code: 'EVENT_BEFORE_SUBSCRIBED',
    });
  });

  it.each([
    ['retryable_transport', true, 'reconnecting'],
    ['authentication', false, 'terminal_failure'],
    ['entitlement', false, 'terminal_failure'],
    ['contract', false, 'terminal_failure'],
    ['malformed_data', false, 'terminal_failure'],
  ] as const)('preserves %s error classification', async (classification, retryable, status) => {
    const error = new MarketDataAdapterError(classification, 'SAFE_CODE', 'safe message');
    const statuses: string[] = [];
    const adapter = new ScriptedMarketDataAdapter(clock, [
      { kind: 'status', state: 'connecting' },
      { kind: 'error', error },
    ]);
    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      handlers: handlers({
        onStatus: (value) => {
          statuses.push(value.state);
        },
      }),
    });

    await expect(connection.done).rejects.toBe(error);
    expect(error.retryable).toBe(retryable);
    expect(statuses.at(-1)).toBe(status);
  });

  it('classifies a rejected consumer callback without exposing its error', async () => {
    const adapter = new ScriptedMarketDataAdapter(clock, [
      { kind: 'status', state: 'connecting' },
      { kind: 'status', state: 'authenticating' },
      { kind: 'status', state: 'subscribed' },
      { kind: 'event', event: event() },
    ]);
    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      handlers: handlers({ onEvent: () => Promise.reject(new Error('sensitive consumer error')) }),
    });

    await expect(connection.done).rejects.toMatchObject({
      classification: 'contract',
      code: 'CONSUMER_CALLBACK_FAILED',
      message: 'A market-data consumer callback failed',
    });
  });

  it('rejects unsupported subscriptions before scripted work starts', async () => {
    const adapter = new ScriptedMarketDataAdapter(clock, []);

    await expect(
      adapter.connect({
        subscription: {
          interval: '1m',
          instruments: [createInstrumentId('MSFT', 'XNAS')],
        },
        handlers: handlers(),
      }),
    ).rejects.toMatchObject({ classification: 'unsupported_subscription' });
  });
});

describe('connection recovery rules', () => {
  it('accepts only the explicit lifecycle path', () => {
    let state = transitionMarketDataConnection('disabled', 'start');
    expect(state).toBe('connecting');
    state = transitionMarketDataConnection(state, 'socket_opened');
    expect(state).toBe('authenticating');
    state = transitionMarketDataConnection(state, 'subscription_acknowledged');
    expect(state).toBe('subscribed');
    state = transitionMarketDataConnection(state, 'retryable_failure');
    expect(state).toBe('reconnecting');
    state = transitionMarketDataConnection(state, 'retry_started');
    expect(state).toBe('connecting');
    state = transitionMarketDataConnection(state, 'terminal_failure');
    expect(state).toBe('terminal_failure');
    state = transitionMarketDataConnection(state, 'stop');
    expect(state).toBe('stopped');
  });

  it('rejects invalid lifecycle transitions', () => {
    expect(() => transitionMarketDataConnection('disabled', 'subscription_acknowledged')).toThrow(
      'cannot apply subscription_acknowledged while disabled',
    );
    expect(() => transitionMarketDataConnection('stopped', 'start')).toThrow(
      'cannot apply start while stopped',
    );
  });

  it('calculates deterministic capped exponential backoff with injected jitter', () => {
    const policy: ReconnectPolicy = {
      baseDelayMs: 100,
      maximumDelayMs: 1_000,
      maximumAttempts: 4,
      jitterRatio: 0.2,
    };

    expect(calculateReconnectDecision(1, policy, 0)).toEqual({
      kind: 'retry',
      attempt: 1,
      delayMs: 80,
    });
    expect(calculateReconnectDecision(2, policy, 0.5)).toEqual({
      kind: 'retry',
      attempt: 2,
      delayMs: 200,
    });
    expect(calculateReconnectDecision(4, policy, 1)).toEqual({
      kind: 'retry',
      attempt: 4,
      delayMs: 960,
    });
    expect(calculateReconnectDecision(5, policy, 0.5)).toEqual({
      kind: 'exhausted',
      attempt: 5,
    });
  });

  it.each([
    [{ baseDelayMs: 0, maximumDelayMs: 1000, maximumAttempts: 1, jitterRatio: 0 }, 1, 0],
    [{ baseDelayMs: 100, maximumDelayMs: 99, maximumAttempts: 1, jitterRatio: 0 }, 1, 0],
    [{ baseDelayMs: 100, maximumDelayMs: 1000, maximumAttempts: 0, jitterRatio: 0 }, 1, 0],
    [{ baseDelayMs: 100, maximumDelayMs: 1000, maximumAttempts: 1, jitterRatio: 2 }, 1, 0],
    [{ baseDelayMs: 100, maximumDelayMs: 1000, maximumAttempts: 1, jitterRatio: 0 }, 0, 0],
    [{ baseDelayMs: 100, maximumDelayMs: 1000, maximumAttempts: 1, jitterRatio: 0 }, 1, -1],
  ] as const)('rejects invalid reconnect bounds', (policy, attempt, jitter) => {
    expect(() => calculateReconnectDecision(attempt, policy, jitter)).toThrow();
  });
});
