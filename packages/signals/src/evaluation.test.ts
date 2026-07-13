import { describe, expect, it } from 'vitest';

import type { FeatureResult, SignalEvaluation } from './contracts.js';
import { evaluateBreakoutPlusVolume } from './evaluation.js';
import { SignalError } from './errors.js';
import { computeFeatureResult } from './features.js';
import { serializeSignalEvaluation, serializeSignalTransition } from './serialization.js';
import { readyBars, testBar, testConfiguration } from './test-fixtures.js';
import { createSignalTransition } from './transitions.js';

function feature(
  input: {
    readonly close?: string;
    readonly high?: string;
    readonly low?: string;
    readonly volume?: string;
    readonly multiplier?: string;
  } = {},
): { readonly result: FeatureResult; readonly evaluation: SignalEvaluation } {
  const configuration = testConfiguration(
    input.multiplier === undefined ? {} : { volumeMultiplier: input.multiplier },
  );
  const bars = readyBars({
    ...(input.close === undefined ? {} : { evaluationClose: input.close }),
    ...(input.high === undefined ? {} : { evaluationHigh: input.high }),
    ...(input.low === undefined ? {} : { evaluationLow: input.low }),
    ...(input.volume === undefined ? {} : { evaluationVolume: input.volume }),
  });
  const result = computeFeatureResult({
    canonicalBars: bars,
    evaluationEventId: bars[3]!.eventId,
    configuration,
  });
  return Object.freeze({
    result,
    evaluation: evaluateBreakoutPlusVolume(result, configuration),
  });
}

describe('breakout-plus-volume evaluation', () => {
  it('fires upward and downward only on strict price breakouts with confirmed volume', () => {
    const upward = feature().evaluation;
    expect(upward).toMatchObject({
      outcome: 'fired',
      direction: 'upward',
      volumeComparison: {
        currentVolume: '400',
        priorVolumeSum: '600',
        priorCount: 3,
        multiplier: '1.5',
        leftProduct: '1200',
        rightProduct: '900',
        confirmed: true,
      },
      occurrence: {
        reason: 'upward_breakout_with_confirmed_volume',
        breakoutReference: '103',
        invalidationCondition: {
          operator: 'less_than_or_equal',
          reference: '103',
        },
      },
    });
    const downward = feature({ close: '94', high: '105', low: '90' }).evaluation;
    expect(downward).toMatchObject({
      outcome: 'fired',
      direction: 'downward',
      occurrence: {
        reason: 'downward_breakout_with_confirmed_volume',
        breakoutReference: '96',
        invalidationCondition: {
          operator: 'greater_than_or_equal',
          reference: '96',
        },
      },
    });
  });

  it('does not treat price equality as a breakout', () => {
    expect(feature({ close: '103' }).evaluation).toMatchObject({
      outcome: 'not_fired',
      reason: 'price_not_breakout',
      breakoutDirection: 'none',
    });
    expect(feature({ close: '96' }).evaluation).toMatchObject({
      outcome: 'not_fired',
      reason: 'price_not_breakout',
      breakoutDirection: 'none',
    });
  });

  it('accepts exact volume-threshold equality and separates price-only/volume-only cases', () => {
    expect(feature({ multiplier: '2' }).evaluation).toMatchObject({
      outcome: 'fired',
      volumeComparison: { leftProduct: '1200', rightProduct: '1200', confirmed: true },
    });
    expect(feature({ volume: '100' }).evaluation).toMatchObject({
      outcome: 'not_fired',
      reason: 'volume_not_confirmed',
      breakoutDirection: 'upward',
    });
    expect(feature({ close: '100', multiplier: '1' }).evaluation).toMatchObject({
      outcome: 'not_fired',
      reason: 'price_not_breakout',
      volumeComparison: { confirmed: true },
    });
  });

  it('uses exact fractional arithmetic without intermediate averages or rounding', () => {
    const configuration = testConfiguration({ volumeMultiplier: '1.5' });
    const bars = [
      testBar({ minute: 0, volume: '0.1', high: '101', low: '98' }),
      testBar({ minute: 1, volume: '0.2', high: '103', low: '97' }),
      testBar({ minute: 2, volume: '0.3', high: '102', low: '96' }),
      testBar({ minute: 3, volume: '0.3', high: '110', low: '95', close: '106' }),
    ];
    const result = computeFeatureResult({
      canonicalBars: bars,
      evaluationEventId: bars[3]!.eventId,
      configuration,
    });
    expect(evaluateBreakoutPlusVolume(result, configuration)).toMatchObject({
      outcome: 'fired',
      volumeComparison: { leftProduct: '0.9', rightProduct: '0.9', confirmed: true },
    });
  });

  it('maps feature suppression through to a stable suppressed evaluation', () => {
    const configuration = testConfiguration();
    const bars = [testBar({ minute: 0 }), testBar({ minute: 1 })];
    const result = computeFeatureResult({
      canonicalBars: bars,
      evaluationEventId: bars[1]!.eventId,
      configuration,
    });
    const evaluation = evaluateBreakoutPlusVolume(result, configuration);
    expect(evaluation).toMatchObject({ outcome: 'suppressed', reason: 'insufficient_warmup' });
    expect(serializeSignalEvaluation(evaluation)).toContain(evaluation.evaluationId);
  });

  it('produces byte-stable identities and complete occurrence evidence', () => {
    const left = feature().evaluation;
    const right = feature().evaluation;
    expect(right).toEqual(left);
    expect(serializeSignalEvaluation(right)).toBe(serializeSignalEvaluation(left));
    if (left.outcome !== 'fired') throw new Error('expected fired fixture');
    expect(left.occurrence.occurrenceId).toMatch(/^[0-9a-f]{64}$/u);
    expect(left.occurrence.evidence).toBe(left.featureResult.evidence);
    expect(left.occurrence.source).toMatchObject({
      provider: 'alpaca',
      feed: 'iex',
      entitlement: 'real_time',
    });
    expect(left.occurrence.mode).toBe('on_time');
  });

  it('changes identity when current evidence changes even if outcome is unchanged', () => {
    const configuration = testConfiguration();
    const original = readyBars();
    const corrected = [
      original[0]!,
      testBar({ minute: 1, high: '104', low: '97', volume: '200' }),
      original[2]!,
      original[3]!,
    ];
    const originalFeature = computeFeatureResult({
      canonicalBars: original,
      evaluationEventId: original[3]!.eventId,
      configuration,
    });
    const correctedFeature = computeFeatureResult({
      canonicalBars: corrected,
      evaluationEventId: corrected[3]!.eventId,
      configuration,
    });
    const originalEvaluation = evaluateBreakoutPlusVolume(originalFeature, configuration);
    const correctedEvaluation = evaluateBreakoutPlusVolume(correctedFeature, configuration);
    expect(correctedEvaluation.outcome).toBe('fired');
    expect(correctedFeature.featureResultId).not.toBe(originalFeature.featureResultId);
    expect(correctedEvaluation.evaluationId).not.toBe(originalEvaluation.evaluationId);
  });

  it('preserves retrospective mode on a fired historical observation', () => {
    const configuration = testConfiguration();
    const bars = [
      testBar({ minute: 0 }),
      testBar({ minute: 1, receivedOffsetMs: 300_000 }),
      testBar({ minute: 2 }),
      testBar({ minute: 3, high: '110', low: '95', close: '106', volume: '400' }),
    ];
    const result = computeFeatureResult({
      canonicalBars: bars,
      evaluationEventId: bars[3]!.eventId,
      configuration,
    });
    expect(evaluateBreakoutPlusVolume(result, configuration)).toMatchObject({
      outcome: 'fired',
      occurrence: { mode: 'retrospective', knowledgeAsOf: '2026-07-13T13:36:00.000Z' },
    });
  });

  it('rejects a configuration mismatch and tampered evaluation identity', () => {
    const { result, evaluation } = feature();
    expect(() =>
      evaluateBreakoutPlusVolume(result, testConfiguration({ configurationVersion: 'changed-v1' })),
    ).toThrowError(new SignalError('configuration_invalid'));
    expect(() =>
      serializeSignalEvaluation({ ...evaluation, evaluationId: '0'.repeat(64) }),
    ).toThrowError(new SignalError('serialization_invalid'));
  });
});

