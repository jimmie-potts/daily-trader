import type { AppMeter, MetricAttributes } from '@daily-trader/observability';
import type { SignalEvaluation } from '@daily-trader/signals';
import { describe, expect, it } from 'vitest';

import { SignalMetrics, type MonotonicClock } from './metrics.js';

interface MetricObservation {
  readonly kind: 'counter' | 'gauge' | 'health' | 'histogram';
  readonly name: string;
  readonly value: number;
  readonly unit?: string | undefined;
  readonly attributes?: MetricAttributes | undefined;
}

function recordingMeter(observations: MetricObservation[]): AppMeter {
  return {
    addCounter: (name, value = 1, attributes): void => {
      observations.push({ kind: 'counter', name, value, attributes });
    },
    recordGauge: (name, value, unit, attributes): void => {
      observations.push({ kind: 'gauge', name, value, unit, attributes });
    },
    recordHealth: (state): void => {
      observations.push({
        kind: 'health',
        name: 'daily_trader.process.health',
        value: 1,
        attributes: { state },
      });
    },
    recordHistogram: (name, value, unit, attributes): void => {
      observations.push({ kind: 'histogram', name, value, unit, attributes });
    },
  };
}

class SequenceClock implements MonotonicClock {
  public constructor(private readonly values: number[]) {}

  public now(): number {
    const value = this.values.shift();
    if (value === undefined) throw new TypeError('monotonic test clock exhausted');
    return value;
  }
}

function suppressedRetrospectiveEvaluation(): SignalEvaluation {
  return {
    outcome: 'suppressed',
    reason: 'missing_interval',
    definitionVersion: 'breakout_plus_volume.v1',
    featureResult: { mode: 'retrospective' },
  } as SignalEvaluation;
}

describe('SignalMetrics', () => {
  it('uses only fixed signal classifications and identifier-free attributes', () => {
    const observations: MetricObservation[] = [];
    const metrics = new SignalMetrics(recordingMeter(observations));

    metrics.recordLifecycle('running');
    metrics.recordEvaluation(suppressedRetrospectiveEvaluation());
    metrics.recordBacklog(7);
    metrics.recordRevisionAge(125);
    metrics.recordRetry('cursor_conflict');
    metrics.recordCapacity('feature_state', 'within_limit');
    metrics.recordCapacity('evaluation_queue', 'exceeded');
    metrics.recordFailure('capacity_exceeded');
    metrics.recordClaim('closing');
    metrics.recordBoundary('reconstruction', 'succeeded');
    metrics.recordBoundary('drain', 'aborted');
    metrics.recordCommitReconciled();

    expect(observations.map(({ name }) => name)).toEqual([
      'daily_trader.signal.worker_lifecycle',
      'daily_trader.signal.evaluations',
      'daily_trader.signal.suppressions',
      'daily_trader.signal.retrospective_evaluations',
      'daily_trader.signal.revision_backlog',
      'daily_trader.signal.cursor_lag',
      'daily_trader.signal.revision_age',
      'daily_trader.signal.retries',
      'daily_trader.signal.capacity_state',
      'daily_trader.signal.capacity_state',
      'daily_trader.signal.failures',
      'daily_trader.signal.failure_state',
      'daily_trader.signal.claims',
      'daily_trader.signal.boundary_results',
      'daily_trader.signal.boundary_results',
      'daily_trader.signal.commit_reconciled',
    ]);
    expect(observations[1]?.attributes).toEqual({
      outcome: 'suppressed',
      version: 'breakout_plus_volume.v1',
    });
    expect(observations[2]?.attributes).toEqual({ reason: 'missing_interval' });
    expect(JSON.stringify(observations)).not.toMatch(
      /account|event_id|evidence|instrument|order|run_id|session_id|symbol|token/u,
    );
  });

  it('records operational latency exclusively from an injected monotonic clock', async () => {
    const observations: MetricObservation[] = [];
    const metrics = new SignalMetrics(
      recordingMeter(observations),
      new SequenceClock([0, 4, 10, 17, 20, 29, 30, 42, 50, 65]),
    );

    expect(metrics.measureFeature(() => 'feature')).toBe('feature');
    expect(metrics.measureEvaluation(() => 'evaluation')).toBe('evaluation');
    await expect(metrics.measureClaim(() => Promise.resolve('claim'))).resolves.toBe('claim');
    await expect(metrics.measureReconstruction(() => Promise.resolve('state'))).resolves.toBe(
      'state',
    );
    await expect(metrics.measureDrain(() => Promise.resolve('drained'))).resolves.toBe('drained');

    expect(observations.map(({ name, value, unit }) => ({ name, value, unit }))).toEqual([
      { name: 'daily_trader.signal.feature_latency', value: 4, unit: 'ms' },
      { name: 'daily_trader.signal.evaluation_latency', value: 7, unit: 'ms' },
      { name: 'daily_trader.signal.claim_latency', value: 9, unit: 'ms' },
      { name: 'daily_trader.signal.reconstruction_latency', value: 12, unit: 'ms' },
      { name: 'daily_trader.signal.drain_latency', value: 15, unit: 'ms' },
    ]);
  });

  it('records failed work latency and rejects invalid counts', () => {
    const observations: MetricObservation[] = [];
    const metrics = new SignalMetrics(recordingMeter(observations), new SequenceClock([100, 103]));

    expect(() =>
      metrics.measureFeature(() => {
        throw new Error('bounded test failure');
      }),
    ).toThrowError('bounded test failure');
    expect(observations).toMatchObject([
      { name: 'daily_trader.signal.feature_latency', value: 3, unit: 'ms' },
    ]);
    expect(() => metrics.recordBacklog(Number.MAX_SAFE_INTEGER + 1)).toThrowError(TypeError);
    expect(() => metrics.recordRevisionAge(-1)).toThrowError(TypeError);
  });
});
