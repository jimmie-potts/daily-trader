import type { ApplicationConfig } from '@daily-trader/config';
import {
  FixedClock,
  createUtcTimestamp,
  type Clock,
  type UtcTimestamp,
} from '@daily-trader/domain';
import {
  MarketDataAdapterError,
  MarketEventOrderingTracker,
  serializeOneMinuteBarEvent,
  type GapState,
  type MarketDataConnectionState,
  type SupportedMarketDataSymbol,
} from '@daily-trader/market-data';
import type { AppLogger, AppMeter } from '@daily-trader/observability';

import {
  RedisDeliveryError,
  RedisMarketDataConsumer,
  RedisMarketDataPublisher,
  createRedisCommandClient,
} from './delivery/redis-stream.js';
import { MarketDataMetrics, type MarketDataFailureReason } from './metrics.js';
import {
  MarketDataPersistenceError,
  MarketDataRepository,
  createPgMarketDataPool,
  createRedisPersistenceHandler,
} from './persistence/index.js';
import { AlpacaMarketDataAdapter } from './providers/alpaca/adapter.js';
import { createNodeWebSocketFactory } from './providers/alpaca/node-websocket-factory.js';
import { buildMarketStatusModel, renderMarketStatus } from './status/index.js';
import { MarketDataStreamSupervisor } from './stream/supervisor.js';

export interface PaperMarketDataRuntimeDependencies {
  readonly clock: Clock;
  readonly config: ApplicationConfig;
  readonly logger: AppLogger;
  readonly meter: AppMeter;
}

