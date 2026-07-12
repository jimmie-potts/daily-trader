import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import { createPhase2MarketDataSubscription } from '@daily-trader/market-data';
import { describe, expect, it, vi } from 'vitest';

import { AlpacaMarketDataAdapter } from './adapter.js';
import type {
  WebSocketEventListener,
  WebSocketEventType,
  WebSocketFactory,
  WebSocketLike,
} from './types.js';

class ControlledSocket implements WebSocketLike {
  readonly #listeners = new Map<WebSocketEventType, Set<WebSocketEventListener>>();
  public readonly sent: string[] = [];

  public addEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<WebSocketEventListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.emit('close', {});
  }

  public terminate(): void {}

  public emit(type: WebSocketEventType, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('AlpacaMarketDataAdapter', () => {
  it('reports lifecycle, normalizes only after acknowledgement, and closes cleanly', async () => {
    const socket = new ControlledSocket();
    const factory: WebSocketFactory = { create: () => socket };
    const statuses: string[] = [];
    const events: string[] = [];
    const adapter = new AlpacaMarketDataAdapter(
      {
        apiKey: 'recognizable-test-key',
        apiSecret: 'recognizable-test-secret',
        connectionTimeoutMs: 1_000,
        inactivityTimeoutMs: 10_000,
        queueCapacity: 2,
        shutdownTimeoutMs: 1_000,
        url: 'wss://stream.data.alpaca.markets/v2/iex',
      },
      {
        clock: new FixedClock(createUtcTimestamp('2026-07-06T13:31:00.100Z')),
        webSocketFactory: factory,
      },
    );

    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      handlers: {
        onEvent: (event): void => {
          events.push(event.eventId);
        },
        onInactivity: vi.fn(),
        onStatus: (status): void => {
          statuses.push(status.state);
        },
      },
    });

    socket.emit('open', {});
    socket.emit('message', { data: '[{"T":"success","msg":"connected"}]' });
    socket.emit('message', { data: '[{"T":"success","msg":"authenticated"}]' });
    socket.emit('message', {
      data: '[{"T":"subscription","trades":[],"quotes":[],"bars":["AAPL","SPY"],"updatedBars":[],"dailyBars":[],"statuses":[],"lulds":[],"corrections":[],"cancelErrors":[]}]',
    });
    socket.emit('message', {
      data: '[{"T":"b","S":"AAPL","o":200.10,"h":201,"l":199.9,"c":200.5,"v":12345678901234567890,"t":"2026-07-06T13:30:00Z"}]',
    });

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(statuses).toEqual(['connecting', 'authenticating', 'subscribed']);
    expect(socket.sent).toEqual([
      '{"action":"auth","key":"recognizable-test-key","secret":"recognizable-test-secret"}',
      '{"action":"subscribe","bars":["AAPL","SPY"]}',
    ]);

    await connection.cancel();
    await expect(connection.done).resolves.toBeUndefined();
    expect(statuses.at(-1)).toBe('stopped');
  });

  it('classifies an invalid bar without exposing its frame', async () => {
    const socket = new ControlledSocket();
    const adapter = new AlpacaMarketDataAdapter(
      {
        apiKey: 'key',
        apiSecret: 'secret',
        connectionTimeoutMs: 1_000,
        inactivityTimeoutMs: 10_000,
        queueCapacity: 2,
        shutdownTimeoutMs: 1_000,
        url: 'wss://stream.data.alpaca.markets/v2/iex',
      },
      {
        clock: new FixedClock(createUtcTimestamp('2026-07-06T13:31:00.100Z')),
        webSocketFactory: { create: () => socket },
      },
    );
    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      handlers: { onEvent: vi.fn(), onInactivity: vi.fn(), onStatus: vi.fn() },
    });
    socket.emit('open', {});
    socket.emit('message', { data: '[{"T":"success","msg":"connected"}]' });
    socket.emit('message', { data: '[{"T":"success","msg":"authenticated"}]' });
    socket.emit('message', {
      data: '[{"T":"subscription","bars":["AAPL","SPY"],"trades":[],"quotes":[],"updatedBars":[],"dailyBars":[],"statuses":[],"lulds":[],"corrections":[],"cancelErrors":[]}]',
    });
    socket.emit('message', {
      data: '[{"T":"b","S":"AAPL","o":0,"h":1,"l":0,"c":1,"v":10,"t":"2026-07-06T13:30:00Z"}]',
    });

    await expect(connection.done).rejects.toMatchObject({
      classification: 'malformed_data',
      code: 'ALPACA_BAR_INVALID',
    });
    await expect(connection.done).rejects.not.toThrow('"o":0');
  });

  it.each([
    ['407', 'ALPACA_BACKPRESSURE'],
    ['500', 'ALPACA_TRANSPORT_FAILED'],
  ] as const)(
    'translates provider error %s into retryable adapter failure',
    async (code, safeCode) => {
      const socket = new ControlledSocket();
      const adapter = new AlpacaMarketDataAdapter(
        {
          apiKey: 'key',
          apiSecret: 'secret',
          connectionTimeoutMs: 1_000,
          inactivityTimeoutMs: 10_000,
          queueCapacity: 2,
          shutdownTimeoutMs: 1_000,
          url: 'wss://stream.data.alpaca.markets/v2/iex',
        },
        {
          clock: new FixedClock(createUtcTimestamp('2026-07-06T13:31:00.100Z')),
          webSocketFactory: { create: () => socket },
        },
      );
      const connection = await adapter.connect({
        subscription: createPhase2MarketDataSubscription(),
        handlers: { onEvent: vi.fn(), onInactivity: vi.fn(), onStatus: vi.fn() },
      });
      socket.emit('open', {});
      socket.emit('message', { data: '[{"T":"success","msg":"connected"}]' });
      socket.emit('message', { data: '[{"T":"success","msg":"authenticated"}]' });
      socket.emit('message', {
        data: '[{"T":"subscription","bars":["AAPL","SPY"],"trades":[],"quotes":[],"updatedBars":[],"dailyBars":[],"statuses":[],"lulds":[],"corrections":[],"cancelErrors":[]}]',
      });
      socket.emit('message', {
        data: `[{"T":"error","code":${code},"msg":"untrusted provider detail"}]`,
      });

      await expect(connection.done).rejects.toMatchObject({
        classification: 'retryable_transport',
        code: safeCode,
      });
    },
  );

  it.each([
    ['400', 'ALPACA_SUBSCRIPTION_SYNTAX_INVALID'],
    ['405', 'ALPACA_SYMBOL_LIMIT_EXCEEDED'],
    ['410', 'ALPACA_CHANNEL_UNAVAILABLE'],
    ['412', 'ALPACA_SUBSCRIPTION_REJECTED_412'],
  ] as const)(
    'preserves safe subscription error meaning for provider code %s',
    async (code, safeCode) => {
      const socket = new ControlledSocket();
      const adapter = new AlpacaMarketDataAdapter(
        {
          apiKey: 'key',
          apiSecret: 'secret',
          connectionTimeoutMs: 1_000,
          inactivityTimeoutMs: 10_000,
          queueCapacity: 2,
          shutdownTimeoutMs: 1_000,
          url: 'wss://stream.data.alpaca.markets/v2/iex',
        },
        {
          clock: new FixedClock(createUtcTimestamp('2026-07-06T13:31:00.100Z')),
          webSocketFactory: { create: () => socket },
        },
      );
      const connection = await adapter.connect({
        subscription: createPhase2MarketDataSubscription(),
        handlers: { onEvent: vi.fn(), onInactivity: vi.fn(), onStatus: vi.fn() },
      });
      socket.emit('open', {});
      socket.emit('message', { data: '[{"T":"success","msg":"connected"}]' });
      socket.emit('message', { data: '[{"T":"success","msg":"authenticated"}]' });
      socket.emit('message', {
        data: `[{"T":"error","code":${code},"msg":"untrusted provider detail"}]`,
      });

      await expect(connection.done).rejects.toMatchObject({
        classification: 'unsupported_subscription',
        code: safeCode,
      });
    },
  );
});
