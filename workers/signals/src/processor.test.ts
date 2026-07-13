import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import {
  MARKET_DATA_SCHEMA_VERSION,
  createCanonicalRevision,
  createOneMinuteBarEvent,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import type { AppMeter, MetricAttributes } from '@daily-trader/observability';
import { createSignalConfiguration } from '@daily-trader/signals';
import { describe, expect, it, vi } from 'vitest';

import { SignalMetrics } from './metrics.js';
import type { JournalRevision, LiveRunClaim, SignalsRepository } from './persistence/repository.js';
import { LiveJournalProcessor } from './processor.js';

interface MetricObservation {
  readonly name: string;
  readonly attributes?: MetricAttributes | undefined;
}

const CLOCK = new FixedClock(createUtcTimestamp('2026-07-13T14:00:00.000Z'));
const CONFIGURATION = createSignalConfiguration({
  configurationVersion: 'phase3-processor-test-v1',
  lookbackBars: 3,
  volumeMultiplier: '1.5',
  freshnessThresholdMs: 120_000,
});
const CLAIM: LiveRunClaim = Object.freeze({
  runId: 'live-processor-test',
  state: 'active',
  cursorPosition: '0',
  stopPosition: null,
  fenceToken: '1',
  ownerId: 'signal-worker-processor-test',
  statusFenceToken: '1',
  leaseDurationMs: 30_000,
  renewIntervalMs: 10_000,
});

function recordingMeter(observations: MetricObservation[]): AppMeter {
  return {
    addCounter: (name, _value, attributes): void => {
      observations.push({ name, attributes });
    },
    recordGauge: (name, _value, _unit, attributes): void => {
      observations.push({ name, attributes });
    },
    recordHealth: (): void => undefined,
    recordHistogram: (name, _value, _unit, attributes): void => {
      observations.push({ name, attributes });
    },
  };
}

function bar(
  minute: number,
  input: { readonly high?: string; readonly volume?: string } = {},
): OneMinuteBarEvent {
  const start = Date.parse('2026-07-13T13:30:00.000Z') + minute * 60_000;
  return createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: new Date(start).toISOString(),
    receivedAt: new Date(start + 70_000).toISOString(),
    processedAt: new Date(start + 71_000).toISOString(),
    open: '100',
    high: input.high ?? '102',
    low: '98',
    close: minute === 3 ? '106' : '100',
    volume: input.volume ?? '100',
  });
}

function insertRevision(event: OneMinuteBarEvent): JournalRevision {
  return Object.freeze({
    revision: createCanonicalRevision({
      operation: 'insert',
      processingPosition: '1',
      logicalBarKey: event.orderingKey,
      previousCanonicalEventId: null,
      newCanonicalEventId: event.eventId,
      marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
      arrival: { classification: 'accepted', historical: false, outOfOrder: false },
      gap: { state: 'complete', filledKnownGap: false },
    }),
    event,
    journaledAt: createUtcTimestamp('2026-07-13T13:34:11.000Z'),
    arrivalClassification: 'accepted',
    gapState: 'complete',
  });
}

function replacementRevision(): JournalRevision {
  const event = createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: '2026-07-13T13:30:00Z',
    receivedAt: '2026-07-13T13:45:00.000Z',
    processedAt: '2026-07-13T13:45:00.000Z',
    open: '100',
    high: '102',
    low: '99',
    close: '101',
    volume: '1000',
  });
  const revision = createCanonicalRevision({
    operation: 'replace',
    processingPosition: '1',
    logicalBarKey: event.orderingKey,
    previousCanonicalEventId: 'a'.repeat(64),
    newCanonicalEventId: event.eventId,
    marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    arrival: { classification: 'correction', historical: true, outOfOrder: false },
    gap: { state: 'unknown', filledKnownGap: false },
  });
  return Object.freeze({
    revision,
    event,
    journaledAt: createUtcTimestamp('2026-07-13T13:45:01.000Z'),
    arrivalClassification: 'correction',
    gapState: 'unknown',
  });
}

