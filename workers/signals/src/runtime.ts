import type { Clock } from '@daily-trader/domain';
import type { AppLogger, AppMeter } from '@daily-trader/observability';

import type { SignalsWorkerConfig } from './config.js';
import { SignalsWorkerError } from './errors.js';
import { SignalMetrics } from './metrics.js';
import type { LiveRunClaim, SignalsRepository } from './persistence/repository.js';
import { LiveJournalProcessor } from './processor.js';

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function abortRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Classifies an uncertain database outcome after a commit attempt failed at the
 * client boundary. A cursor exactly at the attempted revision proves that the
 * transaction committed; advancing beyond it would violate this worker's
 * serialized claim and must never be treated as success.
 */
export function classifyRevisionCommitOutcome(
  cursorPosition: string,
  revisionPosition: string,
): 'committed' | 'pending' {
  if (!/^(?:0|[1-9]\d*)$/u.test(cursorPosition) || !/^[1-9]\d*$/u.test(revisionPosition)) {
    throw new SignalsWorkerError('stored_data_invalid');
  }
  const cursor = BigInt(cursorPosition);
  const revision = BigInt(revisionPosition);
  if (cursor > revision) throw new SignalsWorkerError('cursor_conflict');
  return cursor === revision ? 'committed' : 'pending';
}

function retryDelay(
  attempt: number,
  retry: {
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitterPercent: number;
  },
): number {
  const exponential = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
  const signedStep = attempt % 2 === 0 ? retry.jitterPercent : -retry.jitterPercent;
  return Math.max(0, Math.floor((exponential * (100 + signedStep)) / 100));
}

async function processorFor(
  repository: SignalsRepository,
  claim: LiveRunClaim,
  clock: Clock,
  metrics: SignalMetrics,
): Promise<{
  readonly processor: LiveJournalProcessor;
  readonly settings: Awaited<ReturnType<SignalsRepository['loadRunSettings']>>;
}> {
  try {
    const state = await metrics.measureReconstruction(async () => {
      const settings = await repository.loadRunSettings(claim.runId);
      return {
        settings,
        processor: await LiveJournalProcessor.create({
          repository,
          configuration: settings.configuration,
          queueCapacity: settings.operational.queueCapacity,
          clock,
          claim,
          metrics,
        }),
      };
    });
    metrics.recordBoundary('reconstruction', 'succeeded');
    return state;
  } catch (error) {
    metrics.recordBoundary('reconstruction', 'failed');
    throw error;
  }
}

export interface SignalsRuntimeDependencies {
  readonly config: SignalsWorkerConfig;
  readonly repository: SignalsRepository;
  readonly clock: Clock;
  readonly logger: AppLogger;
  readonly meter: AppMeter;
}

export async function runDisabledSignalsRuntime(
  dependencies: SignalsRuntimeDependencies,
  signal: AbortSignal,
): Promise<void> {
  const metrics = new SignalMetrics(dependencies.meter);
  dependencies.meter.recordHealth('starting');
  metrics.recordLifecycle('starting');
  let claim: LiveRunClaim | null = null;
  try {
    claim = await dependencies.repository.disable(
      dependencies.clock,
      dependencies.config.signal.operational.claimLeaseMs,
    );
    while (claim !== null && !signal.aborted) {
      await drainClaim(dependencies, claim, signal);
      claim = await dependencies.repository.disable(
        dependencies.clock,
        dependencies.config.signal.operational.claimLeaseMs,
      );
    }
    if (signal.aborted) {
      dependencies.meter.recordHealth('stopping');
      metrics.recordLifecycle('stopping');
    } else {
      await dependencies.repository.heartbeat(claim, 'disabled', dependencies.clock);
      dependencies.meter.recordHealth('healthy');
      metrics.recordLifecycle('disabled');
      dependencies.logger.info('signals_worker.disabled');
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      dependencies.meter.recordHealth('stopping');
      metrics.recordLifecycle('stopping');
    }
    await dependencies.repository.heartbeat(claim, 'stopped', dependencies.clock);
    metrics.recordLifecycle('stopped');
    dependencies.logger.info('signals_worker.stopped');
  } catch (error) {
    dependencies.meter.recordHealth('unhealthy');
    const code = error instanceof SignalsWorkerError ? error.code : 'unexpected';
    metrics.recordLifecycle('failed');
    metrics.recordFailure(code);
    try {
      await dependencies.repository.fail(claim, code, dependencies.clock);
    } catch {
      // Preserve the original failure; an unavailable database cannot persist its own outage.
    }
    throw error;
  }
}

