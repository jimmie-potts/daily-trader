import { createUtcTimestamp, type Clock } from '@daily-trader/domain';

import {
  MarketDataAdapterError,
  validateMarketDataSubscription,
  type MarketDataAdapter,
  type MarketDataAdapterConnection,
  type MarketDataAdapterRequest,
  type MarketDataAdapterStatus,
} from './adapter.js';
import { type OneMinuteBarEvent } from './bar-event.js';
import { transitionMarketDataConnection, type MarketDataConnectionState } from './recovery.js';

export type ScriptedMarketDataStep =
  | Readonly<{
      kind: 'status';
      state: 'connecting' | 'authenticating' | 'subscribed' | 'reconnecting';
    }>
  | Readonly<{ kind: 'event'; event: OneMinuteBarEvent }>
  | Readonly<{ kind: 'inactivity' }>
  | Readonly<{ kind: 'error'; error: MarketDataAdapterError }>
  | Readonly<{ kind: 'await_cancellation' }>;

class CancellationRequested extends Error {}

function cancellationPromise(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new CancellationRequested());
      return;
    }
    signal.addEventListener('abort', () => reject(new CancellationRequested()), { once: true });
  });
}

function eventForTargetState(
  current: MarketDataConnectionState,
  target: Extract<ScriptedMarketDataStep, { kind: 'status' }>['state'],
): Parameters<typeof transitionMarketDataConnection>[1] {
  if (current === 'disabled' && target === 'connecting') {
    return 'start';
  }
  if (current === 'connecting' && target === 'authenticating') {
    return 'socket_opened';
  }
  if (current === 'authenticating' && target === 'subscribed') {
    return 'subscription_acknowledged';
  }
  if (
    (current === 'connecting' || current === 'authenticating' || current === 'subscribed') &&
    target === 'reconnecting'
  ) {
    return 'retryable_failure';
  }
  if (current === 'reconnecting' && target === 'connecting') {
    return 'retry_started';
  }
  throw new MarketDataAdapterError(
    'contract',
    'INVALID_SCRIPTED_TRANSITION',
    `Invalid scripted transition from ${current} to ${target}`,
  );
}

async function awaitCallback(
  operation: () => Promise<void> | void,
  signal: AbortSignal,
): Promise<void> {
  let cancel: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    cancel = (): void => reject(new CancellationRequested());
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    await Promise.race([Promise.resolve().then(operation), cancellation]);
  } catch (error) {
    if (error instanceof CancellationRequested) {
      throw error;
    }
    throw new MarketDataAdapterError(
      'contract',
      'CONSUMER_CALLBACK_FAILED',
      'A market-data consumer callback failed',
    );
  } finally {
    if (cancel !== undefined) {
      signal.removeEventListener('abort', cancel);
    }
  }
}

/** Offline adapter that executes immutable scripted steps with no event buffer. */
export class ScriptedMarketDataAdapter implements MarketDataAdapter {
  readonly #clock: Clock;
  readonly #steps: readonly ScriptedMarketDataStep[];

  public constructor(clock: Clock, steps: readonly ScriptedMarketDataStep[]) {
    this.#clock = clock;
    this.#steps = Object.freeze([...steps]);
  }

  public connect(request: MarketDataAdapterRequest): Promise<MarketDataAdapterConnection> {
    try {
      validateMarketDataSubscription(request.subscription);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new MarketDataAdapterError(
              'contract',
              'INVALID_SUBSCRIPTION',
              'Subscription validation failed',
            ),
      );
    }
    const controller = new AbortController();
    const externalSignal = request.signal;
    const forwardCancellation = (): void => controller.abort();
    externalSignal?.addEventListener('abort', forwardCancellation, { once: true });
    if (externalSignal?.aborted === true) {
      controller.abort();
    }

    let state: MarketDataConnectionState = 'disabled';
    const emitStatus = async (next: MarketDataConnectionState): Promise<void> => {
      const status: MarketDataAdapterStatus = Object.freeze({
        state: next,
        occurredAt: createUtcTimestamp(this.#clock.now()),
      });
      await awaitCallback(() => request.handlers.onStatus(status), controller.signal);
    };

    const run = async (): Promise<void> => {
      try {
        for (const step of this.#steps) {
          if (controller.signal.aborted) {
            throw new CancellationRequested();
          }
          switch (step.kind) {
            case 'status': {
              state = transitionMarketDataConnection(state, eventForTargetState(state, step.state));
              await emitStatus(state);
              break;
            }
            case 'event': {
              if (state !== 'subscribed') {
                throw new MarketDataAdapterError(
                  'contract',
                  'EVENT_BEFORE_SUBSCRIBED',
                  'A scripted event cannot be delivered before subscription acknowledgement',
                );
              }
              await awaitCallback(() => request.handlers.onEvent(step.event), controller.signal);
              break;
            }
            case 'inactivity': {
              if (state !== 'subscribed') {
                throw new MarketDataAdapterError(
                  'contract',
                  'INACTIVITY_BEFORE_SUBSCRIBED',
                  'Inactivity can be reported only while subscribed',
                );
              }
              await awaitCallback(
                () => request.handlers.onInactivity(createUtcTimestamp(this.#clock.now())),
                controller.signal,
              );
              break;
            }
            case 'error': {
              const failureEvent = step.error.retryable ? 'retryable_failure' : 'terminal_failure';
              state = transitionMarketDataConnection(state, failureEvent);
              await emitStatus(state);
              throw step.error;
            }
            case 'await_cancellation': {
              await cancellationPromise(controller.signal);
              break;
            }
          }
        }
        if (state !== 'stopped' && state !== 'terminal_failure') {
          state = transitionMarketDataConnection(state, 'stop');
          await emitStatus(state);
        }
      } catch (error) {
        if (error instanceof CancellationRequested) {
          if (state !== 'stopped') {
            state = transitionMarketDataConnection(state, 'stop');
            const status: MarketDataAdapterStatus = Object.freeze({
              state,
              occurredAt: createUtcTimestamp(this.#clock.now()),
            });
            await Promise.resolve(request.handlers.onStatus(status)).catch(() => undefined);
          }
          return;
        }
        throw error;
      } finally {
        externalSignal?.removeEventListener('abort', forwardCancellation);
      }
    };

    const done = run();
    let cancellation: Promise<void> | undefined;
    return Promise.resolve(
      Object.freeze({
        done,
        cancel: (): Promise<void> => {
          cancellation ??= (async (): Promise<void> => {
            controller.abort();
            await done;
          })();
          return cancellation;
        },
      }),
    );
  }
}
