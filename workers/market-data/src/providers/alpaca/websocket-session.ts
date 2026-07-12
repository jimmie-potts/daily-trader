import { AlpacaFrameDecoder } from './frame-decoder.js';
import {
  type AlpacaDecodedItem,
  type ClockLike,
  type ReceivedAlpacaBar,
  type TimerHandle,
  type TimerScheduler,
  type WebSocketEventListener,
  type WebSocketFactory,
  type WebSocketLike,
} from './types.js';

export type AlpacaSessionErrorCategory =
  | 'authentication'
  | 'backpressure'
  | 'cancelled'
  | 'entitlement'
  | 'protocol'
  | 'subscription'
  | 'timeout'
  | 'transport';

export type AlpacaSessionStage = 'authenticate' | 'close' | 'connect' | 'subscribe';

const ERROR_MESSAGES: Readonly<Record<AlpacaSessionErrorCategory, string>> = Object.freeze({
  authentication: 'Alpaca authentication was rejected',
  backpressure: 'Alpaca bar delivery exceeded its bounded queue',
  cancelled: 'Alpaca session was cancelled',
  entitlement: 'Alpaca market-data entitlement was rejected',
  protocol: 'Alpaca returned an invalid protocol sequence',
  subscription: 'Alpaca subscription was rejected',
  timeout: 'Alpaca session deadline expired',
  transport: 'Alpaca WebSocket transport failed',
});

export class AlpacaSessionError extends Error {
  public readonly category: AlpacaSessionErrorCategory;
  public readonly stage: AlpacaSessionStage | undefined;
  public readonly providerCode: string | undefined;

  public constructor(
    category: AlpacaSessionErrorCategory,
    options: {
      readonly providerCode?: string;
      readonly stage?: AlpacaSessionStage;
    } = {},
  ) {
    super(ERROR_MESSAGES[category]);
    this.name = 'AlpacaSessionError';
    this.category = category;
    this.stage = options.stage;
    this.providerCode = options.providerCode;
  }
}

export interface AlpacaWebSocketSessionOptions {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly connectTimeoutMs: number;
  readonly authenticationTimeoutMs: number;
  readonly subscriptionTimeoutMs: number;
  readonly closeTimeoutMs: number;
  readonly queueCapacity: number;
}

export interface AlpacaWebSocketSessionDependencies {
  readonly clock: ClockLike;
  readonly decoder?: AlpacaFrameDecoder;
  readonly onLifecycleState?: (state: 'authenticating' | 'connecting' | 'subscribed') => void;
  readonly onBar: (bar: ReceivedAlpacaBar) => Promise<void> | void;
  readonly timers?: TimerScheduler;
  readonly webSocketFactory: WebSocketFactory;
}

type SessionState =
  | 'authenticating'
  | 'awaiting_connected'
  | 'closed'
  | 'closing'
  | 'connecting'
  | 'idle'
  | 'subscribed'
  | 'subscribing';

const MAX_DEADLINE_MS = 60_000;
const MAX_QUEUE_CAPACITY = 10_000;
const AUTHENTICATION_ERROR_CODES = new Set(['401', '402', '403', '404']);
const ENTITLEMENT_ERROR_CODES = new Set(['409']);
const SUBSCRIPTION_ERROR_CODES = new Set(['405', '410']);
const RETRYABLE_TRANSPORT_ERROR_CODES = new Set(['406', '500']);
const BACKPRESSURE_ERROR_CODES = new Set(['407']);

const systemTimers: TimerScheduler = Object.freeze({
  clearTimeout: (handle: TimerHandle): void => {
    clearTimeout(handle as NodeJS.Timeout);
  },
  setTimeout: (callback: () => void, milliseconds: number): TimerHandle =>
    setTimeout(callback, milliseconds),
});

function validatePositiveInteger(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new AlpacaSessionError('protocol', { stage: 'connect' });
  }
}

