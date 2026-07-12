import { createUtcTimestamp, type Clock } from '@daily-trader/domain';
import {
  MarketDataAdapterError,
  validateMarketDataSubscription,
  type MarketDataAdapter,
  type MarketDataAdapterConnection,
  type MarketDataAdapterErrorClassification,
  type MarketDataAdapterRequest,
  type MarketDataConnectionState,
} from '@daily-trader/market-data';

import { normalizeAlpacaBar } from './normalizer.js';
import type { TimerHandle, TimerScheduler, WebSocketFactory } from './types.js';
import {
  AlpacaSessionError,
  AlpacaWebSocketSession,
  type AlpacaSessionErrorCategory,
} from './websocket-session.js';

export interface AlpacaMarketDataAdapterOptions {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly connectionTimeoutMs: number;
  readonly inactivityTimeoutMs: number;
  readonly queueCapacity: number;
  readonly shutdownTimeoutMs: number;
  readonly url: string;
}

export interface AlpacaMarketDataAdapterDependencies {
  readonly clock: Clock;
  readonly timers?: TimerScheduler;
  readonly webSocketFactory: WebSocketFactory;
}

const systemTimers: TimerScheduler = Object.freeze({
  clearTimeout: (handle: TimerHandle): void => clearTimeout(handle as NodeJS.Timeout),
  setTimeout: (callback: () => void, milliseconds: number): TimerHandle =>
    setTimeout(callback, milliseconds),
});

function sharedClassification(
  category: AlpacaSessionErrorCategory,
): MarketDataAdapterErrorClassification {
  switch (category) {
    case 'authentication':
      return 'authentication';
    case 'entitlement':
      return 'entitlement';
    case 'subscription':
      return 'unsupported_subscription';
    case 'protocol':
      return 'malformed_data';
    case 'backpressure':
    case 'timeout':
    case 'transport':
    case 'cancelled':
      return 'retryable_transport';
  }
}

function safeErrorCode(error: AlpacaSessionError): string {
  if (error.category === 'authentication') return 'ALPACA_AUTHENTICATION_REJECTED';
  if (error.category === 'entitlement') return 'ALPACA_ENTITLEMENT_REJECTED';
  if (error.category === 'subscription') {
    if (error.providerCode === '400') return 'ALPACA_SUBSCRIPTION_SYNTAX_INVALID';
    if (error.providerCode === '405') return 'ALPACA_SYMBOL_LIMIT_EXCEEDED';
    if (error.providerCode === '410') return 'ALPACA_CHANNEL_UNAVAILABLE';
    if (error.providerCode !== undefined && /^[0-9]{3}$/u.test(error.providerCode)) {
      return `ALPACA_SUBSCRIPTION_REJECTED_${error.providerCode}`;
    }
    return 'ALPACA_SUBSCRIPTION_REJECTED';
  }
  if (error.category === 'backpressure') return 'ALPACA_BACKPRESSURE';
  if (error.category === 'timeout') return 'ALPACA_TIMEOUT';
  if (error.category === 'cancelled') return 'ALPACA_CANCELLED';
  if (error.category === 'protocol') return 'ALPACA_PROTOCOL_INVALID';
  return 'ALPACA_TRANSPORT_FAILED';
}

function translateSessionError(error: unknown): MarketDataAdapterError {
  if (error instanceof MarketDataAdapterError) {
    return error;
  }
  if (error instanceof AlpacaSessionError) {
    return new MarketDataAdapterError(
      sharedClassification(error.category),
      safeErrorCode(error),
      'The Alpaca market-data session failed',
    );
  }
  return new MarketDataAdapterError(
    'retryable_transport',
    'ALPACA_SESSION_FAILED',
    'The Alpaca market-data session failed',
  );
}

/** Provider-specific implementation of the application-owned adapter port. */
export class AlpacaMarketDataAdapter implements MarketDataAdapter {
  readonly #options: AlpacaMarketDataAdapterOptions;
  readonly #clock: Clock;
  readonly #timers: TimerScheduler;
  readonly #webSocketFactory: WebSocketFactory;

  public constructor(
    options: AlpacaMarketDataAdapterOptions,
    dependencies: AlpacaMarketDataAdapterDependencies,
  ) {
    this.#options = Object.freeze({ ...options });
    this.#clock = dependencies.clock;
    this.#timers = dependencies.timers ?? systemTimers;
    this.#webSocketFactory = dependencies.webSocketFactory;
  }