export async function drainClaim(
  dependencies: Omit<SignalsRuntimeDependencies, 'config'>,
  initialClaim: LiveRunClaim,
  signal: AbortSignal,
): Promise<void> {
  const metrics = new SignalMetrics(dependencies.meter);
  try {
    await metrics.measureDrain(async () => {
      let claim = initialClaim;
      let state = await processorFor(dependencies.repository, claim, dependencies.clock, metrics);
      while (!signal.aborted) {
        claim = state.processor.claim;
        const backlog = await dependencies.repository.refreshBacklog(
          claim,
          state.settings.operational.backlogLimit,
          dependencies.clock,
        );
        metrics.recordBacklog(Number(backlog));
        const revisions = await dependencies.repository.readRevisions(
          claim,
          state.settings.operational.claimBatchSize,
        );
        if (revisions.length === 0) {
          if (await dependencies.repository.completeIfDrained(claim, dependencies.clock)) return;
          await wait(
            Math.min(
              state.settings.operational.journalPollIntervalMs,
              state.settings.operational.claimRenewIntervalMs,
            ),
            signal,
          );
          continue;
        }
        for (const revision of revisions) {
          let attempt = 1;
          for (;;) {
            try {
              const evaluations = await state.processor.process(revision);
              metrics.recordRevisionAge(
                Math.max(
                  0,
                  Date.parse(dependencies.clock.now()) - Date.parse(revision.journaledAt),
                ),
              );
              for (const evaluation of evaluations) metrics.recordEvaluation(evaluation);
              break;
            } catch (error) {
              metrics.recordRetry(error instanceof SignalsWorkerError ? error.code : 'unexpected');
              if (attempt >= state.settings.operational.retry.maxAttempts) throw error;
              await wait(retryDelay(attempt, state.settings.operational.retry), signal);
              if (abortRequested(signal)) return;
              claim = await dependencies.repository.refreshClaim(state.processor.claim);
              state = await processorFor(
                dependencies.repository,
                claim,
                dependencies.clock,
                metrics,
              );
              if (
                classifyRevisionCommitOutcome(
                  claim.cursorPosition,
                  revision.revision.processingPosition,
                ) === 'committed'
              ) {
                metrics.recordCommitReconciled();
                break;
              }
              attempt += 1;
            }
          }
          if (abortRequested(signal)) return;
        }
      }
    });
    metrics.recordBoundary('drain', signal.aborted ? 'aborted' : 'succeeded');
  } catch (error) {
    metrics.recordBoundary('drain', 'failed');
    throw error;
  }
}

export async function runSignalsRuntime(
  dependencies: SignalsRuntimeDependencies,
  signal: AbortSignal,
): Promise<void> {
  const metrics = new SignalMetrics(dependencies.meter);
  dependencies.meter.recordHealth('starting');
  metrics.recordLifecycle('starting');
  let claim: LiveRunClaim | null = null;
  let failed = false;
  try {
    claim = await metrics.measureClaim(() =>
      dependencies.repository.enableOrResume(
        dependencies.config.signal.configuration,
        dependencies.config.signal.operational,
        dependencies.clock,
      ),
    );
    metrics.recordClaim(claim.state);
    dependencies.logger.info('signals_worker.run.claimed', {
      run_state: claim.state,
      source_kind: 'live_journal',
    });
    dependencies.meter.recordHealth('healthy');
    metrics.recordLifecycle('running');
    while (!signal.aborted) {
      await drainClaim(dependencies, claim, signal);
      if (abortRequested(signal)) break;
      claim = await metrics.measureClaim(() =>
        dependencies.repository.enableOrResume(
          dependencies.config.signal.configuration,
          dependencies.config.signal.operational,
          dependencies.clock,
        ),
      );
      metrics.recordClaim(claim.state);
    }
  } catch (error) {
    failed = true;
    dependencies.meter.recordHealth('unhealthy');
    const code = error instanceof SignalsWorkerError ? error.code : 'unexpected';
    metrics.recordLifecycle('failed');
    metrics.recordFailure(code);
    try {
      await dependencies.repository.fail(claim, code, dependencies.clock);
    } catch {
      // Preserve the original failure; an unavailable database cannot persist its own outage.
    }
    throw error;
  } finally {
    if (signal.aborted && !failed) {
      dependencies.meter.recordHealth('stopping');
      metrics.recordLifecycle('stopping');
      await dependencies.repository.heartbeat(claim, 'stopped', dependencies.clock);
      metrics.recordLifecycle('stopped');
    }
  }
}