describe('run-scoped evaluation transitions', () => {
  const revisionId = 'a'.repeat(64);

  it('distinguishes initial, supersession, and fired retraction states', () => {
    const fired = feature().evaluation;
    const notFired = feature({ close: '100' }).evaluation;
    const initial = createSignalTransition({
      signalRunId: 'run-1',
      triggeringRevisionId: revisionId,
      processingPosition: '1',
      current: fired,
    });
    expect(initial).toMatchObject({ kind: 'initial', latestRevisionState: 'current' });

    const supersession = createSignalTransition({
      signalRunId: 'run-1',
      triggeringRevisionId: revisionId,
      processingPosition: '2',
      predecessor: notFired,
      current: fired,
    });
    expect(supersession).toMatchObject({
      kind: 'supersession',
      latestRevisionState: 'superseded',
      predecessorEvaluationId: notFired.evaluationId,
    });

    const retraction = createSignalTransition({
      signalRunId: 'run-1',
      triggeringRevisionId: revisionId,
      processingPosition: '3',
      predecessor: fired,
      current: notFired,
    });
    expect(retraction).toMatchObject({
      kind: 'retraction',
      latestRevisionState: 'retracted',
      retractedOccurrenceId: fired.outcome === 'fired' ? fired.occurrence.occurrenceId : undefined,
    });
    expect(serializeSignalTransition(retraction)).toContain(retraction.transitionId);
  });

  it('rejects duplicate transitions and invalid operational positions', () => {
    const current = feature().evaluation;
    expect(() =>
      createSignalTransition({
        signalRunId: 'run-1',
        triggeringRevisionId: revisionId,
        processingPosition: '2',
        predecessor: current,
        current,
      }),
    ).toThrowError(new SignalError('transition_invalid'));
    expect(() =>
      createSignalTransition({
        signalRunId: 'run-1',
        triggeringRevisionId: revisionId,
        processingPosition: '01',
        current,
      }),
    ).toThrowError(new SignalError('transition_invalid'));
  });
});
