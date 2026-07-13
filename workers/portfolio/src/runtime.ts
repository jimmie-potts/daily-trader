import type { Clock, UtcTimestamp } from '@daily-trader/domain';
import {
  classifyPortfolioSnapshotDelta,
  fingerprintPortfolioSourceIdentifier,
  preparePortfolioProjection,
  projectPortfolioSnapshot,
  reconcilePortfolioProjection,
  type PortfolioRequestReceipt,
  type PortfolioFingerprint,
  type PortfolioSyncSnapshot,
} from '@daily-trader/portfolio';
import type { AppLogger, AppMeter } from '@daily-trader/observability';

import type { PortfolioWorkerConfig } from './config.js';
import { PortfolioWorkerError, type PortfolioWorkerErrorCode } from './errors.js';
import type {
  CurrentPortfolioSnapshot,
  PortfolioLease,
  PortfolioSyncHandle,
} from './persistence/repository.js';
import type { PortfolioSnapshotProvider } from './providers/types.js';
import { AlpacaPaperApiError } from './providers/alpaca/errors.js';
import { abortableDelay, withPortfolioRetry } from './retry.js';

export interface PortfolioRuntimeRepository {
  acquireLease(input: {
    readonly ownerId: string;
    readonly accountFingerprint: PortfolioFingerprint;
    readonly now: UtcTimestamp;
    readonly leaseMs: number;
  }): Promise<PortfolioLease>;
  renewLease(lease: PortfolioLease, now: UtcTimestamp, leaseMs: number): Promise<void>;
  beginSync(input: {
    readonly syncRunId: string;
    readonly lease: PortfolioLease;
    readonly captureStartedAt: UtcTimestamp;
  }): Promise<PortfolioSyncHandle>;
  recordRequestReceipt(
    handle: PortfolioSyncHandle,
    receipt: PortfolioRequestReceipt,
  ): Promise<void>;
  readCurrentSnapshot(): Promise<CurrentPortfolioSnapshot | null>;
  completeSync(input: {
    readonly handle: PortfolioSyncHandle;
    readonly finalCaptureAttempt: number;
    readonly snapshot: PortfolioSyncSnapshot;
    readonly previousSyncRunId: string | null;
    readonly prepared: ReturnType<typeof preparePortfolioProjection>;
    readonly projectionBasisReconciliation: ReturnType<typeof reconcilePortfolioProjection>;
    readonly reconciliation: ReturnType<typeof reconcilePortfolioProjection>;
    readonly delta: ReturnType<typeof classifyPortfolioSnapshotDelta>;
    readonly projection: ReturnType<typeof projectPortfolioSnapshot>;
  }): Promise<void>;
  failSync(
    handle: PortfolioSyncHandle,
    completedAt: UtcTimestamp,
    failureCode: string,
  ): Promise<void>;
  releaseLease(input: {
    readonly lease: PortfolioLease;
    readonly now: UtcTimestamp;
    readonly failureCode?: string;
  }): Promise<void>;
}

