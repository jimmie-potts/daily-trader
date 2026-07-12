import { describe, expect, it } from 'vitest';

import type {
  TimerHandle,
  TimerScheduler,
  WebSocketEventListener,
  WebSocketEventType,
  WebSocketFactory,
  WebSocketLike,
} from './types.js';
import {
  AlpacaSessionError,
  AlpacaWebSocketSession,
  type AlpacaWebSocketSessionOptions,
} from './websocket-session.js';

const CONNECTED = '[{"T":"success","msg":"connected"}]';
const AUTHENTICATED = '[{"T":"success","msg":"authenticated"}]';
const SUBSCRIBED =
  '[{"T":"subscription","trades":[],"quotes":[],"bars":["AAPL","SPY"],"updatedBars":[],"dailyBars":[],"statuses":[],"lulds":[],"corrections":[],"cancelErrors":[]}]';
const AAPL_BAR =
  '[{"T":"b","S":"AAPL","o":189.5000,"h":190.1250,"l":189.2500,"c":190.0000,"v":90071992547409931234567890,"t":"2026-07-10T14:31:00.123456789Z"}]';
const SPY_BAR =
  '[{"T":"b","S":"SPY","o":611.1000,"h":611.4000,"l":610.9000,"c":611.2500,"v":1234567,"t":"2026-07-10T14:31:00Z"}]';

class FakeWebSocket implements WebSocketLike {
  public readonly sent: string[] = [];
  public terminateCalls = 0;
  public readonly closeCalls: {
    readonly code: number | undefined;
    readonly reason: string | undefined;
  }[] = [];
  readonly #listeners = new Map<WebSocketEventType, Set<WebSocketEventListener>>();

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

  public close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  public terminate(): void {
    this.terminateCalls += 1;
  }

  public open(): void {
    this.emit('open', {});
  }

  public message(data: string): void {
    this.emit('message', { data });
  }

  public fail(detail: unknown): void {
    this.emit('error', detail);
  }

  public closed(): void {
    this.emit('close', {});
  }

  private emit(type: WebSocketEventType, event: unknown): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

class FakeWebSocketFactory implements WebSocketFactory {
  public readonly urls: string[] = [];

  public constructor(public readonly socket: FakeWebSocket) {}

  public create(url: string): WebSocketLike {
    this.urls.push(url);
    return this.socket;
  }
}

interface PendingTimer {
  readonly callback: () => void;
  readonly handle: object;
  readonly milliseconds: number;
}

class ManualTimers implements TimerScheduler {
  readonly #pending: PendingTimer[] = [];

  public setTimeout(callback: () => void, milliseconds: number): TimerHandle {
    const handle = {};
    this.#pending.push({ callback, handle, milliseconds });
    return handle;
  }

  public clearTimeout(handle: TimerHandle): void {
    const index = this.#pending.findIndex((timer) => timer.handle === handle);
    if (index >= 0) {
      this.#pending.splice(index, 1);
    }
  }

  public fireNext(): void {
    const timer = this.#pending.shift();
    if (timer === undefined) {
      throw new Error('expected a pending timer');
    }
    timer.callback();
  }

