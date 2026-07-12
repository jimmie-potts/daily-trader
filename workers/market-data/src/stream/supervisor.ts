import { createUtcTimestamp, type Clock } from '@daily-trader/domain';
import {
  MarketDataAdapterError,
  calculateReconnectDecision,
  createPhase2MarketDataSubscription,
  type MarketDataAdapter,
  type MarketDataAdapterConnection,
  type MarketDataAdapterHandlers,
  type ReconnectPolicy,
} from '@daily-trader/market-data';

export interface RetrySleeper {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface JitterSource {
  sample(): number;
}

export interface MarketDataStreamSupervisorDependencies {
  readonly adapterFactory: () => MarketDataAdapter;
  readonly clock: Clock;
  readonly handlers: MarketDataAdapterHandlers;
  readonly jitter: JitterSource;
  readonly reconnectPolicy: ReconnectPolicy;
  readonly sleeper?: RetrySleeper;
}

class SleepCancelled extends Error {}

const systemSleeper: RetrySleeper = Object.freeze({
  wait: (milliseconds: number, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new SleepCancelled());
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, milliseconds);
      const cancel = (): void => {
        clearTimeout(timer);
        reject(new SleepCancelled());
      };
      signal.addEventListener('abort', cancel, { once: true });
    }),
});

function retryableFailure(error: unknown): MarketDataAdapterError {
  if (error instanceof MarketDataAdapterError) {
    return error;
  }
  return new MarketDataAdapterError(
    'contract',
    'ADAPTER_UNCLASSIFIED_FAILURE',
    'The market-data adapter returned an unclassified failure',
  );
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Owns bounded reconnects while each adapter instance owns one socket session. */
export class MarketDataStreamSupervisor {
  readonly #dependencies: MarketDataStreamSupervisorDependencies;
  readonly #controller = new AbortController();
  #connection: MarketDataAdapterConnection | undefined;
  #runPromise: Promise<void> | undefined;

  public constructor(dependencies: MarketDataStreamSupervisorDependencies) {
    this.#dependencies = dependencies;
  }

  public run(externalSignal?: AbortSignal): Promise<void> {
    if (this.#runPromise !== undefined) {
      return this.#runPromise;
    }
    const forwardAbort = (): void => this.#controller.abort();
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    if (externalSignal?.aborted === true) {
      forwardAbort();
    }

    this.#runPromise = this.runLoop().finally(() => {
      externalSignal?.removeEventListener('abort', forwardAbort);
    });
    return this.#runPromise;
  }

  public async stop(): Promise<void> {
    this.#controller.abort();
    await this.#connection?.cancel().catch(() => undefined);
    await this.#runPromise;
  }

  private async runLoop(): Promise<void> {
    let attempt = 0;
    const signal = this.#controller.signal;
    const handlers: MarketDataAdapterHandlers = {
      onEvent: async (event): Promise<void> => {
        attempt = 0;
        await this.#dependencies.handlers.onEvent(event);
      },
      onInactivity: (occurredAt) => this.#dependencies.handlers.onInactivity(occurredAt),
      onStatus: (status) => this.#dependencies.handlers.onStatus(status),
    };

    while (!signal.aborted) {
      try {
        this.#connection = await this.#dependencies.adapterFactory().connect({
          subscription: createPhase2MarketDataSubscription(),
          handlers,
          signal,
        });
        await this.#connection.done;
        this.#connection = undefined;
        if (isAborted(signal)) {
          return;
        }
        throw new MarketDataAdapterError(
          'retryable_transport',
          'ADAPTER_STOPPED_UNEXPECTEDLY',
          'The market-data adapter stopped unexpectedly',
        );
      } catch (error) {
        this.#connection = undefined;
        if (isAborted(signal)) {
          return;
        }
        const failure = retryableFailure(error);
        if (!failure.retryable) {
          throw failure;
        }

        attempt += 1;
        const decision = calculateReconnectDecision(
          attempt,
          this.#dependencies.reconnectPolicy,
          this.#dependencies.jitter.sample(),
        );
        if (decision.kind === 'exhausted') {
          await this.#dependencies.handlers.onStatus(
            Object.freeze({
              state: 'terminal_failure',
              occurredAt: createUtcTimestamp(this.#dependencies.clock.now()),
            }),
          );
          throw new MarketDataAdapterError(
            'retryable_transport',
            'RECONNECT_ATTEMPTS_EXHAUSTED',
            'Market-data reconnect attempts were exhausted',
          );
        }
        try {
          await (this.#dependencies.sleeper ?? systemSleeper).wait(decision.delayMs, signal);
        } catch (sleepError) {
          if (isAborted(signal) || sleepError instanceof SleepCancelled) {
            return;
          }
          throw new MarketDataAdapterError(
            'contract',
            'RECONNECT_SLEEP_FAILED',
            'The reconnect scheduler failed',
          );
        }
      }
    }
  }
}
