import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import {
  PHASE_2_INSTRUMENTS,
  addUtcMilliseconds,
  createOneMinuteBarEvent,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import { describe, expect, it } from 'vitest';

import type {
  PersistedSignalStatus,
  SignalStatusEvaluation,
  SignalStatusMarketData,
} from './persistence/repository.js';
import { renderSignalStatus } from './status.js';

const OBSERVED_AT = createUtcTimestamp('2026-07-13T14:00:00.000Z');

function marketBar(
  symbol: 'AAPL' | 'SPY',
  barStart: string,
  receivedAt?: string,
): OneMinuteBarEvent {
  const start = createUtcTimestamp(barStart);
  const received = receivedAt ?? addUtcMilliseconds(start, 65_000);
  return createOneMinuteBarEvent({
    symbol,
    venue: PHASE_2_INSTRUMENTS[symbol].venue,
    providerTimestamp: start,
    receivedAt: received,
    processedAt: received,
    open: symbol === 'AAPL' ? '199.5' : '599.5',
    high: symbol === 'AAPL' ? '201' : '601',
    low: symbol === 'AAPL' ? '199' : '599',
    close: symbol === 'AAPL' ? '200.5' : '600.5',
    volume: symbol === 'AAPL' ? '1500' : '2500',
  });
}

function marketData(
  symbol: 'AAPL' | 'SPY',
  barStart: string,
  receivedAt?: string,
  freshnessThresholdMs = 120_000,
): SignalStatusMarketData {
  return Object.freeze({
    event: marketBar(symbol, barStart, receivedAt),
    freshnessThresholdMs,
  });
}

const SEMANTICS = Object.freeze({
  definitionVersion: 'breakout_plus_volume.v1',
  configurationVersion: 'phase3-v1',
  configurationHash: 'a'.repeat(64),
  arithmeticPolicyVersion: 'daily-trader.signals.arithmetic.bigjs.v1',
  calendarVersion: 'nyse-core-2026-2028.v1',
  marketEventSchemaVersion: 'daily-trader.market-data.one-minute-bar.v1',
  revisionSchemaVersion: 'daily-trader.market-data.canonical-revision.v1',
  featureSchemaVersion: 'daily-trader.signals.feature-result.v1',
  evaluationSchemaVersion: 'daily-trader.signals.evaluation.v1',
  dataQualityPolicyVersion: 'daily-trader.market-data.quality.v1',
  freshnessThresholdMs: 120_000,
  lookbackBars: 20,
  volumeMultiplier: '1.5',
});

function readyEvaluation(overrides: Partial<SignalStatusEvaluation> = {}): SignalStatusEvaluation {
  return {
    symbol: 'AAPL',
    venue: 'XNAS',
    evaluationBarStart: createUtcTimestamp('2026-07-13T13:58:00.000Z'),
    outcome: 'not_fired',
    reason: 'conditions_not_met',
    direction: null,
    observationAsOf: createUtcTimestamp('2026-07-13T13:59:05.000Z'),
    knowledgeAsOf: createUtcTimestamp('2026-07-13T13:59:05.000Z'),
    mode: 'on_time',
    sourceProvider: 'alpaca',
    sourceFeed: 'iex',
    sourceEntitlement: 'real_time',
    closePrice: '200.5',
    breakoutReference: null,
    priorHigh: '201.125',
    priorLow: '198.875',
    currentVolume: '1500',
    priorVolumeSum: '20000',
    priorCount: 20,
    volumeMultiplier: '1.5',
    windowStart: createUtcTimestamp('2026-07-13T13:38:00.000Z'),
    windowEnd: createUtcTimestamp('2026-07-13T13:57:00.000Z'),
    invalidationCondition: null,
    ...overrides,
  };
}

function statusFixture(overrides: Partial<PersistedSignalStatus> = {}): PersistedSignalStatus {
  return {
    lifecycle: 'running',
    runId: 'live-test',
    runState: 'active',
    cursorPosition: '9223372036854775800',
    stopPosition: null,
    backlogCount: '2',
    revisionGapDetected: false,
    heartbeatAt: createUtcTimestamp('2026-07-13T13:59:30.000Z'),
    lastEvaluatedBarStart: createUtcTimestamp('2026-07-13T13:58:00.000Z'),
    failureCode: null,
    semantics: SEMANTICS,
    latestMarketData: {
      AAPL: marketData('AAPL', '2026-07-13T13:58:00.000Z'),
      SPY: marketData('SPY', '2026-07-13T13:58:00.000Z'),
    },
    latest: [],
    latestValidFired: [],
    ...overrides,
  };
}

function marketSection(output: string, symbol: 'AAPL' | 'SPY'): string {
  const start = output.indexOf(`${symbol}/${PHASE_2_INSTRUMENTS[symbol].venue} market data`);
  if (start < 0) throw new TypeError(`missing ${symbol} market section`);
  const end = output.indexOf('\n\n', start);
  return output.slice(start, end < 0 ? undefined : end);
}

describe('renderSignalStatus', () => {
  it('separates worker processing lag, heartbeat freshness, market freshness, and input eligibility', () => {
    const evaluation = readyEvaluation({
      outcome: 'fired',
      reason: 'upward_breakout_with_confirmed_volume',
      direction: 'upward',
      breakoutReference: '201.125',
      invalidationCondition: '{"kind":"close_returns_inside_prior_range"}',
    });
    const latestMarketData = statusFixture().latestMarketData;
    const output = renderSignalStatus(
      statusFixture({
        backlogCount: '5',
        heartbeatAt: createUtcTimestamp('2026-07-13T13:55:00.000Z'),
        latest: [evaluation],
      }),
      new FixedClock(OBSERVED_AT),
      60_000,
    );

    expect(output).toContain('LIVE SIGNAL OBSERVATIONS — not recommendations or position actions');
    expect(output).toContain('worker processing lag: 5 pending canonical revisions');
    expect(output).toContain('worker heartbeat freshness: stale');
    expect(output).toContain('market-data freshness: fresh');
    expect(output).toContain('signal input eligibility: on-time eligible');
    expect(output).toContain('AAPL/XNAS — IEX single-exchange observation');
    expect(output).toContain('prior high USD/share: 201.125');
    expect(output).toContain('prior low USD/share: 198.875');
    expect(output).toContain('breakout reference USD/share: 201.125');
    expect(output).not.toContain(latestMarketData.AAPL?.event.eventId);
    expect(output).not.toContain(latestMarketData.SPY?.event.eventId);
    expect(output).not.toContain('buy');
    expect(output).not.toContain('position state');
  });

  it('shows the exact prior range for a ready non-fire without fired-only fields', () => {
    const output = renderSignalStatus(
      statusFixture({ latest: [readyEvaluation()] }),
      new FixedClock(OBSERVED_AT),
    );

    expect(output).toContain('outcome: not_fired');
    expect(output).toContain('prior high USD/share: 201.125');
    expect(output).toContain('prior low USD/share: 198.875');
    expect(output).toContain('prior volume sum shares: 20000');
    expect(output).toContain('prior volume count: 20');
    expect(output).toContain('window start: 2026-07-13T13:38:00.000Z');
    expect(output).not.toContain('\ndirection:');
    expect(output).not.toContain('\ninvalidation:');
    expect(output).not.toContain('\nbreakout reference USD/share:');
  });

  it('omits unavailable comparison and window evidence for a suppressed result', () => {
    const suppressed = readyEvaluation({
      outcome: 'suppressed',
      reason: 'missing_interval',
      priorHigh: null,
      priorLow: null,
      priorVolumeSum: null,
      priorCount: null,
      volumeMultiplier: null,
      windowStart: null,
      windowEnd: null,
    });
    const output = renderSignalStatus(
      statusFixture({ latest: [suppressed] }),
      new FixedClock(OBSERVED_AT),
    );

    expect(output).toContain('outcome: suppressed');
    expect(output).toContain('reason: missing_interval');
    expect(output).toContain('close USD/share: 200.5');
    expect(output).toContain('current volume shares: 1500');
    expect(output).not.toContain('\nprior high USD/share:');
    expect(output).not.toContain('\nprior low USD/share:');
    expect(output).not.toContain('\nprior volume sum shares:');
    expect(output).not.toContain('\nprior volume count:');
    expect(output).not.toContain('\nvolume multiplier:');
    expect(output).not.toContain('\nwindow start:');
    expect(output).not.toContain('\nwindow end:');
  });

  it('shows missing and partial current market data without zero-fill or event identifiers', () => {
    const AAPL = marketData('AAPL', '2026-07-13T13:58:00.000Z');
    const output = renderSignalStatus(
      statusFixture({ latestMarketData: { AAPL, SPY: undefined } }),
      new FixedClock(OBSERVED_AT),
    );

    expect(marketSection(output, 'AAPL')).toContain(
      'latest canonical bar end: 2026-07-13T13:59:00.000Z',
    );
    expect(marketSection(output, 'AAPL')).toContain('market-data freshness: fresh');
    expect(marketSection(output, 'SPY')).toContain('latest canonical bar end: missing');
    expect(marketSection(output, 'SPY')).toContain('market-data freshness: no_data');
    expect(output).not.toContain(AAPL.event.eventId);
    expect(output).not.toContain('bar end: 0');
  });

  it('classifies each canonical bar with its own persisted freshness threshold', () => {
    const output = renderSignalStatus(
      statusFixture({
        latestMarketData: {
          AAPL: marketData('AAPL', '2026-07-13T13:56:00.000Z', undefined, 180_000),
          SPY: undefined,
        },
      }),
      new FixedClock(OBSERVED_AT),
    );

    expect(marketSection(output, 'AAPL')).toContain('market-data age ms: 180000');
    expect(marketSection(output, 'AAPL')).toContain('market-data freshness: fresh');
    expect(marketSection(output, 'AAPL')).toContain('persisted freshness threshold ms: 180000');
  });

  it('distinguishes stale and future canonical bars with signed age', () => {
    const output = renderSignalStatus(
      statusFixture({
        latestMarketData: {
          AAPL: marketData('AAPL', '2026-07-13T13:40:00.000Z'),
          SPY: marketData('SPY', '2026-07-13T14:01:00.000Z'),
        },
      }),
      new FixedClock(OBSERVED_AT),
    );

    expect(marketSection(output, 'AAPL')).toContain('market-data age ms: 1140000');
    expect(marketSection(output, 'AAPL')).toContain('market-data freshness: stale');
    expect(marketSection(output, 'SPY')).toContain('market-data age ms: -120000');
    expect(marketSection(output, 'SPY')).toContain('market-data freshness: future');
  });

  it('uses outside-session and unknown-calendar states instead of wall-clock staleness', () => {
    const fridayBar = marketData('AAPL', '2026-07-17T19:58:00.000Z', '2026-07-17T19:59:05.000Z');
    const outside = renderSignalStatus(
      statusFixture({ latestMarketData: { AAPL: fridayBar, SPY: undefined } }),
      new FixedClock(createUtcTimestamp('2026-07-18T15:00:00.000Z')),
    );
    expect(marketSection(outside, 'AAPL')).toContain('market-data freshness: outside_session');
    expect(marketSection(outside, 'SPY')).toContain('market-data freshness: outside_session');

    const unknown = renderSignalStatus(
      statusFixture({
        latestMarketData: {
          AAPL: marketData('AAPL', '2028-12-29T20:58:00.000Z', '2028-12-29T20:59:05.000Z'),
          SPY: undefined,
        },
      }),
      new FixedClock(createUtcTimestamp('2029-01-02T15:00:00.000Z')),
    );
    expect(marketSection(unknown, 'AAPL')).toContain('market-data freshness: unknown');
    expect(marketSection(unknown, 'SPY')).toContain('market-data freshness: unknown');
  });

  it('makes missing evaluations and an unavailable persisted freshness policy explicit', () => {
    const output = renderSignalStatus(
      statusFixture({
        lifecycle: 'disabled',
        runId: null,
        runState: null,
        cursorPosition: null,
        stopPosition: null,
        backlogCount: '0',
        heartbeatAt: null,
        lastEvaluatedBarStart: null,
        semantics: null,
        latestMarketData: { AAPL: undefined, SPY: undefined },
      }),
      new FixedClock(OBSERVED_AT),
    );

    expect(output).toContain('worker processing lag: unavailable');
    expect(output).toContain('worker heartbeat freshness: unavailable');
    expect(output).toContain('AAPL: warming-up or missing');
    expect(output).toContain('SPY: warming-up or missing');
    expect(marketSection(output, 'AAPL')).toContain('market-data freshness: unavailable');
    expect(output).not.toContain('close USD/share');
  });
});
