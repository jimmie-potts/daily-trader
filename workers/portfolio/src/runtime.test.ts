import { readFileSync } from 'node:fs';

import { loadConfig } from '@daily-trader/config';
import { FixedClock, createUtcTimestamp, type Clock } from '@daily-trader/domain';
import {
  createPortfolioRequestReceipt,
  fingerprintPortfolioSourceIdentifier,
  type PortfolioFingerprint,
  type PortfolioRequestReceipt,
  type PortfolioRequestResource,
  type PortfolioSyncSnapshot,
} from '@daily-trader/portfolio';
import type { AppLogger, AppMeter, LogFields, MetricAttributes } from '@daily-trader/observability';
import { describe, expect, it } from 'vitest';

import { projectPortfolioWorkerConfig, type PortfolioWorkerConfig } from './config.js';
import { PortfolioWorkerError } from './errors.js';
import type {
  CurrentPortfolioSnapshot,
  PortfolioLease,
  PortfolioSyncHandle,
} from './persistence/repository.js';
import { AlpacaPaperApiError } from './providers/alpaca/errors.js';
import { AlpacaPaperPortfolioProvider, type AlpacaFetch } from './providers/alpaca/index.js';
import type {
  PortfolioSnapshotCaptureRequest,
  PortfolioSnapshotProvider,
} from './providers/types.js';
import {
  runDisabledPortfolioRuntime,
  runPortfolioRuntime,
  type PortfolioRuntimeDependencies,
  type PortfolioRuntimeRepository,
} from './runtime.js';

const EXPECTED_ACCOUNT_ID = 'fixture-paper-account-id';
const NOW = createUtcTimestamp('2026-07-13T13:31:02.500Z');
const CLOCK = new FixedClock(NOW);

interface MetricObservation {
  readonly kind: 'counter' | 'gauge' | 'health' | 'histogram';
  readonly name: string;
  readonly value: number;
  readonly attributes?: MetricAttributes | undefined;
}

interface LogObservation {
  readonly level: 'debug' | 'error' | 'info' | 'warn';
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/alpaca/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
}

function response(payload: unknown, requestId: string): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  });
}

async function normalizedSnapshot(): Promise<PortfolioSyncSnapshot> {
  const fetch: AlpacaFetch = (input) => {
    const pathname = new URL(input).pathname;
    const resource = pathname.endsWith('/account/activities/FILL')
      ? 'fills'
      : pathname.endsWith('/account')
        ? 'account'
        : pathname.endsWith('/positions')
          ? 'positions'
          : 'orders';
    return Promise.resolve(response(fixture(resource), `runtime-${resource}-request`));
  };
  return new AlpacaPaperPortfolioProvider(
    {
      apiKey: 'runtime-fixture-key',
      apiSecret: 'runtime-fixture-secret',
      expectedAccountId: EXPECTED_ACCOUNT_ID,
    },
    { clock: CLOCK, fetch },
  ).capture({ previousActivityCutoverAt: null });
}

function config(retryMaxAttempts = 1): PortfolioWorkerConfig {
  return projectPortfolioWorkerConfig(
    loadConfig({
      APP_ENV: 'test',
      PAPER_BROKER_API_KEY: 'runtime-fixture-key',
      PAPER_BROKER_API_SECRET: 'runtime-fixture-secret',
      PAPER_BROKER_ACCOUNT_ID: EXPECTED_ACCOUNT_ID,
      PORTFOLIO_CLAIM_LEASE_MS: '5000',
      PORTFOLIO_CLAIM_RENEW_INTERVAL_MS: '1000',
      PORTFOLIO_MODE: 'paper_read_only',
      PORTFOLIO_RETRY_MAX_ATTEMPTS: String(retryMaxAttempts),
      PORTFOLIO_STALE_AFTER_MS: '10000',
      PORTFOLIO_SYNC_INTERVAL_MS: '5000',
    }),
  );
}