function validateOptions(options: AlpacaWebSocketSessionOptions): void {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new AlpacaSessionError('protocol', { stage: 'connect' });
  }
  if (url.protocol !== 'wss:' || url.username.length > 0 || url.password.length > 0) {
    throw new AlpacaSessionError('protocol', { stage: 'connect' });
  }
  if (options.apiKey.length === 0 || options.apiSecret.length === 0) {
    throw new AlpacaSessionError('authentication', { stage: 'authenticate' });
  }
  validatePositiveInteger(options.connectTimeoutMs, MAX_DEADLINE_MS);
  validatePositiveInteger(options.authenticationTimeoutMs, MAX_DEADLINE_MS);
  validatePositiveInteger(options.subscriptionTimeoutMs, MAX_DEADLINE_MS);
  validatePositiveInteger(options.closeTimeoutMs, MAX_DEADLINE_MS);
  validatePositiveInteger(options.queueCapacity, MAX_QUEUE_CAPACITY);
}

function messageData(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null || !('data' in event)) {
    return undefined;
  }
  return typeof event.data === 'string' ? event.data : undefined;
}

function providerErrorCategory(code: string, state: SessionState): AlpacaSessionErrorCategory {
  if (BACKPRESSURE_ERROR_CODES.has(code)) {
    return 'backpressure';
  }
  if (RETRYABLE_TRANSPORT_ERROR_CODES.has(code)) {
    return 'transport';
  }
  if (ENTITLEMENT_ERROR_CODES.has(code)) {
    return 'entitlement';
  }
  if (AUTHENTICATION_ERROR_CODES.has(code) || state === 'authenticating') {
    return 'authentication';
  }
  if (SUBSCRIPTION_ERROR_CODES.has(code) || state === 'subscribing') {
    return 'subscription';
  }
  return 'protocol';
}

/**
 * Owns one Alpaca WebSocket lifecycle. It never logs or exposes provider frames,
 * credentials, provider error messages, or callback failure details.
 */
export class AlpacaWebSocketSession {
  readonly #options: AlpacaWebSocketSessionOptions;
  readonly #clock: ClockLike;
  readonly #decoder: AlpacaFrameDecoder;
  readonly #onLifecycleState: (state: 'authenticating' | 'connecting' | 'subscribed') => void;
  readonly #onBar: (bar: ReceivedAlpacaBar) => Promise<void> | void;
  readonly #timers: TimerScheduler;
  readonly #webSocketFactory: WebSocketFactory;
  readonly #queue: ReceivedAlpacaBar[] = [];

  #state: SessionState = 'idle';
  #socket: WebSocketLike | undefined;
  #deadline: TimerHandle | undefined;
  #completion: Promise<void> | undefined;
  #resolveCompletion: (() => void) | undefined;
  #rejectCompletion: ((error: AlpacaSessionError) => void) | undefined;
  #pendingCloseError: AlpacaSessionError | undefined;
  #abortSignal: AbortSignal | undefined;
  #outstandingBars = 0;
  #draining = false;