export interface PortfolioRuntimeDependencies {
  readonly config: PortfolioWorkerConfig;
  readonly provider: PortfolioSnapshotProvider;
  readonly repository: PortfolioRuntimeRepository;
  readonly clock: Clock;
  readonly logger: AppLogger;
  readonly meter: AppMeter;
  readonly ownerId: string;
  readonly createSyncRunId: () => string;
  readonly random?: () => number;
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

type PortfolioLifecycle =
  'degraded' | 'disabled' | 'failed' | 'running' | 'starting' | 'stopped' | 'stopping';

type LeaseLossBoundary = 'acquire' | 'release' | 'renewal' | 'synchronization';

function recordLifecycle(meter: AppMeter, state: PortfolioLifecycle): void {
  meter.recordGauge(
    'daily_trader.portfolio.worker_lifecycle',
    1,
    '1',
    { state },
    'Current bounded portfolio-worker lifecycle state.',
  );
}

function recordLeaseLoss(
  meter: AppMeter,
  failure: PortfolioWorkerError,
  boundary: LeaseLossBoundary,
): void {
  if (failure.code !== 'claim_lost') return;
  meter.addCounter(
    'daily_trader.portfolio.lease_losses',
    1,
    { boundary },
    'Fenced portfolio lease losses by fixed runtime boundary.',
  );
}

function providerCaptureOutcome(error: unknown): string {
  if (error instanceof AlpacaPaperApiError) return error.classification;
  if (error instanceof PortfolioWorkerError) return error.code;
  return 'unexpected';
}

function providerPageMetricName(resource: PortfolioRequestReceipt['resource']): string {
  switch (resource) {
    case 'account':
      return 'daily_trader.portfolio.provider_account_pages';
    case 'fills':
      return 'daily_trader.portfolio.provider_fill_pages';
    case 'orders':
      return 'daily_trader.portfolio.provider_order_pages';
    case 'positions':
      return 'daily_trader.portfolio.provider_position_pages';
  }
}

function recordCurrentSnapshotFreshness(
  meter: AppMeter,
  snapshot: PortfolioSyncSnapshot,
  observedAt: UtcTimestamp,
  staleAfterMs: number,
): void {
  const signedAgeMs =
    Date.parse(observedAt) - Date.parse(snapshot.knowledgeInterval.captureCompletedAt);
  const ageMs = Math.max(0, signedAgeMs);
  const state = signedAgeMs < 0 ? 'future' : ageMs > staleAfterMs ? 'stale' : 'current';
  meter.recordGauge(
    'daily_trader.portfolio.last_complete_age',
    ageMs,
    'ms',
    {},
    'Age of the last complete selected portfolio snapshot.',
  );
  meter.recordGauge(
    'daily_trader.portfolio.current_staleness',
    1,
    '1',
    { state },
    'Current bounded portfolio snapshot staleness classification.',
  );
}

function recordReconciliationState(
  meter: AppMeter,
  state: ReturnType<typeof reconcilePortfolioProjection>['status'],
): void {
  meter.recordGauge(
    'daily_trader.portfolio.reconciliation_state',
    1,
    '1',
    { state },
    'Current projection-integrity reconciliation state.',
  );
}

function translateFailure(error: unknown, shutdown: boolean): PortfolioWorkerError {
  if (error instanceof PortfolioWorkerError) return error;
  if (shutdown) {
    return new PortfolioWorkerError(
      'shutdown_interrupted',
      'Portfolio synchronization was interrupted by shutdown',
      false,
    );
  }
  if (error instanceof AlpacaPaperApiError) {
    switch (error.classification) {
      case 'account_mismatch':
        return new PortfolioWorkerError('account_mismatch', 'Paper account did not match', false);
      case 'authentication':
        return new PortfolioWorkerError(
          'provider_authentication',
          'Paper provider authentication failed',
          false,
        );
      case 'authorization':
        return new PortfolioWorkerError(
          'provider_authorization',
          'Paper provider authorization failed',
          false,
        );
      case 'rate_limited':
        return new PortfolioWorkerError(
          'provider_rate_limited',
          'Paper provider rate limited synchronization',
          true,
        );
      case 'retryable_transport':
      case 'cancelled':
        return new PortfolioWorkerError(
          'provider_transport',
          'Paper provider transport failed',
          true,
        );
      case 'resource_limit':
        return new PortfolioWorkerError(
          'provider_capacity',
          'Paper provider response exceeded a configured bound',
          false,
        );
      case 'invalid_request':
      case 'malformed_response':
      case 'redirect_rejected':
        return new PortfolioWorkerError(
          'provider_malformed_data',
          'Paper provider response was rejected',
          false,
        );
    }
  }
  return new PortfolioWorkerError('sync_failed', 'Portfolio synchronization failed', false);
}

function retryDecision(error: unknown): {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
} {
  if (error instanceof AlpacaPaperApiError) {
    const retryable =
      error.classification === 'rate_limited' || error.classification === 'retryable_transport';
    return Object.freeze({
      retryable,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    });
  }
  return Object.freeze({ retryable: false });
}

async function captureWithinDeadline(input: {
  readonly provider: PortfolioSnapshotProvider;
  readonly captureAttempt: number;
  readonly onRequestReceipt: (receipt: PortfolioRequestReceipt) => Promise<void>;
  readonly previousActivityCutoverAt: UtcTimestamp | null;
  readonly parentSignal: AbortSignal;
  readonly timeoutMs: number;
}): Promise<PortfolioSyncSnapshot> {
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(input.parentSignal.reason);
  if (input.parentSignal.aborted) abortFromParent();
  else input.parentSignal.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('portfolio request deadline')),
    input.timeoutMs,
  );
  try {
    return await input.provider.capture({
      previousActivityCutoverAt: input.previousActivityCutoverAt,
      captureAttempt: input.captureAttempt,
      onRequestReceipt: input.onRequestReceipt,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !input.parentSignal.aborted) {
      throw new AlpacaPaperApiError({
        classification: 'retryable_transport',
        code: 'ALPACA_REQUEST_TIMEOUT',
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.parentSignal.removeEventListener('abort', abortFromParent);
  }
}

function intervalMilliseconds(start: UtcTimestamp, end: UtcTimestamp): number {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function synchronizeOnce(
  dependencies: PortfolioRuntimeDependencies,
  lease: PortfolioLease,
  signal: AbortSignal,
): Promise<void> {
  const captureStartedAt = dependencies.clock.now();
  let cycleOutcome: string = 'completed';
  const handle = await dependencies.repository.beginSync({
    syncRunId: dependencies.createSyncRunId(),
    lease,
    captureStartedAt,
  });
  try {
    const previous = await dependencies.repository.readCurrentSnapshot();
    if (previous !== null) {
      recordCurrentSnapshotFreshness(
        dependencies.meter,
        previous.snapshot,
        dependencies.clock.now(),
        dependencies.config.portfolio.operational.staleAfterMs,
      );
    }
    let retryClassification = 'unexpected';
    const captured = await withPortfolioRetry({
      policy: dependencies.config.portfolio.operational.retry,
      signal,
      operation: async (attempt) => {
        const attemptStartedAt = dependencies.clock.now();
        let outcome = 'succeeded';
        try {
          return {
            captureAttempt: attempt,
            snapshot: await captureWithinDeadline({
              provider: dependencies.provider,
              captureAttempt: attempt,
              onRequestReceipt: async (receipt) => {
                await dependencies.repository.recordRequestReceipt(handle, receipt);
                dependencies.meter.addCounter(
                  providerPageMetricName(receipt.resource),
                  1,
                  { outcome: 'received' },
                  'Successful provider page receipts for one fixed resource.',
                );
              },
              previousActivityCutoverAt: previous?.snapshot.coverage.activityCutoverAt ?? null,
              parentSignal: signal,
              timeoutMs: dependencies.config.portfolio.operational.requestTimeoutMs,
            }),
          };
        } catch (error) {
          outcome = providerCaptureOutcome(error);
          throw error;
        } finally {
          dependencies.meter.addCounter(
            'daily_trader.portfolio.provider_captures',
            1,
            { outcome },
            'Provider capture attempts by bounded outcome.',
          );
          dependencies.meter.recordHistogram(
            'daily_trader.portfolio.provider_capture_duration',
            intervalMilliseconds(attemptStartedAt, dependencies.clock.now()),
            'ms',
            { outcome },
            'Provider capture attempt duration by bounded outcome.',
          );
        }
      },
      classify: (error) => {
        const decision = retryDecision(error);
        retryClassification = providerCaptureOutcome(error);
        if (error instanceof AlpacaPaperApiError && error.classification === 'rate_limited') {
          dependencies.meter.addCounter(
            'daily_trader.portfolio.rate_limits',
            1,
            { outcome: 'received' },
            'Provider rate-limit responses received by the portfolio worker.',
          );
        }
        return decision;
      },
      dependencies: {
        random: dependencies.random ?? Math.random,
        delay: dependencies.delay ?? abortableDelay,
        onRetry: ({ attempt, delayMs }) => {
          dependencies.meter.addCounter(
            'daily_trader.portfolio.retries',
            1,
            { classification: retryClassification, outcome: 'scheduled' },
            'Scheduled provider retries by bounded failure classification.',
          );
          dependencies.logger.warn('portfolio_worker.sync.retry', { attempt, delayMs });
        },
      },
    });
    const { captureAttempt: finalCaptureAttempt, snapshot } = captured;
    const structuralPrepared = preparePortfolioProjection(snapshot, null);
    const projectionBasisReconciliation = reconcilePortfolioProjection(
      snapshot,
      structuralPrepared,
      null,
    );
    if (projectionBasisReconciliation.status !== 'converged') {
      recordReconciliationState(dependencies.meter, projectionBasisReconciliation.status);
      throw new PortfolioWorkerError(
        'projection_failed',
        'Portfolio projection integrity did not converge',
        false,
      );
    }
    const projection = projectPortfolioSnapshot(snapshot, projectionBasisReconciliation);
    const prepared = preparePortfolioProjection(snapshot, projection.projectionId);
    const reconciliation = reconcilePortfolioProjection(
      snapshot,
      prepared,
      projection.projectionId,
    );
    recordReconciliationState(dependencies.meter, reconciliation.status);
    if (reconciliation.status !== 'converged') {
      throw new PortfolioWorkerError(
        'projection_failed',
        'Final portfolio result integrity did not converge',
        false,
      );
    }
    const delta = classifyPortfolioSnapshotDelta(previous?.snapshot ?? null, snapshot);
    await dependencies.repository.completeSync({
      handle,
      finalCaptureAttempt,
      snapshot,
      previousSyncRunId: previous?.syncRunId ?? null,
      prepared,
      projectionBasisReconciliation,
      reconciliation,
      delta,
      projection,
    });
    dependencies.meter.addCounter('daily_trader.portfolio.sync', 1, { outcome: 'completed' });
    dependencies.meter.recordHistogram(
      'daily_trader.portfolio.knowledge_interval.width',
      intervalMilliseconds(
        snapshot.knowledgeInterval.captureStartedAt,
        snapshot.knowledgeInterval.captureCompletedAt,
      ),
      'ms',
    );
    dependencies.meter.recordGauge(
      'daily_trader.portfolio.positions',
      snapshot.positions.length,
      '1',
      { support: 'all' },
    );
    dependencies.logger.info('portfolio_worker.sync.completed', {
      changeState: delta.status,
      fillCount: snapshot.fills.length,
      orderCount: snapshot.orders.length,
      positionCount: snapshot.positions.length,
      projectionState: projection.state,
      reconciliationState: reconciliation.status,
    });
  } catch (error) {
    const failure = translateFailure(error, signal.aborted);
    cycleOutcome = failure.code;
    dependencies.meter.addCounter('daily_trader.portfolio.sync', 1, {
      outcome: failure.code,
    });
    try {
      await dependencies.repository.failSync(handle, dependencies.clock.now(), failure.code);
    } catch (persistenceError) {
      if (
        persistenceError instanceof PortfolioWorkerError &&
        persistenceError.code === 'claim_lost'
      ) {
        throw persistenceError;
      }
      dependencies.logger.error('portfolio_worker.sync.failure_persistence_failed', {
        code: 'SYNC_FAILURE_PERSIST_FAILED',
      });
    }
    throw failure;
  } finally {
    dependencies.meter.recordHistogram(
      'daily_trader.portfolio.sync.duration',
      intervalMilliseconds(captureStartedAt, dependencies.clock.now()),
      'ms',
      { outcome: cycleOutcome },
      'Complete portfolio synchronization-cycle duration by bounded outcome.',
    );
  }
}

/** Runs the single-account, read-only synchronization loop under one fenced lease. */
export async function runPortfolioRuntime(
  dependencies: PortfolioRuntimeDependencies,
  signal: AbortSignal,
): Promise<void> {
  const expectedAccountId = dependencies.config.portfolio.expectedAccountId;
  if (dependencies.config.portfolio.mode !== 'paper_read_only' || expectedAccountId === undefined) {
    throw new PortfolioWorkerError('sync_failed', 'Portfolio runtime is not enabled', false);
  }
  recordLifecycle(dependencies.meter, 'starting');
  const accountFingerprint = fingerprintPortfolioSourceIdentifier('account', expectedAccountId);
  let lease: PortfolioLease;
  try {
    lease = await dependencies.repository.acquireLease({
      ownerId: dependencies.ownerId,
      accountFingerprint,
      now: dependencies.clock.now(),
      leaseMs: dependencies.config.portfolio.operational.claimLeaseMs,
    });
  } catch (error) {
    const failure = translateFailure(error, signal.aborted);
    recordLeaseLoss(dependencies.meter, failure, 'acquire');
    recordLifecycle(dependencies.meter, 'failed');
    throw failure;
  }
  let fatalCode: PortfolioWorkerErrorCode | undefined;
  let renewalFailure: PortfolioWorkerError | undefined;
  let renewalChain = Promise.resolve();
  const renewalTimer = setInterval(() => {
    renewalChain = renewalChain
      .then(async () =>
        dependencies.repository.renewLease(
          lease,
          dependencies.clock.now(),
          dependencies.config.portfolio.operational.claimLeaseMs,
        ),
      )
      .catch((error: unknown) => {
        const failure = translateFailure(error, signal.aborted);
        renewalFailure = failure;
        recordLeaseLoss(dependencies.meter, failure, 'renewal');
      });
  }, dependencies.config.portfolio.operational.claimRenewIntervalMs);

  dependencies.meter.recordHealth('starting');
  recordLifecycle(dependencies.meter, 'running');
  try {
    while (!isAborted(signal)) {
      if (renewalFailure !== undefined) {
        fatalCode = renewalFailure.code;
        recordLifecycle(dependencies.meter, 'failed');
        throw renewalFailure;
      }
      try {
        await synchronizeOnce(dependencies, lease, signal);
        dependencies.meter.recordHealth('healthy');
        recordLifecycle(dependencies.meter, 'running');
      } catch (error) {
        const failure = translateFailure(error, signal.aborted);
        if (isAborted(signal)) break;
        recordLeaseLoss(dependencies.meter, failure, 'synchronization');
        dependencies.meter.recordHealth('unhealthy');
        dependencies.logger.error('portfolio_worker.sync.failed', { code: failure.code });
        if (!failure.retryable) {
          fatalCode = failure.code;
          recordLifecycle(dependencies.meter, 'failed');
          throw failure;
        }
        recordLifecycle(dependencies.meter, 'degraded');
      }
      await (dependencies.delay ?? abortableDelay)(
        dependencies.config.portfolio.operational.syncIntervalMs,
        signal,
      ).catch((error: unknown) => {
        if (!signal.aborted) throw error;
      });
    }
  } finally {
    clearInterval(renewalTimer);
    await renewalChain;
    dependencies.meter.recordHealth('stopping');
    recordLifecycle(dependencies.meter, 'stopping');
    try {
      await dependencies.repository.releaseLease({
        lease,
        now: dependencies.clock.now(),
        ...(fatalCode === undefined ? {} : { failureCode: fatalCode }),
      });
    } catch (error) {
      const failure = translateFailure(error, signal.aborted);
      recordLeaseLoss(dependencies.meter, failure, 'release');
      recordLifecycle(dependencies.meter, 'failed');
      throw failure;
    }
    recordLifecycle(dependencies.meter, fatalCode === undefined ? 'stopped' : 'failed');
  }
}

/** Disabled mode deliberately waits without constructing a database or provider adapter. */
export async function runDisabledPortfolioRuntime(input: {
  readonly logger: AppLogger;
  readonly meter: AppMeter;
  readonly signal: AbortSignal;
}): Promise<void> {
  input.meter.recordHealth('healthy');
  recordLifecycle(input.meter, 'disabled');
  input.logger.info('portfolio_worker.disabled', {
    executionEnabled: false,
    mode: 'disabled',
  });
  if (input.signal.aborted) return;
  await new Promise<void>((resolve) =>
    input.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
  recordLifecycle(input.meter, 'stopped');
}