async function emitReceipt(
  request: PortfolioSnapshotCaptureRequest,
  resource: PortfolioRequestResource,
  pageOrdinal = 0,
): Promise<void> {
  await request.onRequestReceipt?.(
    createPortfolioRequestReceipt({
      requestFingerprint: fingerprintPortfolioSourceIdentifier(
        'request',
        `runtime-${resource}-${String(request.captureAttempt ?? 1)}-${String(pageOrdinal)}`,
      ),
      resource,
      captureAttempt: request.captureAttempt ?? 1,
      pageOrdinal,
      receivedAt: NOW,
      responseStatus: 200,
    }),
  );
}

async function emitCompleteReceipts(request: PortfolioSnapshotCaptureRequest): Promise<void> {
  for (const resource of ['account', 'positions', 'orders', 'fills'] as const) {
    await emitReceipt(request, resource);
  }
}

function recordingMeter(observations: MetricObservation[]): AppMeter {
  return {
    addCounter: (name, value = 1, attributes): void => {
      observations.push({ kind: 'counter', name, value, attributes });
    },
    recordGauge: (name, value, _unit, attributes): void => {
      observations.push({ kind: 'gauge', name, value, attributes });
    },
    recordHealth: (state): void => {
      observations.push({
        kind: 'health',
        name: 'daily_trader.process.health',
        value: 1,
        attributes: { state },
      });
    },
    recordHistogram: (name, value, _unit, attributes): void => {
      observations.push({ kind: 'histogram', name, value, attributes });
    },
  };
}

function logger(observations: LogObservation[] = []): AppLogger {
  return Object.freeze({
    debug: (event: string, fields?: LogFields): void => {
      observations.push({ level: 'debug', event, fields });
    },
    error: (event: string, fields?: LogFields): void => {
      observations.push({ level: 'error', event, fields });
    },
    info: (event: string, fields?: LogFields): void => {
      observations.push({ level: 'info', event, fields });
    },
    warn: (event: string, fields?: LogFields): void => {
      observations.push({ level: 'warn', event, fields });
    },
  });
}

class RecordingRepository implements PortfolioRuntimeRepository {
  public readonly completeInputs: Parameters<PortfolioRuntimeRepository['completeSync']>[0][] = [];
  public readonly failed: {
    readonly handle: PortfolioSyncHandle;
    readonly completedAt: string;
    readonly failureCode: string;
  }[] = [];
  public readonly releases: Parameters<PortfolioRuntimeRepository['releaseLease']>[0][] = [];
  public readonly receipts: {
    readonly handle: PortfolioSyncHandle;
    readonly receipt: PortfolioRequestReceipt;
  }[] = [];
  public beginCount = 0;
  public acquireFailure: PortfolioWorkerError | null = null;
  public completeFailure: PortfolioWorkerError | null = null;
  public previous: CurrentPortfolioSnapshot | null = null;

  public acquireLease(input: {
    readonly ownerId: string;
    readonly accountFingerprint: PortfolioFingerprint;
  }): Promise<PortfolioLease> {
    if (this.acquireFailure !== null) return Promise.reject(this.acquireFailure);
    return Promise.resolve(
      Object.freeze({
        ownerId: input.ownerId,
        accountFingerprint: input.accountFingerprint,
        fenceToken: '1',
      }),
    );
  }

  public renewLease(): Promise<void> {
    return Promise.resolve();
  }

  public beginSync(input: {
    readonly syncRunId: string;
    readonly lease: PortfolioLease;
    readonly captureStartedAt: string;
  }): Promise<PortfolioSyncHandle> {
    this.beginCount += 1;
    return Promise.resolve(Object.freeze(input) as PortfolioSyncHandle);
  }

  public readCurrentSnapshot(): Promise<CurrentPortfolioSnapshot | null> {
    return Promise.resolve(this.previous);
  }

  public recordRequestReceipt(
    handle: PortfolioSyncHandle,
    receipt: PortfolioRequestReceipt,
  ): Promise<void> {
    this.receipts.push({ handle, receipt });
    return Promise.resolve();
  }

