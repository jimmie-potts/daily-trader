import {
  compareSignalDecimals,
  createSignalDecimal,
  multiplySignalDecimalByCount,
  multiplySignalDecimals,
} from './arithmetic.js';
import {
  BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
  SIGNAL_EVALUATION_SCHEMA_VERSION,
  type SignalConfiguration,
} from './configuration.js';
import type {
  BreakoutDirection,
  FeatureResult,
  FiredSignalEvaluation,
  NotFiredSignalEvaluation,
  SignalEvaluation,
  SignalInvalidationCondition,
  SignalOccurrence,
  SuppressedSignalEvaluation,
  VolumeComparisonEvidence,
} from './contracts.js';
import { SignalError } from './errors.js';
import {
  signalEvaluationIdentityFromMaterial,
  signalOccurrenceIdentity,
  type SignalEvaluationIdentityMaterial,
} from './serialization.js';

function suppressedEvaluation(
  featureResult: FeatureResult,
  reason: SuppressedSignalEvaluation['reason'],
): SuppressedSignalEvaluation {
  const material: SignalEvaluationIdentityMaterial = Object.freeze({
    featureResult,
    outcome: 'suppressed',
    reason,
  });
  return Object.freeze({
    schemaVersion: SIGNAL_EVALUATION_SCHEMA_VERSION,
    definitionVersion: BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
    evaluationId: signalEvaluationIdentityFromMaterial(material),
    ...material,
  });
}

function volumeComparison(
  feature: Extract<FeatureResult, { readonly kind: 'ready' }>,
  configuration: SignalConfiguration,
): VolumeComparisonEvidence {
  const currentVolume = createSignalDecimal(feature.evaluationBar.volume);
  const leftProduct = multiplySignalDecimalByCount(currentVolume, feature.priorVolume.count);
  const rightProduct = multiplySignalDecimals(
    feature.priorVolume.sum,
    configuration.volumeMultiplier,
  );
  return Object.freeze({
    currentVolume,
    priorVolumeSum: feature.priorVolume.sum,
    priorCount: feature.priorVolume.count,
    multiplier: configuration.volumeMultiplier,
    leftProduct,
    rightProduct,
    operator: 'greater_than_or_equal',
    confirmed: compareSignalDecimals(leftProduct, rightProduct) >= 0,
  });
}

function breakoutDirection(
  feature: Extract<FeatureResult, { readonly kind: 'ready' }>,
): BreakoutDirection | 'none' {
  const close = createSignalDecimal(feature.evaluationBar.close);
  if (compareSignalDecimals(close, feature.priorRange.high) > 0) return 'upward';
  if (compareSignalDecimals(close, feature.priorRange.low) < 0) return 'downward';
  return 'none';
}

function notFiredEvaluation(
  featureResult: Extract<FeatureResult, { readonly kind: 'ready' }>,
  direction: BreakoutDirection | 'none',
  comparison: VolumeComparisonEvidence,
): NotFiredSignalEvaluation {
  const material: SignalEvaluationIdentityMaterial = Object.freeze({
    featureResult,
    outcome: 'not_fired',
    reason: direction === 'none' ? 'price_not_breakout' : 'volume_not_confirmed',
    breakoutDirection: direction,
    volumeComparison: comparison,
  });
  return Object.freeze({
    schemaVersion: SIGNAL_EVALUATION_SCHEMA_VERSION,
    definitionVersion: BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
    evaluationId: signalEvaluationIdentityFromMaterial(material),
    ...material,
  });
}

function invalidationCondition(
  direction: BreakoutDirection,
  reference: ReturnType<typeof createSignalDecimal>,
): SignalInvalidationCondition {
  return Object.freeze({
    kind: 'close_returns_inside_prior_range',
    operator: direction === 'upward' ? 'less_than_or_equal' : 'greater_than_or_equal',
    reference,
  });
}

function firedEvaluation(
  featureResult: Extract<FeatureResult, { readonly kind: 'ready' }>,
  direction: BreakoutDirection,
  comparison: VolumeComparisonEvidence,
): FiredSignalEvaluation {
  const material: SignalEvaluationIdentityMaterial = Object.freeze({
    featureResult,
    outcome: 'fired',
    direction,
    volumeComparison: comparison,
  });
  const evaluationId = signalEvaluationIdentityFromMaterial(material);
  const breakoutReference =
    direction === 'upward' ? featureResult.priorRange.high : featureResult.priorRange.low;
  const occurrenceWithoutId: Omit<SignalOccurrence, 'occurrenceId'> = {
    evaluationId,
    definitionVersion: BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
    direction,
    reason:
      direction === 'upward'
        ? 'upward_breakout_with_confirmed_volume'
        : 'downward_breakout_with_confirmed_volume',
    observedClose: createSignalDecimal(featureResult.evaluationBar.close),
    observedVolume: createSignalDecimal(featureResult.evaluationBar.volume),
    breakoutReference,
    volumeComparison: comparison,
    invalidationCondition: invalidationCondition(direction, breakoutReference),
    instrument: featureResult.instrument,
    evaluationBar: featureResult.evaluationBar,
    observationAsOf: featureResult.observationAsOf,
    knowledgeAsOf: featureResult.knowledgeAsOf,
    mode: featureResult.mode,
    source: featureResult.source,
    units: featureResult.units,
    evidence: featureResult.evidence,
    semantics: featureResult.semantics,
  };
  const provisional = { ...occurrenceWithoutId, occurrenceId: '' } as SignalOccurrence;
  const occurrence = Object.freeze({
    ...occurrenceWithoutId,
    occurrenceId: signalOccurrenceIdentity(provisional),
  });
  return Object.freeze({
    schemaVersion: SIGNAL_EVALUATION_SCHEMA_VERSION,
    definitionVersion: BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
    evaluationId,
    ...material,
    occurrence,
  });
}

/** Purely maps one immutable feature result to one deterministic signal evaluation. */
export function evaluateBreakoutPlusVolume(
  featureResult: FeatureResult,
  configuration: SignalConfiguration,
): SignalEvaluation {
  if (
    featureResult.semantics.configurationHash !== configuration.configurationHash ||
    featureResult.semantics.configurationVersion !== configuration.configurationVersion
  ) {
    throw new SignalError('configuration_invalid');
  }
  if (featureResult.kind === 'suppressed') {
    return suppressedEvaluation(featureResult, featureResult.reason);
  }
  try {
    const direction = breakoutDirection(featureResult);
    const comparison = volumeComparison(featureResult, configuration);
    if (direction === 'none' || !comparison.confirmed) {
      return notFiredEvaluation(featureResult, direction, comparison);
    }
    return firedEvaluation(featureResult, direction, comparison);
  } catch (error) {
    if (error instanceof SignalError && error.code === 'arithmetic_overflow') {
      return suppressedEvaluation(featureResult, 'arithmetic_overflow');
    }
    if (error instanceof SignalError && error.code === 'decimal_invalid') {
      return suppressedEvaluation(featureResult, 'arithmetic_overflow');
    }
    throw error;
  }
}
