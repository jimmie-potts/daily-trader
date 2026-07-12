import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import {
  MarketDataAdapterError,
  ScriptedMarketDataAdapter,
  createOneMinuteBarEvent,
  createPhase2MarketDataSubscription,
  type MarketDataAdapter,
  type MarketDataAdapterConnection,
} from '@daily-trader/market-data';
import { describe, expect, it, vi } from 'vitest';

import { AlpacaMarketDataAdapter } from './alpaca/adapter.js';
import type { WebSocketEventListener, WebSocketEventType, WebSocketLike } from './alpaca/types.js';

const CLOCK = new FixedClock(createUtcTimestamp('2026-07-13T13:31:01.000Z'));
const EVENT = createOneMinuteBarEvent({
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
const CONNECTED = '[{"T":"success","msg":"connected"}]';
const AUTHENTICATED = '[{"T":"success","msg":"authenticated"}]';
const SUBSCRIBED =
  '[{"T":"subscription","trades":[],"quotes":[],"bars":["AAPL","SPY"],"updatedBars":[],"dailyBars":[],"statuses":[],"lulds":[],"corrections":[],"cancelErrors":[]}]';
const BAR =
  '[{"T":"b","S":"AAPL","o":100,"h":101,"l":99,"c":100.5,"v":1000,"t":"2026-07-13T13:30:00Z"}]';

class ContractSocket implements WebSocketLike {
  readonly #listeners = new Map<WebSocketEventType, Set<WebSocketEventListener>>();

  public addEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<WebSocketEventListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public send(): void {}

  public close(): void {
    this.emit('close', {});
  }

  public terminate(): void {}

  public emit(type: WebSocketEventType, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

interface AdapterContractScenario {
  readonly adapter: MarketDataAdapter;
  activate(): void;
}

interface AdapterContractHarness {
  happy(): AdapterContractScenario;
  authenticationFailure(): AdapterContractScenario;
}

function alpacaAdapter(socket: ContractSocket): MarketDataAdapter {
  return new AlpacaMarketDataAdapter(
    {
      apiKey: 'recognizable-test-key',
      apiSecret: 'recognizable-test-secret',
      connectionTimeoutMs: 1_000,
      inactivityTimeoutMs: 10_000,
      queueCapacity: 4,
      shutdownTimeoutMs: 1_000,
      url: 'wss://stream.data.alpaca.markets/v2/iex',
    },
    { clock: CLOCK, webSocketFactory: { create: () => socket } },
  );
}

const scriptedHarness: AdapterContractHarness = {
  happy: () => ({
    adapter: new ScriptedMarketDataAdapter(CLOCK, [
      { kind: 'status', state: 'connecting' },
      { kind: 'status', state: 'authenticating' },
      { kind: 'status', state: 'subscribed' },
      { kind: 'event', event: EVENT },
      { kind: 'event', event: EVENT },
      { kind: 'await_cancellation' },
    ]),
    activate: (): void => undefined,
  }),
  authenticationFailure: () => ({
    adapter: new ScriptedMarketDataAdapter(CLOCK, [
      { kind: 'status', state: 'connecting' },
      {
        kind: 'error',
        error: new MarketDataAdapterError('authentication', 'AUTH_REJECTED', 'safe'),
      },
    ]),
    activate: (): void => undefined,
  }),
};

const alpacaHarness: AdapterContractHarness = {
  happy: () => {
    const socket = new ContractSocket();
    return {
      adapter: alpacaAdapter(socket),
      activate: (): void => {
        socket.emit('open', {});
        socket.emit('message', { data: CONNECTED });
        socket.emit('message', { data: AUTHENTICATED });
        socket.emit('message', { data: SUBSCRIBED });
        socket.emit('message', { data: BAR });
        socket.emit('message', { data: BAR });
      },
    };
  },
  authenticationFailure: () => {
    const socket = new ContractSocket();
    return {
      adapter: alpacaAdapter(socket),
      activate: (): void => {
        socket.emit('open', {});
        socket.emit('message', { data: CONNECTED });
        socket.emit('message', { data: '[{"T":"error","code":402,"msg":"rejected"}]' });
      },
    };
  },
};

function runMarketDataAdapterContract(name: string, harness: AdapterContractHarness): void {
  describe(`${name} market-data adapter contract`, () => {
    it('orders lifecycle before events, preserves duplicates, and cancels idempotently', async () => {
      const scenario = harness.happy();
      const statuses: string[] = [];
      const eventIds: string[] = [];
      const connection: MarketDataAdapterConnection = await scenario.adapter.connect({
        subscription: createPhase2MarketDataSubscription(),
        handlers: {
          onEvent: ({ eventId }): void => {
            eventIds.push(eventId);
          },
          onInactivity: vi.fn(),
          onStatus: ({ state }): void => {
            statuses.push(state);
          },
        },
      });
      scenario.activate();
      await vi.waitFor(() => expect(eventIds).toHaveLength(2));
      await Promise.all([connection.cancel(), connection.cancel()]);
      await connection.done;

      expect(statuses.slice(0, 3)).toEqual(['connecting', 'authenticating', 'subscribed']);
      expect(statuses.at(-1)).toBe('stopped');
      expect(eventIds).toEqual([EVENT.eventId, EVENT.eventId]);
    });

    it('returns the application-owned authentication classification', async () => {
      const scenario = harness.authenticationFailure();
      const connection = await scenario.adapter.connect({
        subscription: createPhase2MarketDataSubscription(),
        handlers: { onEvent: vi.fn(), onInactivity: vi.fn(), onStatus: vi.fn() },
      });
      scenario.activate();

      await expect(connection.done).rejects.toMatchObject({
        classification: 'authentication',
        retryable: false,
      });
    });
  });
}

runMarketDataAdapterContract('scripted', scriptedHarness);
runMarketDataAdapterContract('Alpaca', alpacaHarness);