  public completeSync(
    input: Parameters<PortfolioRuntimeRepository['completeSync']>[0],
  ): Promise<void> {
    if (this.completeFailure !== null) return Promise.reject(this.completeFailure);
    this.completeInputs.push(input);
    this.previous = Object.freeze({ syncRunId: input.handle.syncRunId, snapshot: input.snapshot });
    return Promise.resolve();
  }

  public failSync(
    handle: PortfolioSyncHandle,
    completedAt: string,
    failureCode: string,
  ): Promise<void> {
    this.failed.push({ handle, completedAt, failureCode });
    return Promise.resolve();
  }

  public releaseLease(
    input: Parameters<PortfolioRuntimeRepository['releaseLease']>[0],
  ): Promise<void> {
    this.releases.push(input);
    return Promise.resolve();
  }
}

function dependencies(input: {
  readonly provider: PortfolioSnapshotProvider;
  readonly repository: RecordingRepository;
  readonly observations: MetricObservation[];
  readonly appLogger?: AppLogger | undefined;
  readonly clock?: Clock | undefined;
  readonly delay?: ((milliseconds: number, signal: AbortSignal) => Promise<void>) | undefined;
  readonly retryMaxAttempts?: number | undefined;
}): PortfolioRuntimeDependencies {
  let run = 0;
  return {
    config: config(input.retryMaxAttempts),
    provider: input.provider,
    repository: input.repository,
    clock: input.clock ?? CLOCK,
    logger: input.appLogger ?? logger(),
    meter: recordingMeter(input.observations),
    ownerId: 'portfolio-runtime-test',
    createSyncRunId: (): string => `portfolio-sync-runtime-${String(++run)}`,
    random: (): number => 0.5,
    delay: input.delay ?? (() => Promise.resolve()),
  };
}