function sessionId(timestamp: UtcTimestamp): string {
  return `paper-${timestamp.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForHeartbeat(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stopped);
      resolve(false);
    }, milliseconds);
    const stopped = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    signal.addEventListener('abort', stopped, { once: true });
  });
}

class RuntimeStopRequested extends Error {}

export function awaitUnlessRuntimeStopped<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new RuntimeStopRequested());
  }
  return new Promise<T>((resolve, reject) => {
    const stopped = (): void => reject(new RuntimeStopRequested());
    signal.addEventListener('abort', stopped, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', stopped);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stopped);
        reject(error instanceof Error ? error : new Error('Paper market-data operation failed'));
      },
    );
  });
}

export function awaitWithinRuntimeDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Paper market-data runtime shutdown deadline expired')),
      Math.max(1, milliseconds),
    );
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('Paper market-data operation failed'));
      },
    );
  });
}

export function preferRuntimeBoundaryFailure(
  translatedFailure: unknown,
  boundaryFailure: unknown,
): unknown {
  return boundaryFailure ?? translatedFailure;
}

export function runtimeFailureReason(error: unknown): MarketDataFailureReason | undefined {
  if (error instanceof RedisDeliveryError) return 'redis';
  if (error instanceof MarketDataPersistenceError) return 'database';
  if (!(error instanceof MarketDataAdapterError)) return undefined;
  if (error.code === 'ALPACA_BACKPRESSURE') return 'backpressure';
  if (error.code === 'ALPACA_TIMEOUT' || error.code === 'ALPACA_INACTIVITY_TIMEOUT') {
    return 'timeout';
  }
  switch (error.classification) {
    case 'authentication':
      return 'authentication';
    case 'contract':
      return 'contract';
    case 'entitlement':
      return 'entitlement';
    case 'malformed_data':
      return 'malformed';
    case 'retryable_transport':
      return 'transport';
    case 'unsupported_subscription':
      return 'unsupported';
  }
}

function overallGap(current: GapState, next: GapState): GapState {
  if (current === 'gapped' || next === 'gapped') return 'gapped';
  if (current === 'complete' || next === 'complete') return 'complete';
  return 'unknown';
}

function supportedSymbol(value: string): SupportedMarketDataSymbol {
  if (value === 'AAPL') return 'AAPL';
  if (value === 'SPY') return 'SPY';
  throw new Error('Validated market-data event contained an unsupported symbol');
}

/** Runs the complete paper market-data path. No brokerage or execution capability is present. */
export async function runPaperMarketDataRuntime(
  dependencies: PaperMarketDataRuntimeDependencies,
  signal: AbortSignal,
): Promise<void> {
  const config = dependencies.config.marketData;
  const apiKey = config.apiKey;
  const apiSecret = config.apiSecret;
  if (config.mode !== 'paper' || apiKey === undefined || apiSecret === undefined) {
    throw new Error('Paper market-data runtime requires validated paper feed configuration');
  }

  const metrics = new MarketDataMetrics(dependencies.meter);
  const publisherClient = createRedisCommandClient(
    dependencies.config.services.redis.url,
    dependencies.config.services.redis.connectionTimeoutMs,
    config.queueCapacity,
  );
  const consumerClient = createRedisCommandClient(
    dependencies.config.services.redis.url,
    dependencies.config.services.redis.connectionTimeoutMs,
    config.queueCapacity,
  );
  const publisher = new RedisMarketDataPublisher(publisherClient);
  const consumer = new RedisMarketDataConsumer(consumerClient, 'market-data-worker');
  const repository = new MarketDataRepository(
    createPgMarketDataPool({
      connectionString: dependencies.config.services.database.url,
      connectionTimeoutMs: dependencies.config.services.database.connectionTimeoutMs,
      statementTimeoutMs: Math.min(30_000, config.shutdownTimeoutMs),
      maximumConnections: 5,
    }),
    {
      freshnessThresholdMs: config.freshnessThresholdMs,
      writerCapabilityLeaseMs: dependencies.config.worker.heartbeatIntervalMs * 3,
      onCanonicalRevisionTiming: (timing): void => {
        metrics.recordCanonicalRevisionTiming(timing);
      },
    },
  );
  const providerController = new AbortController();
  const consumerController = new AbortController();
  let shutdownDeadline: number | undefined;
  const beginShutdown = (): number => {
    shutdownDeadline ??= performance.now() + config.shutdownTimeoutMs;
    return shutdownDeadline;
  };
  const stopProvider = (): void => {
    beginShutdown();
    providerController.abort();
  };
  signal.addEventListener('abort', stopProvider, { once: true });
  if (signal.aborted) stopProvider();

  const ingestionSessionId = sessionId(createUtcTimestamp(dependencies.clock.now()));
  const ordering = new MarketEventOrderingTracker({
    freshnessThresholdMs: config.freshnessThresholdMs,
  });
  let pendingPublishedEntries = 0;
  let connectionState: MarketDataConnectionState = 'connecting';
  let lastSuccessfulEvent: UtcTimestamp | undefined;
  let freshnessNotBefore: UtcTimestamp | undefined;
  let gap: GapState = 'unknown';
  let deliveryHealth: 'healthy' | 'unavailable' = 'healthy';
  let persistenceHealth: 'healthy' | 'unavailable' = 'healthy';
  const lifecycle = { consumerFailed: false, reconnecting: false };
  let sessionOpened = false;
  let statusTimer: NodeJS.Timeout | undefined;
  let statusPromise: Promise<void> | undefined;

  const renderStatus = async (): Promise<void> => {
    const observedAt = createUtcTimestamp(dependencies.clock.now());
    try {
      const latest = await repository.findLatestBars(observedAt);
      const latestBySymbol = Object.fromEntries(
        latest.map((item) => [item.event.instrument.symbol, item.event]),
      );
      const model = buildMarketStatusModel({
        repository: {
          latest: {
            AAPL: latestBySymbol.AAPL,
            SPY: latestBySymbol.SPY,
          },
          redisDelivery: deliveryHealth,
          postgresPersistence: persistenceHealth,
        },
        connection: connectionState,
        lastSuccessfulEvent,
        gap,
        clock: new FixedClock(observedAt),
        freshnessThresholdMs: config.freshnessThresholdMs,
        ...(freshnessNotBefore === undefined ? {} : { freshnessNotBefore }),
      });
      for (const row of model.rows) {
        metrics.recordFreshness(row.symbol, row.freshness);
        if (row.state === 'present') {
          metrics.recordLastEventAge(row.symbol, row.ageMilliseconds);
        }
      }
      process.stdout.write(`${renderMarketStatus(model)}\n`);
    } catch {
      persistenceHealth = 'unavailable';
      metrics.recordFailure('database');
      dependencies.logger.error('market_data.status.failed', { code: 'STATUS_QUERY_FAILED' });
    }
  };

  const requestStatus = (): Promise<void> => {
    statusPromise ??= renderStatus().finally(() => {
      statusPromise = undefined;
    });
    return statusPromise;
  };

  let runtimeError: unknown;
  let runtimeBoundaryError: unknown;
  let consumerPromise: Promise<void> | undefined;
  let supervisorPromise: Promise<void> | undefined;
  let capabilityPromise: Promise<void> | undefined;
  try {
    await awaitUnlessRuntimeStopped(publisher.connect(), signal);
    await awaitUnlessRuntimeStopped(consumer.connect(), signal);
    await awaitUnlessRuntimeStopped(
      repository.createIngestionSession({
        sessionId: ingestionSessionId,
        mode: 'paper',
        configurationVersion: 'phase-2-v1',
        startedAt: createUtcTimestamp(dependencies.clock.now()),
      }),
      signal,
    );
    sessionOpened = true;
    capabilityPromise = (async (): Promise<void> => {
      while (!providerController.signal.aborted) {
        const stopped = await waitForHeartbeat(
          dependencies.config.worker.heartbeatIntervalMs,
          providerController.signal,
        );
        if (stopped) return;
        await repository.renewWriterCapability(ingestionSessionId);
      }
    })().catch((error: unknown) => {
      runtimeBoundaryError ??= error;
      stopProvider();
      throw error;
    });

    const persistenceHandler = createRedisPersistenceHandler(repository);
    consumerPromise = consumer
      .run(consumerController.signal, async (entry): Promise<void> => {
        const started = performance.now();
        try {
          await persistenceHandler(entry);
          if (entry.sessionId === ingestionSessionId && pendingPublishedEntries > 0) {
            pendingPublishedEntries -= 1;
          }
          persistenceHealth = 'healthy';
          metrics.recordBoundaryResult('postgres', 'succeeded');
        } catch (error) {
          persistenceHealth = 'unavailable';
          metrics.recordBoundaryResult('postgres', 'failed');
          throw error;
        } finally {
          metrics.recordBoundaryLatency('postgres', performance.now() - started);
        }
      })
      .catch((error: unknown) => {
        lifecycle.consumerFailed = true;
        runtimeBoundaryError ??= error;
        stopProvider();
        throw error;
      });

    const supervisor = new MarketDataStreamSupervisor({
      adapterFactory: () =>
        new AlpacaMarketDataAdapter(
          {
            apiKey,
            apiSecret,
            connectionTimeoutMs: config.connectionTimeoutMs,
            inactivityTimeoutMs: config.inactivityTimeoutMs,
            queueCapacity: config.queueCapacity,
            shutdownTimeoutMs: config.shutdownTimeoutMs,
            url: config.websocketUrl,
          },
          { clock: dependencies.clock, webSocketFactory: createNodeWebSocketFactory() },
        ),
      clock: dependencies.clock,
      handlers: {
        onEvent: async (event): Promise<void> => {
          const classification = ordering.classify(event, event.receivedAt);
          lastSuccessfulEvent = event.receivedAt;
          gap = overallGap(gap, classification.gap.state);
          metrics.recordArrival(classification.classification);
          const symbol = supportedSymbol(event.instrument.symbol);
          metrics.recordGap(
            symbol,
            classification.gap.state,
            classification.gap.missingIntervalCount,
          );
          const started = performance.now();
          if (pendingPublishedEntries >= config.queueCapacity) {
            const error = new RedisDeliveryError('publish_failed');
            runtimeBoundaryError ??= error;
            throw error;
          }
          pendingPublishedEntries += 1;
          let published = false;
          try {
            await publisher.publish(ingestionSessionId, {
              schemaVersion: event.schemaVersion,
              eventId: event.eventId,
              orderingKey: event.orderingKey,
              canonicalJson: serializeOneMinuteBarEvent(event),
            });
            published = true;
            deliveryHealth = 'healthy';
            metrics.recordBoundaryResult('redis', 'succeeded');
          } catch (error) {
            if (!published) {
              pendingPublishedEntries -= 1;
            }
            runtimeBoundaryError ??= error;
            deliveryHealth = 'unavailable';
            metrics.recordBoundaryResult('redis', 'failed');
            throw error;
          } finally {
            metrics.recordBoundaryLatency('redis', performance.now() - started);
          }
        },
        onInactivity: (occurredAt): void => {
          metrics.recordFailure('timeout');
          dependencies.logger.warn('market_data.provider.inactive', { occurredAt });
        },
        onStatus: (status): void => {
          connectionState = status.state;
          metrics.recordConnectionState(status.state);
          if (status.state === 'reconnecting') {
            lifecycle.reconnecting = true;
            freshnessNotBefore = status.occurredAt;
            metrics.recordReconnect('attempt');
          }
          if (status.state === 'terminal_failure') metrics.recordReconnect('exhausted');
          if (status.state === 'subscribed' && lifecycle.reconnecting) {
            lifecycle.reconnecting = false;
            metrics.recordReconnect('succeeded');
          }
          dependencies.logger.info('market_data.provider.status', {
            state: status.state,
            occurredAt: status.occurredAt,
            provider: config.provider,
            feed: config.feed,
          });
        },
      },
      jitter: { sample: () => Math.random() },
      reconnectPolicy: {
        baseDelayMs: config.reconnect.baseDelayMs,
        maximumDelayMs: config.reconnect.maxDelayMs,
        maximumAttempts: config.reconnect.maxAttempts,
        jitterRatio: config.reconnect.jitterPercent / 100,
      },
    });

    statusTimer = setInterval(
      () => void requestStatus(),
      dependencies.config.worker.heartbeatIntervalMs,
    );
    await awaitUnlessRuntimeStopped(requestStatus(), signal);
    supervisorPromise = supervisor.run(providerController.signal);
    await awaitUnlessRuntimeStopped(
      Promise.race([supervisorPromise, consumerPromise, capabilityPromise]),
      signal,
    );
  } catch (error) {
    if (!(error instanceof RuntimeStopRequested && signal.aborted)) {
      runtimeError = preferRuntimeBoundaryFailure(error, runtimeBoundaryError);
      const reason = runtimeFailureReason(runtimeError);
      if (reason !== undefined) metrics.recordFailure(reason);
    }
  } finally {
    beginShutdown();
    const remainingShutdownMs = (): number =>
      Math.max(1, Math.floor((shutdownDeadline ?? performance.now()) - performance.now()));
    let forceRepositoryPromise: Promise<void> | undefined;
    const repositoryShutdown = { forced: false };
    const forceRepository = (): Promise<void> => {
      repositoryShutdown.forced = true;
      forceRepositoryPromise ??= repository.forceClose();
      return forceRepositoryPromise;
    };
    const destroyRedisClient = (client: { destroy(): void }): void => {
      try {
        client.destroy();
      } catch {
        // A client that already completed graceful close needs no further action.
      }
    };
    const captureShutdown = async (
      operation: Promise<unknown> | undefined,
      onFailure?: () => void,
    ): Promise<void> => {
      if (operation === undefined) return;
      try {
        await awaitWithinRuntimeDeadline(operation, remainingShutdownMs());
      } catch (error) {
        runtimeError ??= error;
        onFailure?.();
      }
    };

    if (statusTimer !== undefined) clearInterval(statusTimer);
    providerController.abort();
    await captureShutdown(supervisorPromise);
    await captureShutdown(capabilityPromise);

    await captureShutdown(publisher.close(), () => destroyRedisClient(publisherClient));
    destroyRedisClient(publisherClient);

    const drainDeadline = performance.now() + Math.floor(remainingShutdownMs() / 2);
    while (
      !lifecycle.consumerFailed &&
      pendingPublishedEntries > 0 &&
      performance.now() < drainDeadline
    ) {
      await delay(Math.max(1, Math.min(25, Math.floor(drainDeadline - performance.now()))));
    }
    const drained = pendingPublishedEntries === 0;
    consumerController.abort();
    await captureShutdown(consumerPromise, () => {
      destroyRedisClient(consumerClient);
      void forceRepository().catch(() => undefined);
    });
    await captureShutdown(consumer.close(), () => destroyRedisClient(consumerClient));
    destroyRedisClient(consumerClient);
    await captureShutdown(statusPromise, () => {
      void forceRepository().catch(() => undefined);
    });

    if (sessionOpened && drained && !lifecycle.consumerFailed && !repositoryShutdown.forced) {
      await captureShutdown(
        repository.closeIngestionSession(
          ingestionSessionId,
          createUtcTimestamp(dependencies.clock.now()),
        ),
      );
    } else if (sessionOpened) {
      dependencies.logger.warn('market_data.session.left_open', {
        code: 'BOUNDED_DRAIN_INCOMPLETE',
      });
    }
    if (!repositoryShutdown.forced) {
      await captureShutdown(repository.close(), () => {
        void forceRepository().catch(() => undefined);
      });
    }
    await captureShutdown(forceRepositoryPromise);
    signal.removeEventListener('abort', stopProvider);
  }

  if (runtimeError !== undefined) {
    throw runtimeError instanceof Error
      ? runtimeError
      : new Error('The paper market-data runtime failed');
  }
}