  readonly #onOpen: WebSocketEventListener = (): void => {
    if (this.#state !== 'connecting') {
      this.fail(new AlpacaSessionError('protocol', { stage: 'connect' }));
      return;
    }
    this.#state = 'awaiting_connected';
  };

  readonly #onMessage: WebSocketEventListener = (event): void => {
    if (this.#state === 'closing' || this.#state === 'closed') {
      return;
    }
    if (this.#state === 'connecting' || this.#state === 'idle') {
      this.fail(new AlpacaSessionError('protocol', { stage: 'connect' }));
      return;
    }
    const data = messageData(event);
    if (data === undefined) {
      this.fail(new AlpacaSessionError('protocol'));
      return;
    }
    const decoded = this.#decoder.decode(data);
    for (const item of decoded) {
      if (this.isClosingOrClosed()) {
        return;
      }
      this.handleItem(item);
    }
  };

  readonly #onError: WebSocketEventListener = (): void => {
    if (this.#state !== 'closing' && this.#state !== 'closed') {
      this.fail(new AlpacaSessionError('transport'));
    }
  };

  readonly #onClose: WebSocketEventListener = (): void => {
    if (this.#state === 'closed') {
      return;
    }
    if (this.#state === 'closing') {
      this.settle(this.#pendingCloseError);
      return;
    }
    this.settle(new AlpacaSessionError('transport'));
  };

  readonly #onAbort = (): void => {
    this.fail(new AlpacaSessionError('cancelled'));
  };

  public constructor(
    options: AlpacaWebSocketSessionOptions,
    dependencies: AlpacaWebSocketSessionDependencies,
  ) {
    validateOptions(options);
    this.#options = Object.freeze({ ...options });
    this.#clock = dependencies.clock;
    this.#decoder = dependencies.decoder ?? new AlpacaFrameDecoder();
    this.#onLifecycleState = dependencies.onLifecycleState ?? (() => undefined);
    this.#onBar = dependencies.onBar;
    this.#timers = dependencies.timers ?? systemTimers;
    this.#webSocketFactory = dependencies.webSocketFactory;
  }

  /** Runs until stopped, cancelled, remotely closed, or failed. */
  public run(signal?: AbortSignal): Promise<void> {
    if (this.#state !== 'idle') {
      return Promise.reject(new AlpacaSessionError('protocol', { stage: 'connect' }));
    }
    if (signal?.aborted === true) {
      this.#state = 'closed';
      return Promise.reject(new AlpacaSessionError('cancelled'));
    }

    this.#completion = new Promise<void>((resolve, reject) => {
      this.#resolveCompletion = resolve;
      this.#rejectCompletion = reject;
    });
    this.#abortSignal = signal;
    signal?.addEventListener('abort', this.#onAbort, { once: true });

    try {
      this.#socket = this.#webSocketFactory.create(this.#options.url);
      this.#state = 'connecting';
      this.#onLifecycleState('connecting');
      this.armDeadline('connect', this.#options.connectTimeoutMs);
      this.attachSocketListeners(this.#socket);
    } catch {
      this.settle(new AlpacaSessionError('transport', { stage: 'connect' }));
    }

    return this.#completion;
  }

  /** Gracefully closes the socket; the run promise resolves after close acknowledgement. */
  public stop(): Promise<void> {
    if (this.#state === 'idle') {
      return Promise.resolve();
    }
    if (this.#state !== 'closed' && this.#state !== 'closing') {
      this.beginClose(undefined);
    }
    return this.#completion ?? Promise.resolve();
  }

  /** Cancels the session with a safe classified error. */
  public cancel(): void {
    this.fail(new AlpacaSessionError('cancelled'));
  }

  private attachSocketListeners(socket: WebSocketLike): void {
    socket.addEventListener('open', this.#onOpen);
    socket.addEventListener('message', this.#onMessage);
    socket.addEventListener('error', this.#onError);
    socket.addEventListener('close', this.#onClose);
  }

  private isClosingOrClosed(): boolean {
    return this.#state === 'closing' || this.#state === 'closed';
  }

  private removeSocketListeners(): void {
    const socket = this.#socket;
    if (socket === undefined) {
      return;
    }
    socket.removeEventListener('open', this.#onOpen);
    socket.removeEventListener('message', this.#onMessage);
    socket.removeEventListener('error', this.#onError);
    socket.removeEventListener('close', this.#onClose);
  }

  private handleItem(item: AlpacaDecodedItem): void {
    switch (item.kind) {
      case 'connected':
        this.handleConnected();
        return;
      case 'authenticated':
        this.handleAuthenticated();
        return;
      case 'subscription':
        this.handleSubscription();
        return;
      case 'error':
        this.fail(
          new AlpacaSessionError(providerErrorCategory(item.code, this.#state), {
            providerCode: item.code,
          }),
        );
        return;
      case 'bar':
        this.handleBar(item);
        return;
      case 'ignored':
        return;
      case 'malformed':
        this.fail(
          new AlpacaSessionError(
            this.#state === 'subscribing' && item.reason === 'invalid_subscription'
              ? 'subscription'
              : 'protocol',
          ),
        );
        return;
    }
  }

  private handleConnected(): void {
    if (this.#state !== 'awaiting_connected') {
      this.fail(new AlpacaSessionError('protocol', { stage: 'connect' }));
      return;
    }
    this.clearDeadline();
    this.#state = 'authenticating';
    this.#onLifecycleState('authenticating');
    this.armDeadline('authenticate', this.#options.authenticationTimeoutMs);
    if (
      !this.send(
        JSON.stringify({
          action: 'auth',
          key: this.#options.apiKey,
          secret: this.#options.apiSecret,
        }),
      )
    ) {
      return;
    }
  }

  private handleAuthenticated(): void {
    if (this.#state !== 'authenticating') {
      this.fail(new AlpacaSessionError('protocol', { stage: 'authenticate' }));
      return;
    }
    this.clearDeadline();
    this.#state = 'subscribing';
    this.armDeadline('subscribe', this.#options.subscriptionTimeoutMs);
    if (!this.send(JSON.stringify({ action: 'subscribe', bars: ['AAPL', 'SPY'] }))) {
      return;
    }
  }

  private handleSubscription(): void {
    if (this.#state !== 'subscribing') {
      this.fail(new AlpacaSessionError('protocol', { stage: 'subscribe' }));
      return;
    }
    this.clearDeadline();
    this.#state = 'subscribed';
    this.#onLifecycleState('subscribed');
  }

  private handleBar(bar: Extract<AlpacaDecodedItem, { readonly kind: 'bar' }>): void {
    if (this.#state !== 'subscribed') {
      this.fail(new AlpacaSessionError('protocol'));
      return;
    }
    if (this.#outstandingBars >= this.#options.queueCapacity) {
      this.fail(new AlpacaSessionError('backpressure'));
      return;
    }

    let receivedAt: string;
    try {
      receivedAt = this.#clock.now();
    } catch {
      this.fail(new AlpacaSessionError('protocol'));
      return;
    }
    const receivedBar: ReceivedAlpacaBar = Object.freeze({ ...bar, receivedAt });
    this.#queue.push(receivedBar);
    this.#outstandingBars += 1;
    void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.#draining) {
      return;
    }
    this.#draining = true;
    try {
      while (this.#queue.length > 0) {
        const bar = this.#queue.shift();
        if (bar === undefined) {
          return;
        }
        try {
          await this.#onBar(bar);
        } catch {
          if (this.#state !== 'closing' && this.#state !== 'closed') {
            this.fail(new AlpacaSessionError('transport'));
          }
        } finally {
          this.#outstandingBars -= 1;
        }
        if (this.#state === 'closing' || this.#state === 'closed') {
          this.#queue.length = 0;
          return;
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  private send(data: string): boolean {
    const socket = this.#socket;
    if (socket === undefined) {
      this.fail(new AlpacaSessionError('transport'));
      return false;
    }
    try {
      socket.send(data);
      return true;
    } catch {
      this.fail(new AlpacaSessionError('transport'));
      return false;
    }
  }

  private armDeadline(stage: AlpacaSessionStage, milliseconds: number): void {
    this.clearDeadline();
    this.#deadline = this.#timers.setTimeout((): void => {
      this.#deadline = undefined;
      if (stage === 'close') {
        this.forceTerminateSocket();
        this.settle(
          this.#pendingCloseError ?? new AlpacaSessionError('timeout', { stage: 'close' }),
        );
        return;
      }
      this.fail(new AlpacaSessionError('timeout', { stage }));
    }, milliseconds);
  }

  private clearDeadline(): void {
    if (this.#deadline === undefined) {
      return;
    }
    this.#timers.clearTimeout(this.#deadline);
    this.#deadline = undefined;
  }

  private fail(error: AlpacaSessionError): void {
    if (this.#state === 'closed') {
      return;
    }
    if (this.#state === 'idle') {
      this.settle(error);
      return;
    }
    this.beginClose(error);
  }

  private beginClose(error: AlpacaSessionError | undefined): void {
    if (this.#state === 'closed') {
      return;
    }
    if (this.#state === 'closing') {
      this.#pendingCloseError ??= error;
      return;
    }

    this.clearDeadline();
    this.#pendingCloseError = error;
    this.#state = 'closing';
    this.armDeadline('close', this.#options.closeTimeoutMs);
    try {
      this.#socket?.close(1000, 'client shutdown');
      if (this.#socket === undefined) {
        this.settle(error);
      }
    } catch {
      this.forceTerminateSocket();
      this.settle(error ?? new AlpacaSessionError('transport', { stage: 'close' }));
    }
  }

  private forceTerminateSocket(): void {
    try {
      this.#socket?.terminate();
    } catch {
      // The session still settles with its existing safe, classified error.
    }
  }

  private settle(error: AlpacaSessionError | undefined): void {
    if (this.#state === 'closed') {
      return;
    }
    this.clearDeadline();
    this.removeSocketListeners();
    this.#socket = undefined;
    this.#abortSignal?.removeEventListener('abort', this.#onAbort);
    this.#abortSignal = undefined;
    this.#queue.length = 0;
    this.#state = 'closed';

    const resolve = this.#resolveCompletion;
    const reject = this.#rejectCompletion;
    this.#resolveCompletion = undefined;
    this.#rejectCompletion = undefined;
    if (error === undefined) {
      resolve?.();
    } else {
      reject?.(error);
    }
  }
}