describe('portfolio runtime', () => {
  it('persists one complete cycle only after both reconciliation stages converge', async () => {
    const snapshot = await normalizedSnapshot();
    const controller = new AbortController();
    const requests: PortfolioSnapshotCaptureRequest[] = [];
    const provider: PortfolioSnapshotProvider = {
      capture: async (request) => {
        requests.push(request);
        await emitCompleteReceipts(request);
        controller.abort();
        return snapshot;
      },
    };
    const repository = new RecordingRepository();
    const observations: MetricObservation[] = [];

    await runPortfolioRuntime(
      dependencies({ provider, repository, observations }),
      controller.signal,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.previousActivityCutoverAt).toBeNull();
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(repository.failed).toEqual([]);
    expect(repository.completeInputs).toHaveLength(1);
    expect(repository.receipts.map(({ receipt }) => receipt.resource).sort()).toEqual([
      'account',
      'fills',
      'orders',
      'positions',
    ]);
    const completed = repository.completeInputs[0]!;
    expect(completed.projectionBasisReconciliation).toMatchObject({
      expectedPortfolioResultId: null,
      status: 'converged',
    });
    expect(completed.prepared.portfolioResultId).toBe(completed.projection.projectionId);
    expect(completed.reconciliation).toMatchObject({
      expectedPortfolioResultId: completed.projection.projectionId,
      status: 'converged',
    });
    expect(completed.delta.status).toBe('baseline');
    expect(repository.releases).toHaveLength(1);
    expect(repository.releases[0]?.lease.fenceToken).toBe('1');
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'daily_trader.portfolio.sync',
          attributes: { outcome: 'completed' },
        }),
        expect.objectContaining({
          name: 'daily_trader.process.health',
          attributes: { state: 'healthy' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.provider_captures',
          attributes: { outcome: 'succeeded' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.provider_capture_duration',
          attributes: { outcome: 'succeeded' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.reconciliation_state',
          attributes: { state: 'converged' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.sync.duration',
          attributes: { outcome: 'completed' },
        }),
      ]),
    );
    expect(
      observations
        .filter(({ name }) => name.endsWith('_pages'))
        .map(({ name }) => name)
        .sort(),
    ).toEqual([
      'daily_trader.portfolio.provider_account_pages',
      'daily_trader.portfolio.provider_fill_pages',
      'daily_trader.portfolio.provider_order_pages',
      'daily_trader.portfolio.provider_position_pages',
    ]);
    expect(
      observations
        .filter(({ name }) => name === 'daily_trader.portfolio.worker_lifecycle')
        .map(({ attributes }) => attributes?.state),
    ).toEqual(['starting', 'running', 'running', 'stopping', 'stopped']);
    expect(JSON.stringify(observations)).not.toMatch(/credential|fingerprint|secret/u);
  });

  it('retains the failed cycle and recovers on the next cycle after a transient failure', async () => {
    const snapshot = await normalizedSnapshot();
    const controller = new AbortController();
    let attempts = 0;
    const provider: PortfolioSnapshotProvider = {
      capture: async (request) => {
        attempts += 1;
        if (attempts === 1) {
          await emitReceipt(request, 'account');
          throw new AlpacaPaperApiError({
            classification: 'rate_limited',
            code: 'ALPACA_RATE_LIMITED',
          });
        }
        await emitCompleteReceipts(request);
        controller.abort();
        return snapshot;
      },
    };
    const repository = new RecordingRepository();
    const observations: MetricObservation[] = [];

    await runPortfolioRuntime(
      dependencies({ provider, repository, observations }),
      controller.signal,
    );

    expect(repository.beginCount).toBe(2);
    expect(repository.failed).toMatchObject([{ failureCode: 'provider_rate_limited' }]);
    expect(repository.receipts[0]).toMatchObject({
      handle: { syncRunId: 'portfolio-sync-runtime-1' },
      receipt: { captureAttempt: 1, resource: 'account' },
    });
    expect(
      repository.receipts.filter(({ handle }) => handle.syncRunId === 'portfolio-sync-runtime-2'),
    ).toHaveLength(4);
    expect(repository.completeInputs).toHaveLength(1);
    expect(repository.releases[0]).not.toHaveProperty('failureCode');
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'daily_trader.process.health',
          attributes: { state: 'unhealthy' },
        }),
        expect.objectContaining({
          name: 'daily_trader.process.health',
          attributes: { state: 'healthy' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.provider_captures',
          attributes: { outcome: 'rate_limited' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.rate_limits',
          attributes: { outcome: 'received' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.worker_lifecycle',
          attributes: { state: 'degraded' },
        }),
      ]),
    );
  });

  it('persists successful request receipts across bounded attempts in one pending cycle', async () => {
    const snapshot = await normalizedSnapshot();
    const controller = new AbortController();
    const attempts: number[] = [];
    const provider: PortfolioSnapshotProvider = {
      capture: async (request) => {
        attempts.push(request.captureAttempt ?? -1);
        if (request.captureAttempt === 1) {
          await emitReceipt(request, 'account');
          throw new AlpacaPaperApiError({
            classification: 'retryable_transport',
            code: 'ALPACA_TRANSPORT_FAILED',
          });
        }
        await emitCompleteReceipts(request);
        controller.abort();
        return snapshot;
      },
    };
    const repository = new RecordingRepository();
    const observations: MetricObservation[] = [];

    await runPortfolioRuntime(
      dependencies({
        provider,
        repository,
        observations,
        retryMaxAttempts: 2,
      }),
      controller.signal,
    );

    expect(attempts).toEqual([1, 2]);
    expect(repository.beginCount).toBe(1);
    expect(repository.failed).toEqual([]);
    expect(repository.receipts.map(({ receipt }) => receipt.captureAttempt)).toEqual([
      1, 2, 2, 2, 2,
    ]);
    expect(new Set(repository.receipts.map(({ handle }) => handle.syncRunId))).toEqual(
      new Set(['portfolio-sync-runtime-1']),
    );
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'daily_trader.portfolio.retries',
          attributes: { classification: 'retryable_transport', outcome: 'scheduled' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.provider_captures',
          attributes: { outcome: 'retryable_transport' },
        }),
      ]),
    );
  });

  it('records last-complete age and current staleness from the injected clock', async () => {
    const snapshot = await normalizedSnapshot();
    const observedAt = createUtcTimestamp('2026-07-13T13:31:22.500Z');
    const controller = new AbortController();
    const provider: PortfolioSnapshotProvider = {
      capture: async (request) => {
        await emitCompleteReceipts(request);
        controller.abort();
        return snapshot;
      },
    };
    const repository = new RecordingRepository();
    repository.previous = Object.freeze({
      syncRunId: 'portfolio-sync-prior',
      snapshot,
    });
    const observations: MetricObservation[] = [];

    await runPortfolioRuntime(
      dependencies({
        clock: new FixedClock(observedAt),
        provider,
        repository,
        observations,
      }),
      controller.signal,
    );

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'daily_trader.portfolio.last_complete_age',
          value: 20_000,
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.current_staleness',
          attributes: { state: 'stale' },
        }),
      ]),
    );
  });

  it('fails closed without another cycle after a fatal provider classification', async () => {
    const provider: PortfolioSnapshotProvider = {
      capture: () =>
        Promise.reject(
          new AlpacaPaperApiError({
            classification: 'authentication',
            code: 'ALPACA_AUTHENTICATION_FAILED',
          }),
        ),
    };
    const repository = new RecordingRepository();
    const observations: MetricObservation[] = [];
    const logs: LogObservation[] = [];
    const appLogger = logger(logs);

    await expect(
      runPortfolioRuntime(
        dependencies({ provider, repository, observations, appLogger }),
        new AbortController().signal,
      ),
    ).rejects.toEqual(
      new PortfolioWorkerError(
        'provider_authentication',
        'Paper provider authentication failed',
        false,
      ),
    );

    expect(repository.beginCount).toBe(1);
    expect(repository.completeInputs).toEqual([]);
    expect(repository.failed).toMatchObject([{ failureCode: 'provider_authentication' }]);
    expect(repository.releases).toMatchObject([{ failureCode: 'provider_authentication' }]);
    expect(logs).toContainEqual({
      level: 'error',
      event: 'portfolio_worker.sync.failed',
      fields: { code: 'provider_authentication' },
    });
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'daily_trader.portfolio.provider_captures',
          attributes: { outcome: 'authentication' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.worker_lifecycle',
          attributes: { state: 'failed' },
        }),
      ]),
    );
    expect(JSON.stringify(logs)).not.toMatch(/key|secret|response/u);
  });

  it('records a fenced synchronization lease loss without identifier labels', async () => {
    const snapshot = await normalizedSnapshot();
    const provider: PortfolioSnapshotProvider = {
      capture: async (request) => {
        await emitCompleteReceipts(request);
        return snapshot;
      },
    };
    const repository = new RecordingRepository();
    repository.completeFailure = new PortfolioWorkerError(
      'claim_lost',
      'Portfolio worker lease was lost',
      false,
    );
    const observations: MetricObservation[] = [];

    await expect(
      runPortfolioRuntime(
        dependencies({ provider, repository, observations }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'claim_lost' });

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'daily_trader.portfolio.lease_losses',
          attributes: { boundary: 'synchronization' },
        }),
        expect.objectContaining({
          name: 'daily_trader.portfolio.worker_lifecycle',
          attributes: { state: 'failed' },
        }),
      ]),
    );
    expect(JSON.stringify(observations.map(({ attributes }) => attributes))).not.toMatch(
      /account|fingerprint|owner|sync_run|symbol/u,
    );
  });

  it('keeps a database-failed candidate unpromoted and exposes a retryable safe outcome', async () => {
    const snapshot = await normalizedSnapshot();
    const controller = new AbortController();
    const provider: PortfolioSnapshotProvider = {
      capture: async (request) => {
        await emitCompleteReceipts(request);
        return snapshot;
      },
    };
    const repository = new RecordingRepository();
    repository.completeFailure = new PortfolioWorkerError(
      'database_unavailable',
      'Portfolio database operation failed',
      true,
    );
    const observations: MetricObservation[] = [];

    await expect(
      runPortfolioRuntime(
        dependencies({
          provider,
          repository,
          observations,
          delay: () => {
            controller.abort();
            return Promise.resolve();
          },
        }),
        controller.signal,
      ),
    ).resolves.toBeUndefined();

    expect(repository.completeInputs).toEqual([]);
    expect(repository.previous).toBeNull();
    expect(repository.failed).toMatchObject([{ failureCode: 'database_unavailable' }]);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'daily_trader.portfolio.sync',
          attributes: { outcome: 'database_unavailable' },
        }),
      ]),
    );
  });

  it('records an interrupted pending cycle but exits cleanly on shutdown', async () => {
    const controller = new AbortController();
    let captureStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      captureStarted = resolve;
    });
    const provider: PortfolioSnapshotProvider = {
      capture: ({ signal }) =>
        new Promise<PortfolioSyncSnapshot>((_resolve, reject) => {
          captureStarted?.();
          signal?.addEventListener(
            'abort',
            () => reject(new Error('transport details must remain private')),
            { once: true },
          );
        }),
    };
    const repository = new RecordingRepository();
    const observations: MetricObservation[] = [];
    const logs: LogObservation[] = [];
    const appLogger = logger(logs);
    const running = runPortfolioRuntime(
      dependencies({ provider, repository, observations, appLogger }),
      controller.signal,
    );

    await started;
    controller.abort();
    await expect(running).resolves.toBeUndefined();

    expect(repository.failed).toMatchObject([{ failureCode: 'shutdown_interrupted' }]);
    expect(repository.completeInputs).toEqual([]);
    expect(repository.releases[0]).not.toHaveProperty('failureCode');
    expect(JSON.stringify(logs)).not.toContain('transport details must remain private');
  });

  it('propagates a parent abort that occurs before deadline listener registration', async () => {
    const controller = new AbortController();
    const shutdownReason = new Error('test shutdown');
    const providerSignals: AbortSignal[] = [];
    const provider: PortfolioSnapshotProvider = {
      capture: ({ signal }) => {
        if (signal === undefined) return Promise.reject(new Error('missing provider signal'));
        providerSignals.push(signal);
        return Promise.reject(
          signal.reason instanceof Error ? signal.reason : new Error('missing abort reason'),
        );
      },
    };
    const repository = new RecordingRepository();
    const observations: MetricObservation[] = [];
    const runtimeDependencies = dependencies({ provider, repository, observations });
    Object.defineProperty(runtimeDependencies, 'provider', {
      configurable: true,
      get: (): PortfolioSnapshotProvider => {
        controller.abort(shutdownReason);
        return provider;
      },
    });

    await expect(
      runPortfolioRuntime(runtimeDependencies, controller.signal),
    ).resolves.toBeUndefined();

    expect(providerSignals).toHaveLength(1);
    expect(providerSignals[0]).toMatchObject({ aborted: true, reason: shutdownReason });
    expect(repository.failed).toMatchObject([{ failureCode: 'shutdown_interrupted' }]);
    expect(repository.completeInputs).toEqual([]);
  });

  it('keeps disabled mode side-effect free until shutdown', async () => {
    const controller = new AbortController();
    const observations: MetricObservation[] = [];
    const logs: LogObservation[] = [];
    const appLogger = logger(logs);
    const running = runDisabledPortfolioRuntime({
      logger: appLogger,
      meter: recordingMeter(observations),
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort();
    await expect(running).resolves.toBeUndefined();

    expect(logs).toContainEqual({
      level: 'info',
      event: 'portfolio_worker.disabled',
      fields: { executionEnabled: false, mode: 'disabled' },
    });
    expect(observations).toEqual([
      {
        kind: 'health',
        name: 'daily_trader.process.health',
        value: 1,
        attributes: { state: 'healthy' },
      },
      {
        kind: 'gauge',
        name: 'daily_trader.portfolio.worker_lifecycle',
        value: 1,
        attributes: { state: 'disabled' },
      },
      {
        kind: 'gauge',
        name: 'daily_trader.portfolio.worker_lifecycle',
        value: 1,
        attributes: { state: 'stopped' },
      },
    ]);
  });
});
