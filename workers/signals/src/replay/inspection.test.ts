import { describe, expect, it } from 'vitest';

import { renderReplayInspection } from './inspection.js';
import type {
  ReplayObservation,
  ReplayObservationInspection,
  ReplayTargetInspection,
} from './postgres-port.js';

const HASH = 'a'.repeat(64);

const TARGET: ReplayTargetInspection = Object.freeze({
  targetId: `signal-replay-${HASH}`,
  state: 'completed',
  cursor: '2',
  expectedCount: 2,
  failureCode: null,
  outputChecksum: HASH,
  outputPayload: 'raw-payload-must-not-render',
});

function observation(overrides: Partial<ReplayObservation> = {}): ReplayObservation {
  return Object.freeze({
    symbol: 'AAPL',
    venue: 'XNAS',
    definitionVersion: 'breakout_plus_volume.v1',
    configurationVersion: 'phase3-synthetic-replay-v1',
    configurationHash: HASH,
    evaluationBarStart: '2026-07-13T13:34:00.000Z',
    outcome: 'not_fired',
    reason: 'price_not_breakout',
    direction: null,
    observationAsOf: '2026-07-13T13:35:00.100Z',
    knowledgeAsOf: '2026-07-13T13:35:00.100Z',
    mode: 'on_time',
    closePrice: '104',
    breakoutReference: null,
    priorHigh: '105',
    priorLow: '100',
    currentVolume: '200',
    priorVolumeSum: '300',
    priorCount: 3,
    volumeMultiplier: '1.5',
    windowStart: '2026-07-13T13:31:00.000Z',
    windowEnd: '2026-07-13T13:33:00.000Z',
    invalidationCondition: null,
    sourceProvider: 'alpaca',
    sourceFeed: 'iex',
    sourceEntitlement: 'real_time',
    ...overrides,
  });
}

describe('renderReplayInspection', () => {
  it('renders exact ready evidence and omits absent comparison fields for suppression', () => {
    const suppressed = observation({
      symbol: 'SPY',
      venue: 'ARCX',
      outcome: 'suppressed',
      reason: 'insufficient_warmup',
      priorHigh: null,
      priorLow: null,
      priorVolumeSum: null,
      priorCount: null,
      volumeMultiplier: null,
      windowStart: null,
      windowEnd: null,
    });
    const fired = observation({
      outcome: 'fired',
      reason: 'upward_breakout_with_confirmed_volume',
      direction: 'upward',
      breakoutReference: '105',
      invalidationCondition:
        '{"kind":"close_returns_inside_prior_range","operator":"less_than_or_equal","reference":"105"}',
    });
    const inspection: ReplayObservationInspection = Object.freeze({
      target: TARGET,
      latest: Object.freeze([observation(), suppressed]),
      latestValidFired: Object.freeze([fired]),
    });

    const rendered = renderReplayInspection(inspection);
    expect(rendered).toContain('REPLAY SIGNAL OBSERVATIONS');
    expect(rendered).toContain('definition version: breakout_plus_volume.v1');
    expect(rendered).toContain('configuration version: phase3-synthetic-replay-v1');
    expect(rendered).toContain('prior high USD/share: 105');
    expect(rendered).toContain('prior low USD/share: 100');
    expect(rendered).toContain('prior volume sum shares: 300');
    expect(rendered).toContain('prior volume count: 3');
    expect(rendered).toContain('volume multiplier: 1.5');
    expect(rendered).toContain('latest valid historical fired replay observation');

    const suppressedSection = rendered
      .split('SPY/ARCX latest replay observation')[1]
      ?.split('AAPL/XNAS latest valid historical')[0];
    expect(suppressedSection).toBeDefined();
    expect(suppressedSection).not.toContain('prior high');
    expect(suppressedSection).not.toContain('prior low');
    expect(suppressedSection).not.toContain('prior volume');
    expect(suppressedSection).not.toContain('volume multiplier');
    expect(suppressedSection).not.toContain('window start');
    expect(suppressedSection).not.toContain('window end');
    expect(suppressedSection).not.toContain('breakout reference');
    expect(suppressedSection).not.toContain('direction');
    expect(suppressedSection).not.toContain('invalidation');
    expect(rendered).not.toContain('unavailable');
    expect(rendered).not.toContain(TARGET.outputPayload);
    expect(rendered).not.toContain('event ID');
    expect(rendered).not.toContain('evidence list');
  });

  it('makes a missing approved instrument explicit', () => {
    const rendered = renderReplayInspection({
      target: TARGET,
      latest: [observation()],
      latestValidFired: [],
    });
    expect(rendered).toContain('SPY/ARCX replay observation: warming-up or missing');
  });
});
