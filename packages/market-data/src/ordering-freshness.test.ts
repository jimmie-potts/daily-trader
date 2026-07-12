import { createUtcTimestamp } from '@daily-trader/domain';
import { describe, expect, it } from 'vitest';

import {
  createOneMinuteBarEvent,
  type OneMinuteBarEvent,
  type OneMinuteBarEventInput,
} from './bar-event.js';
import { classifyMarketDataFreshness } from './freshness.js';
import { MarketEventOrderingTracker, assessIntervalGap } from './ordering.js';

function bar(barStart: string, overrides: Partial<OneMinuteBarEventInput> = {}): OneMinuteBarEvent {
  const start = Date.parse(barStart);
  return createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: barStart,
    receivedAt: new Date(start + 60_100).toISOString(),
    processedAt: new Date(start + 60_200).toISOString(),
    open: '100',
    high: '101',
    low: '99',
    close: '100.5',
    volume: '1000',
    ...overrides,
  });
}

describe('MarketEventOrderingTracker', () => {
  it('classifies accepted, duplicate, correction, and out-of-order events', () => {
    const tracker = new MarketEventOrderingTracker();
    const first = bar('2026-07-13T13:30:00Z');
    const correction = bar('2026-07-13T13:30:00Z', { close: '100.75' });
    const newer = bar('2026-07-13T13:32:00Z');
    const outOfOrder = bar('2026-07-13T13:31:00Z');

    expect(tracker.classify(first, createUtcTimestamp(first.receivedAt))).toMatchObject({
      classification: 'accepted',
      late: false,
      gap: { state: 'unknown' },
    });
    expect(tracker.classify(first, createUtcTimestamp(first.receivedAt))).toMatchObject({
      classification: 'duplicate',
    });
    expect(tracker.classify(correction, createUtcTimestamp(correction.receivedAt))).toMatchObject({
      classification: 'correction',
    });
    expect(tracker.classify(newer, createUtcTimestamp(newer.receivedAt))).toMatchObject({
      classification: 'accepted',
      gap: {
        state: 'gapped',
        missingIntervalCount: 1,
        firstMissingBarStart: '2026-07-13T13:31:00.000Z',
      },
    });
    expect(tracker.classify(outOfOrder, createUtcTimestamp(outOfOrder.receivedAt))).toMatchObject({
      classification: 'out_of_order',
      gap: { state: 'gapped' },
    });
  });

  it('keeps late classification independent from ordering', () => {
    const tracker = new MarketEventOrderingTracker();
    const event = bar('2026-07-13T13:30:00Z');
    const lateTime = createUtcTimestamp('2026-07-13T13:33:00.001Z');

    expect(tracker.classify(event, lateTime)).toMatchObject({
      classification: 'accepted',
      late: true,
    });
    expect(tracker.classify(event, lateTime)).toMatchObject({
      classification: 'duplicate',
      late: true,
    });
  });

  it('does not invent gaps across closed sessions', () => {
    expect(
      assessIntervalGap(
        createUtcTimestamp('2026-07-10T19:59:00.000Z'),
        createUtcTimestamp('2026-07-13T13:30:00.000Z'),
      ),
    ).toEqual({ state: 'complete', missingIntervalCount: 0, scanLimited: false });

    expect(
      assessIntervalGap(
        createUtcTimestamp('2026-11-27T17:59:00.000Z'),
        createUtcTimestamp('2026-11-30T14:30:00.000Z'),
      ),
    ).toEqual({ state: 'complete', missingIntervalCount: 0, scanLimited: false });
  });

  it('reports unknown when a bounded scan cannot prove completeness', () => {
    expect(
      assessIntervalGap(
        createUtcTimestamp('2026-01-02T20:59:00.000Z'),
        createUtcTimestamp('2026-01-20T14:30:00.000Z'),
      ),
    ).toEqual({ state: 'unknown', missingIntervalCount: 0, scanLimited: true });
  });

  it('can reset named-session in-memory state', () => {
    const tracker = new MarketEventOrderingTracker();
    const event = bar('2026-07-13T13:30:00Z');
    tracker.classify(event, createUtcTimestamp(event.receivedAt));
    tracker.reset();

    expect(tracker.classify(event, createUtcTimestamp(event.receivedAt)).classification).toBe(
      'accepted',
    );
  });

  it('bounds duplicate and correction memory while preserving series ordering state', () => {
    const tracker = new MarketEventOrderingTracker({ maximumTrackedEvents: 2 });
    const first = bar('2026-07-13T13:30:00Z');
    const second = bar('2026-07-13T13:31:00Z');
    const third = bar('2026-07-13T13:32:00Z');
    tracker.classify(first, createUtcTimestamp(first.receivedAt));
    tracker.classify(second, createUtcTimestamp(second.receivedAt));
    tracker.classify(third, createUtcTimestamp(third.receivedAt));

    expect(tracker.classify(first, createUtcTimestamp(first.receivedAt))).toMatchObject({
      classification: 'out_of_order',
    });
  });

  it('uses the configured freshness threshold', () => {
    const tracker = new MarketEventOrderingTracker({ freshnessThresholdMs: 180_000 });
    const event = bar('2026-07-13T13:30:00Z');

    expect(tracker.classify(event, createUtcTimestamp('2026-07-13T13:34:00.000Z'))).toMatchObject({
      late: false,
    });
  });
});

describe('classifyMarketDataFreshness', () => {
  const event = bar('2026-07-13T13:30:00Z');

  it.each([
    ['2026-07-13T13:30:30.000Z', 'future', -30_000],
    ['2026-07-13T13:31:00.000Z', 'fresh', 0],
    ['2026-07-13T13:33:00.000Z', 'fresh', 120_000],
    ['2026-07-13T13:33:00.001Z', 'stale', 120_001],
  ] as const)('classifies %s as %s', (observedAt, state, ageMs) => {
    expect(classifyMarketDataFreshness(event, createUtcTimestamp(observedAt))).toMatchObject({
      state,
      ageMs,
    });
  });

  it('distinguishes no-data, outside-session, and unknown calendar states', () => {
    expect(
      classifyMarketDataFreshness(undefined, createUtcTimestamp('2026-07-13T13:30:00.000Z')),
    ).toMatchObject({ state: 'no_data' });
    expect(
      classifyMarketDataFreshness(event, createUtcTimestamp('2026-07-12T15:00:00.000Z')),
    ).toMatchObject({ state: 'outside_session' });
    expect(
      classifyMarketDataFreshness(event, createUtcTimestamp('2029-01-02T15:00:00.000Z')),
    ).toMatchObject({ state: 'unknown' });
  });

  it('does not treat an outside-session bar as current data', () => {
    const premarket = bar('2026-07-13T13:00:00Z');
    expect(
      classifyMarketDataFreshness(premarket, createUtcTimestamp('2026-07-13T13:30:00.000Z')),
    ).toMatchObject({ state: 'outside_session' });
  });

  it('uses an explicitly supplied freshness threshold', () => {
    expect(
      classifyMarketDataFreshness(
        event,
        createUtcTimestamp('2026-07-13T13:34:00.000Z'),
        undefined,
        180_000,
      ),
    ).toMatchObject({ state: 'fresh', ageMs: 180_000 });
  });
});