  public connect(request: MarketDataAdapterRequest): Promise<MarketDataAdapterConnection> {
    try {
      validateMarketDataSubscription(request.subscription);
    } catch (error) {
      return Promise.reject(translateSessionError(error));
    }

    const controller = new AbortController();
    const lifecycle = { cancellationRequested: false, inactivityTriggered: false };
    let inactivityTimer: TimerHandle | undefined;
    let callbackFailure: MarketDataAdapterError | undefined;
    let normalizationFailure: MarketDataAdapterError | undefined;
    let statusChain = Promise.resolve();
    const forwardAbort = (): void => {
      lifecycle.cancellationRequested = true;
      controller.abort();
    };
    request.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (request.signal?.aborted === true) {
      forwardAbort();
    }

    const queueStatus = (state: MarketDataConnectionState): void => {
      statusChain = statusChain.then(async () => {
        try {
          await request.handlers.onStatus(
            Object.freeze({ state, occurredAt: createUtcTimestamp(this.#clock.now()) }),
          );
        } catch {
          callbackFailure = new MarketDataAdapterError(
            'contract',
            'STATUS_CALLBACK_FAILED',
            'A market-data status callback failed',
          );
        }
      });
    };

    const clearInactivity = (): void => {
      if (inactivityTimer !== undefined) {
        this.#timers.clearTimeout(inactivityTimer);
        inactivityTimer = undefined;
      }
    };

    const sessionHolder: { current?: AlpacaWebSocketSession } = {};
    const armInactivity = (): void => {
      clearInactivity();
      inactivityTimer = this.#timers.setTimeout(() => {
        inactivityTimer = undefined;
        lifecycle.inactivityTriggered = true;
        const occurredAt = createUtcTimestamp(this.#clock.now());
        void Promise.resolve(request.handlers.onInactivity(occurredAt))
          .catch(() => {
            callbackFailure = new MarketDataAdapterError(
              'contract',
              'INACTIVITY_CALLBACK_FAILED',
              'A market-data inactivity callback failed',
            );
          })
          .finally(() => sessionHolder.current?.cancel());
      }, this.#options.inactivityTimeoutMs);
    };

    const session = new AlpacaWebSocketSession(
      {
        url: this.#options.url,
        apiKey: this.#options.apiKey,
        apiSecret: this.#options.apiSecret,
        connectTimeoutMs: this.#options.connectionTimeoutMs,
        authenticationTimeoutMs: this.#options.connectionTimeoutMs,
        subscriptionTimeoutMs: this.#options.connectionTimeoutMs,
        closeTimeoutMs: this.#options.shutdownTimeoutMs,
        queueCapacity: this.#options.queueCapacity,
      },
      {
        clock: this.#clock,
        timers: this.#timers,
        webSocketFactory: this.#webSocketFactory,
        onLifecycleState: (state): void => {
          queueStatus(state);
          if (state === 'subscribed') {
            armInactivity();
          }
        },
        onBar: async (bar): Promise<void> => {
          clearInactivity();
          let event;
          try {
            event = normalizeAlpacaBar(bar, this.#clock);
          } catch {
            normalizationFailure = new MarketDataAdapterError(
              'malformed_data',
              'ALPACA_BAR_INVALID',
              'An Alpaca bar failed application validation',
            );
            throw normalizationFailure;
          }
          await statusChain;
          if (callbackFailure !== undefined) {
            throw callbackFailure;
          }
          try {
            await request.handlers.onEvent(event);
          } catch {
            callbackFailure = new MarketDataAdapterError(
              'contract',
              'EVENT_CALLBACK_FAILED',
              'A market-data event callback failed',
            );
            throw callbackFailure;
          } finally {
            armInactivity();
          }
        },
      },
    );
    sessionHolder.current = session;

    const runPromise = session.run(controller.signal);
    const done = (async (): Promise<void> => {
      try {
        await runPromise;
        await statusChain;
        if (callbackFailure !== undefined) {
          throw callbackFailure;
        }
        queueStatus('stopped');
        await statusChain;
      } catch (error) {
        await statusChain;
        if (lifecycle.cancellationRequested) {
          queueStatus('stopped');
          await statusChain;
          return;
        }
        const translated =
          callbackFailure ??
          normalizationFailure ??
          (lifecycle.inactivityTriggered
            ? new MarketDataAdapterError(
                'retryable_transport',
                'ALPACA_INACTIVITY_TIMEOUT',
                'The Alpaca feed stopped delivering valid market data',
              )
            : translateSessionError(error));
        queueStatus(translated.retryable ? 'reconnecting' : 'terminal_failure');
        await statusChain;
        throw translated;
      } finally {
        clearInactivity();
        request.signal?.removeEventListener('abort', forwardAbort);
      }
    })();

    let cancelPromise: Promise<void> | undefined;
    return Promise.resolve(
      Object.freeze({
        done,
        cancel: (): Promise<void> => {
          cancelPromise ??= (async (): Promise<void> => {
            lifecycle.cancellationRequested = true;
            clearInactivity();
            await session.stop();
            await done;
          })();
          return cancelPromise;
        },
      }),
    );
  }
}