function repositoryAtBoundary(boundary: string): {
  readonly repository: SignalsRepository;
  readonly commitRevision: ReturnType<typeof vi.fn>;
} {
  const committedClaim = Object.freeze({ ...CLAIM, cursorPosition: '1' });
  const commitRevision = vi.fn(() => Promise.resolve(committedClaim));
  const repository = {
    boundaries: vi.fn(() =>
      Promise.resolve(
        new Map([
          ['AAPL', createUtcTimestamp(boundary)],
          ['SPY', createUtcTimestamp(boundary)],
        ]),
      ),
    ),
    loadSessionBars: vi.fn(() => Promise.resolve(Object.freeze([]))),
    commitRevision,
  } as unknown as SignalsRepository;
  return { repository, commitRevision };
}

describe('LiveJournalProcessor pre-cutover corrections', () => {
  it('atomically consumes a replacement outside the eligible influence range', async () => {
    const { repository, commitRevision } = repositoryAtBoundary('2026-07-13T13:34:00.000Z');
    const processor = await LiveJournalProcessor.create({
      repository,
      configuration: CONFIGURATION,
      queueCapacity: 10,
      clock: CLOCK,
      claim: CLAIM,
    });
    const revision = replacementRevision();

    await expect(processor.process(revision)).resolves.toEqual([]);
    expect(commitRevision).toHaveBeenCalledOnce();
    expect(commitRevision).toHaveBeenCalledWith(CLAIM, revision, [], CLOCK);
    expect(processor.claim.cursorPosition).toBe('1');
  });

  it('fails closed when a missing replacement predecessor can affect the boundary bar', async () => {
    const { repository, commitRevision } = repositoryAtBoundary('2026-07-13T13:33:00.000Z');
    const processor = await LiveJournalProcessor.create({
      repository,
      configuration: CONFIGURATION,
      queueCapacity: 10,
      clock: CLOCK,
      claim: CLAIM,
    });

    await expect(processor.process(replacementRevision())).rejects.toMatchObject({
      code: 'stored_data_invalid',
    });
    expect(commitRevision).not.toHaveBeenCalled();
    expect(processor.claim.cursorPosition).toBe('0');
  });
});

describe('LiveJournalProcessor metrics', () => {
  it('measures reconstruction, feature, evaluation, and bounded in-memory capacity', async () => {
    const observations: MetricObservation[] = [];
    const evaluationBar = bar(3, { high: '110', volume: '400' });
    const committedClaim = Object.freeze({ ...CLAIM, cursorPosition: '1' });
    const repository = {
      boundaries: vi.fn(() =>
        Promise.resolve(
          new Map([
            ['AAPL', createUtcTimestamp('2026-07-13T13:33:00.000Z')],
            ['SPY', createUtcTimestamp('2026-07-13T13:33:00.000Z')],
          ]),
        ),
      ),
      loadSessionBars: vi.fn(() =>
        Promise.resolve(
          Object.freeze([
            bar(0, { high: '101', volume: '100' }),
            bar(1, { high: '103', volume: '200' }),
            bar(2, { high: '102', volume: '300' }),
          ]),
        ),
      ),
      commitRevision: vi.fn(() => Promise.resolve(committedClaim)),
    } as unknown as SignalsRepository;
    const processor = await LiveJournalProcessor.create({
      repository,
      configuration: CONFIGURATION,
      queueCapacity: 10,
      clock: CLOCK,
      claim: CLAIM,
      metrics: new SignalMetrics(recordingMeter(observations)),
    });

    await expect(processor.process(insertRevision(evaluationBar))).resolves.toHaveLength(1);

    expect(observations.map(({ name }) => name)).toEqual([
      'daily_trader.signal.reconstruction_latency',
      'daily_trader.signal.capacity_state',
      'daily_trader.signal.capacity_state',
      'daily_trader.signal.feature_latency',
      'daily_trader.signal.evaluation_latency',
    ]);
    expect(
      observations.filter(({ name }) => name === 'daily_trader.signal.capacity_state'),
    ).toMatchObject([
      { attributes: { boundary: 'feature_state', state: 'within_limit' } },
      { attributes: { boundary: 'evaluation_queue', state: 'within_limit' } },
    ]);
    expect(JSON.stringify(observations)).not.toMatch(/event_id|evidence|run_id|session_id|symbol/u);
  });
});
