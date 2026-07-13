import { describe, expect, it } from 'vitest';

import { SignalError } from './errors.js';
import {
  MAX_FEATURE_STATE_BARS_PER_INSTRUMENT,
  affectedEvaluationEventIds,
  computeFeatureResult,
} from './features.js';
import { serializeFeatureResult } from './serialization.js';
import { readyBars, testBar, testConfiguration } from './test-fixtures.js';

describe('deterministic feature windows', () => {
  it('builds an exact ready snapshot from one shared prior window', () => {
    const bars = readyBars();
    const result = computeFeatureResult({
      canonicalBars: bars,
      evaluationEventId: bars[3]!.eventId,
      configuration: testConfiguration(),
    });
    expect(result).toMatchObject({
      kind: 'ready',
      priorRange: { high: '103', low: '96' },
      priorVolume: { sum: '600', count: 3 },
      window: {
        firstBarStart: '2026-07-13T13:30:00.000Z',
        lastBarStart: '2026-07-13T13:32:00.000Z',
        count: 3,
      },
      observationAsOf: '2026-07-13T13:34:10.000Z',
      knowledgeAsOf: '2026-07-13T13:34:10.000Z',
      mode: 'on_time',
    });
    expect(result.evidence.map(({ role, ordinal }) => [role, ordinal])).toEqual([
      ['evaluation_bar', 0],
      ['reference_bar', 0],
      ['reference_bar', 1],
      ['reference_bar', 2],
    ]);
    expect(result.featureResultId).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    expect(serializeFeatureResult(result)).toContain(result.featureResultId);
  });

  it('excludes the evaluation bar and every later bar from the reference window', () => {
    const bars = readyBars();
    const base = computeFeatureResult({
      canonicalBars: bars,
      evaluationEventId: bars[3]!.eventId,
      configuration: testConfiguration(),
    });
    const withFuture = computeFeatureResult({
      canonicalBars: [
        ...bars,
        testBar({ minute: 4, high: '999999', low: '1', close: '2', volume: '999999' }),
      ],
      evaluationEventId: bars[3]!.eventId,
      configuration: testConfiguration(),
    });
    expect(withFuture).toEqual(base);
  });

  it('isolates instruments and is independent of input ordering', () => {
    const bars = readyBars();
    const spy = readyBars({ symbol: 'SPY' });
    const mixed = [...spy, ...bars].reverse();
    const result = computeFeatureResult({
      canonicalBars: mixed,
      evaluationEventId: bars[3]!.eventId,
      configuration: testConfiguration(),
    });
    expect(result.instrument).toEqual({ symbol: 'AAPL', venue: 'XNAS' });
    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') expect(result.priorRange.high).toBe('103');
  });

  it('suppresses warm-up, gaps, future-as-of bars, and zero baselines explicitly', () => {
    const configuration = testConfiguration();
    const warmupBars = [testBar({ minute: 0 }), testBar({ minute: 1 })];
    expect(
      computeFeatureResult({
        canonicalBars: warmupBars,
        evaluationEventId: warmupBars[1]!.eventId,
        configuration,
      }),
    ).toMatchObject({ kind: 'suppressed', reason: 'insufficient_warmup' });

    const gapBars = [testBar({ minute: 0 }), testBar({ minute: 2 }), testBar({ minute: 3 })];
    expect(
      computeFeatureResult({
        canonicalBars: gapBars,
        evaluationEventId: gapBars[2]!.eventId,
        configuration,
      }),
    ).toMatchObject({ kind: 'suppressed', reason: 'missing_interval' });

    const futureBars = [
      testBar({ minute: 0 }),
      testBar({ minute: 1 }),
      testBar({ minute: 2 }),
      testBar({ minute: 3, receivedOffsetMs: 30_000 }),
    ];
    expect(
      computeFeatureResult({
        canonicalBars: futureBars,
        evaluationEventId: futureBars[3]!.eventId,
        configuration,
      }),
    ).toMatchObject({ kind: 'suppressed', reason: 'future_evaluation_bar' });

    const zeroBars = [
      testBar({ minute: 0, volume: '0' }),
      testBar({ minute: 1, volume: '0' }),
      testBar({ minute: 2, volume: '0' }),
      testBar({ minute: 3 }),
    ];
    expect(
      computeFeatureResult({
        canonicalBars: zeroBars,
        evaluationEventId: zeroBars[3]!.eventId,
        configuration,
      }),
    ).toMatchObject({ kind: 'suppressed', reason: 'unusable_volume_baseline' });
  });

  it('suppresses exact arithmetic overflow without substituting a value', () => {
    const huge = '9'.repeat(48);
    const bars = [
      testBar({ minute: 0, volume: huge }),
      testBar({ minute: 1, volume: huge }),
      testBar({ minute: 2, volume: huge }),
      testBar({ minute: 3 }),
    ];
    expect(
      computeFeatureResult({
        canonicalBars: bars,
        evaluationEventId: bars[3]!.eventId,
        configuration: testConfiguration(),
      }),
    ).toMatchObject({ kind: 'suppressed', reason: 'arithmetic_overflow' });
  });

  it('labels historical knowledge retrospectively using immutable received times', () => {
    const bars = [
      testBar({ minute: 0 }),
      testBar({ minute: 1, receivedOffsetMs: 300_000 }),
      testBar({ minute: 2 }),
      testBar({ minute: 3 }),
    ];
    const result = computeFeatureResult({
      canonicalBars: bars,
      evaluationEventId: bars[3]!.eventId,
      configuration: testConfiguration(),
    });
    expect(result).toMatchObject({
      kind: 'ready',
      mode: 'retrospective',
      observationAsOf: '2026-07-13T13:34:10.000Z',
      knowledgeAsOf: '2026-07-13T13:36:00.000Z',
    });
  });

  it('does not let worker processing time alter feature identity', () => {
    const original = readyBars();
    const lagged = original.map((bar, index) =>
      testBar({
        minute: index,
        high: bar.high,
        low: bar.low,
        open: bar.open,
        close: bar.close,
        volume: bar.volume,
        processedOffsetMs: 90_000,
      }),
    );
    const first = computeFeatureResult({
      canonicalBars: original,
      evaluationEventId: original[3]!.eventId,
      configuration: testConfiguration(),
    });
    const second = computeFeatureResult({
      canonicalBars: lagged,
      evaluationEventId: lagged[3]!.eventId,
      configuration: testConfiguration(),
    });
    expect(second.featureResultId).toBe(first.featureResultId);
  });

  it('resets at exchange sessions and fails closed for noncanonical calendar input', () => {
    const bars = [
      testBar({ date: '2026-07-13', minute: 387 }),
      testBar({ date: '2026-07-14', minute: 0 }),
      testBar({ date: '2026-07-14', minute: 1 }),
    ];
    expect(
      computeFeatureResult({
        canonicalBars: bars,
        evaluationEventId: bars[2]!.eventId,
        configuration: testConfiguration(),
      }),
    ).toMatchObject({ kind: 'suppressed', reason: 'insufficient_warmup' });

    const holiday = testBar({ date: '2026-07-03', minute: 0 });
    expect(() =>
      computeFeatureResult({
        canonicalBars: [holiday],
        evaluationEventId: holiday.eventId,
        configuration: testConfiguration({ lookbackBars: 1 }),
      }),
    ).toThrowError(new SignalError('invariant_violation'));
  });

  it('bounds affected result fan-out to the changed bar plus lookback', () => {
    const bars = Array.from({ length: 7 }, (_, minute) => testBar({ minute }));
    expect(MAX_FEATURE_STATE_BARS_PER_INSTRUMENT).toBe(391);
    expect(
      affectedEvaluationEventIds({
        canonicalBars: bars,
        changedEventId: bars[2]!.eventId,
        lookbackBars: 3,
      }),
    ).toEqual(bars.slice(2, 6).map(({ eventId }) => eventId));
  });

  it('rejects duplicate canonical logical bars', () => {
    const bar = testBar({ minute: 0 });
    expect(() =>
      computeFeatureResult({
        canonicalBars: [bar, bar],
        evaluationEventId: bar.eventId,
        configuration: testConfiguration({ lookbackBars: 1 }),
      }),
    ).toThrowError(new SignalError('invariant_violation'));
  });

  it('rejects an unsupported feature schema during canonical serialization', () => {
    const bars = readyBars();
    const result = computeFeatureResult({
      canonicalBars: bars,
      evaluationEventId: bars[3]!.eventId,
      configuration: testConfiguration(),
    });
    expect(() =>
      serializeFeatureResult({
        ...result,
        schemaVersion: 'daily-trader.signals.feature-result.v2',
      } as unknown as typeof result),
    ).toThrowError(new SignalError('serialization_invalid'));
  });
});
