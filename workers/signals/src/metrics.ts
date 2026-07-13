import { performance } from 'node:perf_hooks';

import type { AppMeter } from '@daily-trader/observability';
import type { FeatureSuppressionReason, SignalEvaluation } from '@daily-trader/signals';

import type { SignalsWorkerErrorCode } from './errors.js';
import type { LiveRunClaim } from './persistence/repository.js';

export type SignalWorkerLifecycle =
  'disabled' | 'failed' | 'running' | 'starting' | 'stopped' | 'stopping';

export type SignalFailureReason = SignalsWorkerErrorCode | 'unexpected';
export type SignalCapacityBoundary = 'evaluation_queue' | 'feature_state';
export type SignalBoundary = 'drain' | 'reconstruction';
export type SignalBoundaryResult = 'aborted' | 'failed' | 'succeeded';

export interface MonotonicClock {
  now(): number;
}

const SYSTEM_MONOTONIC_CLOCK: MonotonicClock = Object.freeze({
  now: () => performance.now(),
});

function nonnegativeFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a nonnegative finite number`);
  }
  return value;
}

function nonnegativeCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a nonnegative safe integer`);
  }
  return value;
}

/** Bounded signal-worker metrics without run, event, session, or evidence identifiers. */
export class SignalMetrics {
  readonly #meter: AppMeter;
  readonly #monotonicClock: MonotonicClock;

  public constructor(meter: AppMeter, monotonicClock: MonotonicClock = SYSTEM_MONOTONIC_CLOCK) {
    this.#meter = meter;
    this.#monotonicClock = monotonicClock;
  }

  public recordLifecycle(state: SignalWorkerLifecycle): void {
    this.#meter.recordGauge(
      'daily_trader.signal.worker_lifecycle',
      1,
      '1',
      { state },
      'Current bounded signal-worker lifecycle state.',
    );
  }

  public recordEvaluation(evaluation: SignalEvaluation): void {
    this.#meter.addCounter(
      'daily_trader.signal.evaluations',
      1,
      { outcome: evaluation.outcome, version: evaluation.definitionVersion },
      'Persisted signal evaluations by fixed outcome and definition version.',
    );
    if (evaluation.outcome === 'suppressed') this.recordSuppression(evaluation.reason);
    if (evaluation.featureResult.mode === 'retrospective') this.recordRetrospective();
  }

  public recordSuppression(reason: FeatureSuppressionReason): void {
    this.#meter.addCounter(
      'daily_trader.signal.suppressions',
      1,
      { reason },
      'Signal suppressions by fixed deterministic reason.',
    );
  }

  public recordBacklog(count: number): void {
    const bounded = nonnegativeCount(count, 'backlog count');
    this.#meter.recordGauge(
      'daily_trader.signal.revision_backlog',
      bounded,
      '1',
      {},
      'Run-owned canonical revisions not yet durably processed.',
    );
    this.#meter.recordGauge(
      'daily_trader.signal.cursor_lag',
      bounded,
      '1',
      {},
      'Canonical revision positions between the durable cursor and owned watermark.',
    );
  }

  public recordRevisionAge(ageMs: number): void {
    this.#meter.recordHistogram(
      'daily_trader.signal.revision_age',
      nonnegativeFinite(ageMs, 'revision age'),
      'ms',
      {},
      'Business-time age of a committed revision when processing completes.',
    );
  }

  public recordRetry(reason: SignalFailureReason): void {
    this.#meter.addCounter(
      'daily_trader.signal.retries',
      1,
      { reason },
      'Bounded signal revision retry reasons.',
    );
  }

  public recordRetrospective(): void {
    this.#meter.addCounter(
      'daily_trader.signal.retrospective_evaluations',
      1,
      {},
      'Persisted retrospective signal evaluations.',
    );
  }

  public recordCapacity(
    boundary: SignalCapacityBoundary,
    state: 'exceeded' | 'within_limit',
  ): void {
    this.#meter.recordGauge(
      'daily_trader.signal.capacity_state',
      1,
      '1',
      { boundary, state },
      'Bounded in-memory signal capacity state.',
    );
  }

  public recordFailure(reason: SignalFailureReason): void {
    this.#meter.addCounter(
      'daily_trader.signal.failures',
      1,
      { reason },
      'Terminal signal-worker failures by bounded application classification.',
    );
    this.#meter.recordGauge(
      'daily_trader.signal.failure_state',
      1,
      '1',
      { reason },
      'Current bounded signal-worker failure classification.',
    );
  }

  public recordClaim(state: LiveRunClaim['state']): void {
    this.#meter.addCounter(
      'daily_trader.signal.claims',
      1,
      { state },
      'Durable signal-run claims by bounded run state.',
    );
  }

  public recordBoundary(boundary: SignalBoundary, result: SignalBoundaryResult): void {
    this.#meter.addCounter(
      'daily_trader.signal.boundary_results',
      1,
      { boundary, result },
      'Signal reconstruction and drain outcomes.',
    );
  }

  public recordCommitReconciled(): void {
    this.#meter.addCounter(
      'daily_trader.signal.commit_reconciled',
      1,
      {},
      'Uncertain commit attempts proven durable from the run cursor.',
    );
  }

  public measureFeature<T>(work: () => T): T {
    return this.#measure(
      'daily_trader.signal.feature_latency',
      'Feature computation latency.',
      work,
    );
  }

  public measureEvaluation<T>(work: () => T): T {
    return this.#measure(
      'daily_trader.signal.evaluation_latency',
      'Deterministic signal evaluation latency.',
      work,
    );
  }

  public measureClaim<T>(work: () => Promise<T>): Promise<T> {
    return this.#measureAsync(
      'daily_trader.signal.claim_latency',
      'Durable run-claim latency.',
      work,
    );
  }

  public measureReconstruction<T>(work: () => Promise<T>): Promise<T> {
    return this.#measureAsync(
      'daily_trader.signal.reconstruction_latency',
      'Durable signal-state reconstruction latency.',
      work,
    );
  }

  public measureDrain<T>(work: () => Promise<T>): Promise<T> {
    return this.#measureAsync(
      'daily_trader.signal.drain_latency',
      'Finite run-drain latency.',
      work,
    );
  }

  #recordLatency(name: string, description: string, startedAt: number): void {
    const durationMs = Math.max(0, this.#monotonicClock.now() - startedAt);
    this.#meter.recordHistogram(
      name,
      nonnegativeFinite(durationMs, 'duration'),
      'ms',
      {},
      description,
    );
  }

  #measure<T>(name: string, description: string, work: () => T): T {
    const startedAt = this.#monotonicClock.now();
    try {
      return work();
    } finally {
      this.#recordLatency(name, description, startedAt);
    }
  }

  async #measureAsync<T>(name: string, description: string, work: () => Promise<T>): Promise<T> {
    const startedAt = this.#monotonicClock.now();
    try {
      return await work();
    } finally {
      this.#recordLatency(name, description, startedAt);
    }
  }
}