  public pendingMilliseconds(): readonly number[] {
    return this.#pending.map((timer) => timer.milliseconds);
  }
}

const OPTIONS: AlpacaWebSocketSessionOptions = Object.freeze({
  apiKey: 'recognizable-test-key',
  apiSecret: 'recognizable-test-secret',
  authenticationTimeoutMs: 2_000,
  closeTimeoutMs: 500,
  connectTimeoutMs: 1_000,
  queueCapacity: 2,
  subscriptionTimeoutMs: 3_000,
  url: 'wss://stream.data.alpaca.markets/v2/iex',
});

interface Harness {
  readonly factory: FakeWebSocketFactory;
  readonly session: AlpacaWebSocketSession;
  readonly socket: FakeWebSocket;
  readonly timers: ManualTimers;
}

function harness(
  overrides: Partial<AlpacaWebSocketSessionOptions> = {},
  onBar: ConstructorParameters<typeof AlpacaWebSocketSession>[1]['onBar'] = (): void => undefined,
): Harness {
  const socket = new FakeWebSocket();
  const factory = new FakeWebSocketFactory(socket);
  const timers = new ManualTimers();
  const session = new AlpacaWebSocketSession(
    { ...OPTIONS, ...overrides },
    {
      clock: { now: (): string => '2026-07-10T14:31:01.000Z' },
      onBar,
      timers,
      webSocketFactory: factory,
    },
  );
  return { factory, session, socket, timers };
}

function authenticateAndSubscribe(socket: FakeWebSocket): void {
  socket.open();
  socket.message(CONNECTED);
  socket.message(AUTHENTICATED);
  socket.message(SUBSCRIBED);
}

async function capturedFailure(run: Promise<void>): Promise<AlpacaSessionError> {
  try {
    await run;
    throw new Error('expected session to fail');
  } catch (error) {
    if (!(error instanceof AlpacaSessionError)) {
      throw error;
    }
    return error;
  }
}

describe('AlpacaWebSocketSession', () => {
  it('authenticates once, subscribes to exactly AAPL/SPY bars, then delivers exact bars', async () => {
    const delivered: unknown[] = [];
    const { factory, session, socket, timers } = harness({}, (bar): void => {
      delivered.push(bar);
    });
    const run = session.run();

    expect(factory.urls).toEqual([OPTIONS.url]);
    expect(timers.pendingMilliseconds()).toEqual([1_000]);
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toEqual([]);

    socket.message(CONNECTED);
    expect(socket.sent).toEqual([
      JSON.stringify({
        action: 'auth',
        key: OPTIONS.apiKey,
        secret: OPTIONS.apiSecret,
      }),
    ]);
    expect(timers.pendingMilliseconds()).toEqual([2_000]);

    socket.message(AUTHENTICATED);
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[1]).toBe(JSON.stringify({ action: 'subscribe', bars: ['AAPL', 'SPY'] }));
    expect(timers.pendingMilliseconds()).toEqual([3_000]);

    socket.message(SUBSCRIBED);
    expect(timers.pendingMilliseconds()).toEqual([]);
    socket.message(AAPL_BAR);
    await Promise.resolve();

    expect(delivered).toEqual([
      {
        close: '190.0000',
        high: '190.1250',
        kind: 'bar',
        low: '189.2500',
        open: '189.5000',
        providerTimestamp: '2026-07-10T14:31:00.123456789Z',
        receivedAt: '2026-07-10T14:31:01.000Z',
        symbol: 'AAPL',
        volume: '90071992547409931234567890',
      },
    ]);

    const stopped = session.stop();
    expect(socket.closeCalls).toEqual([{ code: 1000, reason: 'client shutdown' }]);
    socket.closed();
    await stopped;
    await run;
    expect(socket.terminateCalls).toBe(0);
  });

  it('rejects a bar received before subscription acknowledgement', async () => {
    const delivered: unknown[] = [];
    const { session, socket } = harness({}, (bar): void => {
      delivered.push(bar);
    });
    const failure = capturedFailure(session.run());
    socket.open();
    socket.message(CONNECTED);
    socket.message(AAPL_BAR);
    socket.closed();

    await expect(failure).resolves.toMatchObject({ category: 'protocol' });
    expect(delivered).toEqual([]);
  });

  it('classifies authentication and entitlement rejections without exposing provider messages', async () => {
    const authentication = harness();
    const authenticationFailure = capturedFailure(authentication.session.run());
    authentication.socket.open();
    authentication.socket.message(CONNECTED);
    authentication.socket.message(
      '[{"T":"error","code":402,"msg":"rejected recognizable-test-secret"}]',
    );
    authentication.socket.closed();
    const authenticationError = await authenticationFailure;

    expect(authenticationError).toMatchObject({
      category: 'authentication',
      providerCode: '402',
    });
    expect(JSON.stringify(authenticationError)).not.toContain('recognizable-test-secret');
    expect(authenticationError.message).not.toContain('recognizable-test-secret');

    const entitlement = harness();
    const entitlementFailure = capturedFailure(entitlement.session.run());
    entitlement.socket.open();
    entitlement.socket.message(CONNECTED);
    entitlement.socket.message(AUTHENTICATED);
    entitlement.socket.message('[{"T":"error","code":409,"msg":"feed rejected raw-error-body"}]');
    entitlement.socket.closed();

    await expect(entitlementFailure).resolves.toMatchObject({
      category: 'entitlement',
      providerCode: '409',
    });

    const subscription = harness();
    const subscriptionFailure = capturedFailure(subscription.session.run());
    subscription.socket.open();
    subscription.socket.message(CONNECTED);
    subscription.socket.message(AUTHENTICATED);
    subscription.socket.message('[{"T":"error","code":405,"msg":"scope rejected raw-error-body"}]');
    subscription.socket.closed();

    await expect(subscriptionFailure).resolves.toMatchObject({
      category: 'subscription',
      providerCode: '405',
    });
  });

  it.each([
    ['407', 'backpressure'],
    ['500', 'transport'],
  ] as const)('classifies provider error %s as retryable %s failure', async (code, category) => {
    const { session, socket } = harness();
    const failure = capturedFailure(session.run());
    authenticateAndSubscribe(socket);
    socket.message(`[{"T":"error","code":${code},"msg":"untrusted provider detail"}]`);
    socket.closed();

    await expect(failure).resolves.toMatchObject({ category, providerCode: code });
  });

  it('classifies invalid feed subscription code 410 as terminal subscription failure', async () => {
    const { session, socket } = harness();
    const failure = capturedFailure(session.run());
    socket.open();
    socket.message(CONNECTED);
    socket.message(AUTHENTICATED);
    socket.message('[{"T":"error","code":410,"msg":"untrusted provider detail"}]');
    socket.closed();

    await expect(failure).resolves.toMatchObject({
      category: 'subscription',
      providerCode: '410',
    });
  });

  it('enforces separate connect, authentication, and subscription deadlines', async () => {
    const connect = harness();
    const connectFailure = capturedFailure(connect.session.run());
    connect.timers.fireNext();
    connect.socket.closed();
    await expect(connectFailure).resolves.toMatchObject({ category: 'timeout', stage: 'connect' });

    const authenticate = harness();
    const authenticateFailure = capturedFailure(authenticate.session.run());
    authenticate.socket.open();
    authenticate.socket.message(CONNECTED);
    authenticate.timers.fireNext();
    authenticate.socket.closed();
    await expect(authenticateFailure).resolves.toMatchObject({
      category: 'timeout',
      stage: 'authenticate',
    });

    const subscribe = harness();
    const subscribeFailure = capturedFailure(subscribe.session.run());
    subscribe.socket.open();
    subscribe.socket.message(CONNECTED);
    subscribe.socket.message(AUTHENTICATED);
    subscribe.timers.fireNext();
    subscribe.socket.closed();
    await expect(subscribeFailure).resolves.toMatchObject({
      category: 'timeout',
      stage: 'subscribe',
    });
  });

  it('ignores unsupported event kinds but rejects malformed frames safely', async () => {
    const { session, socket } = harness();
    const failure = capturedFailure(session.run());
    socket.open();
    socket.message('[{"T":"q","S":"AAPL"}]');
    expect(socket.closeCalls).toEqual([]);
    socket.message('[{"T":"b"}');
    socket.closed();

    await expect(failure).resolves.toMatchObject({ category: 'protocol' });
  });

  it('fails closed when the bounded callback queue overflows', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { session, socket } = harness({ queueCapacity: 1 }, async (): Promise<void> => blocked);
    const failure = capturedFailure(session.run());
    authenticateAndSubscribe(socket);
    socket.message(AAPL_BAR);
    socket.message(SPY_BAR);
    socket.closed();

    await expect(failure).resolves.toMatchObject({ category: 'backpressure' });
    release?.();
    await blocked;
  });

  it('cancels through AbortSignal and bounds close even without a close event', async () => {
    const { session, socket, timers } = harness();
    const controller = new AbortController();
    const failure = capturedFailure(session.run(controller.signal));
    controller.abort('recognizable-abort-secret');

    expect(socket.closeCalls).toEqual([{ code: 1000, reason: 'client shutdown' }]);
    expect(timers.pendingMilliseconds()).toEqual([500]);
    timers.fireNext();
    const error = await failure;

    expect(error.category).toBe('cancelled');
    expect(socket.terminateCalls).toBe(1);
    expect(JSON.stringify(error)).not.toContain('recognizable-abort-secret');
  });

  it('reports a bounded close timeout for a graceful stop with no close acknowledgement', async () => {
    const { session, socket, timers } = harness();
    const runFailure = capturedFailure(session.run());
    const stopFailure = capturedFailure(session.stop());
    expect(timers.pendingMilliseconds()).toEqual([500]);
    timers.fireNext();

    await expect(runFailure).resolves.toMatchObject({ category: 'timeout', stage: 'close' });
    await expect(stopFailure).resolves.toMatchObject({ category: 'timeout', stage: 'close' });
    expect(socket.terminateCalls).toBe(1);
  });

  it('does not expose transport event details or callback exceptions', async () => {
    const transport = harness();
    const transportFailure = capturedFailure(transport.session.run());
    transport.socket.fail({ detail: 'raw-frame recognizable-test-secret' });
    transport.socket.closed();
    const transportError = await transportFailure;
    expect(transportError.category).toBe('transport');
    expect(JSON.stringify(transportError)).not.toContain('recognizable-test-secret');

    const callback = harness({}, (): never => {
      throw new Error('callback recognizable-test-secret');
    });
    const callbackFailure = capturedFailure(callback.session.run());
    authenticateAndSubscribe(callback.socket);
    callback.socket.message(AAPL_BAR);
    await Promise.resolve();
    callback.socket.closed();
    const callbackError = await callbackFailure;
    expect(callbackError.category).toBe('transport');
    expect(JSON.stringify(callbackError)).not.toContain('recognizable-test-secret');
  });

  it('rejects unsafe options before creating a socket', () => {
    expect(() => harness({ url: 'ws://stream.data.alpaca.markets/v2/iex' })).toThrowError(
      AlpacaSessionError,
    );
    expect(() => harness({ queueCapacity: 0 })).toThrowError(AlpacaSessionError);
    expect(() => harness({ apiSecret: '' })).toThrowError(AlpacaSessionError);
  });
});
