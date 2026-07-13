import { MARKET_DATA_SCHEMA_VERSION } from '@daily-trader/market-data';

import { SIGNAL_ARITHMETIC_POLICY_VERSION } from './arithmetic.js';
import type {
  FeatureResult,
  BreakoutDirection,
  FeatureSuppressionReason,
  SignalEvaluation,
  SignalEvaluationTransition,
  SignalOccurrence,
  VolumeComparisonEvidence,
} from './contracts.js';
import {
  BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
  CANONICAL_REVISION_SCHEMA_VERSION,
  DATA_QUALITY_POLICY_VERSION,
  FEATURE_RESULT_SCHEMA_VERSION,
  NYSE_CALENDAR_SNAPSHOT_VERSION,
  SIGNAL_EVALUATION_SCHEMA_VERSION,
  SIGNAL_TRANSITION_SCHEMA_VERSION,
} from './configuration.js';
import { SignalError } from './errors.js';
import { sha256Canonical } from './identity.js';

function featureContent(result: FeatureResult): Readonly<Record<string, unknown>> {
  const base = {
    schemaVersion: result.schemaVersion,
    definitionVersion: result.definitionVersion,
    kind: result.kind,
    instrument: result.instrument,
    evaluationBar: result.evaluationBar,
    observationAsOf: result.observationAsOf,
    knowledgeAsOf: result.knowledgeAsOf,
    mode: result.mode,
    source: result.source,
    units: result.units,
    evidence: result.evidence,
    semantics: result.semantics,
  };
  return result.kind === 'ready'
    ? {
        ...base,
        priorRange: result.priorRange,
        priorVolume: result.priorVolume,
        window: result.window,
      }
    : { ...base, reason: result.reason };
}

function assertFeatureVersions(result: FeatureResult): void {
  const runtime = result as unknown as Readonly<Record<string, unknown>>;
  const versions = result.semantics as unknown as Readonly<Record<string, unknown>>;
  if (
    runtime.schemaVersion !== FEATURE_RESULT_SCHEMA_VERSION ||
    runtime.definitionVersion !== BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION ||
    versions.marketEventSchemaVersion !== MARKET_DATA_SCHEMA_VERSION ||
    versions.canonicalRevisionSchemaVersion !== CANONICAL_REVISION_SCHEMA_VERSION ||
    versions.arithmeticPolicyVersion !== SIGNAL_ARITHMETIC_POLICY_VERSION ||
    versions.calendarSnapshotVersion !== NYSE_CALENDAR_SNAPSHOT_VERSION ||
    versions.dataQualityPolicyVersion !== DATA_QUALITY_POLICY_VERSION ||
    versions.featureResultSchemaVersion !== FEATURE_RESULT_SCHEMA_VERSION ||
    versions.evaluationSchemaVersion !== SIGNAL_EVALUATION_SCHEMA_VERSION ||
    versions.signalDefinitionVersion !== BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION
  ) {
    throw new SignalError('serialization_invalid');
  }
}

export function featureResultIdentity(result: FeatureResult): string {
  return sha256Canonical(JSON.stringify(featureContent(result)));
}

export function serializeFeatureResult(result: FeatureResult): string {
  assertFeatureVersions(result);
  if (featureResultIdentity(result) !== result.featureResultId) {
    throw new SignalError('serialization_invalid');
  }
  return JSON.stringify({ ...featureContent(result), featureResultId: result.featureResultId });
}

export type SignalEvaluationIdentityMaterial =
  | Readonly<{
      featureResult: FeatureResult;
      outcome: 'suppressed';
      reason: FeatureSuppressionReason;
    }>
  | Readonly<{
      featureResult: FeatureResult;
      outcome: 'not_fired';
      reason: 'price_not_breakout' | 'volume_not_confirmed';
      breakoutDirection: BreakoutDirection | 'none';
      volumeComparison: VolumeComparisonEvidence;
    }>
  | Readonly<{
      featureResult: FeatureResult;
      outcome: 'fired';
      direction: BreakoutDirection;
      volumeComparison: VolumeComparisonEvidence;
    }>;

function evaluationContent(
  evaluation: SignalEvaluationIdentityMaterial,
): Readonly<Record<string, unknown>> {
  const base = {
    schemaVersion: SIGNAL_EVALUATION_SCHEMA_VERSION,
    definitionVersion: BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
    featureResult: JSON.parse(serializeFeatureResult(evaluation.featureResult)) as unknown,
    outcome: evaluation.outcome,
  };
  if (evaluation.outcome === 'suppressed') {
    return { ...base, reason: evaluation.reason };
  }
  if (evaluation.outcome === 'not_fired') {
    return {
      ...base,
      reason: evaluation.reason,
      breakoutDirection: evaluation.breakoutDirection,
      volumeComparison: evaluation.volumeComparison,
    };
  }
  return {
    ...base,
    direction: evaluation.direction,
    volumeComparison: evaluation.volumeComparison,
  };
}

export function signalEvaluationIdentity(evaluation: SignalEvaluation): string {
  return sha256Canonical(JSON.stringify(evaluationContent(evaluation)));
}

export function signalEvaluationIdentityFromMaterial(
  material: SignalEvaluationIdentityMaterial,
): string {
  return sha256Canonical(JSON.stringify(evaluationContent(material)));
}

function occurrenceContent(occurrence: SignalOccurrence): Readonly<Record<string, unknown>> {
  return {
    evaluationId: occurrence.evaluationId,
    definitionVersion: occurrence.definitionVersion,
    direction: occurrence.direction,
    reason: occurrence.reason,
    observedClose: occurrence.observedClose,
    observedVolume: occurrence.observedVolume,
    breakoutReference: occurrence.breakoutReference,
    volumeComparison: occurrence.volumeComparison,
    invalidationCondition: occurrence.invalidationCondition,
    instrument: occurrence.instrument,
    evaluationBar: occurrence.evaluationBar,
    observationAsOf: occurrence.observationAsOf,
    knowledgeAsOf: occurrence.knowledgeAsOf,
    mode: occurrence.mode,
    source: occurrence.source,
    units: occurrence.units,
    evidence: occurrence.evidence,
    semantics: occurrence.semantics,
  };
}

export function signalOccurrenceIdentity(occurrence: SignalOccurrence): string {
  return sha256Canonical(JSON.stringify(occurrenceContent(occurrence)));
}

export function serializeSignalEvaluation(evaluation: SignalEvaluation): string {
  const runtime = evaluation as unknown as Readonly<Record<string, unknown>>;
  if (
    runtime.schemaVersion !== SIGNAL_EVALUATION_SCHEMA_VERSION ||
    runtime.definitionVersion !== BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION
  ) {
    throw new SignalError('serialization_invalid');
  }
  if (signalEvaluationIdentity(evaluation) !== evaluation.evaluationId) {
    throw new SignalError('serialization_invalid');
  }
  if (
    evaluation.outcome === 'fired' &&
    signalOccurrenceIdentity(evaluation.occurrence) !== evaluation.occurrence.occurrenceId
  ) {
    throw new SignalError('serialization_invalid');
  }
  const content = evaluationContent(evaluation);
  return JSON.stringify(
    evaluation.outcome === 'fired'
      ? {
          ...content,
          evaluationId: evaluation.evaluationId,
          occurrence: {
            ...occurrenceContent(evaluation.occurrence),
            occurrenceId: evaluation.occurrence.occurrenceId,
          },
        }
      : { ...content, evaluationId: evaluation.evaluationId },
  );
}

function transitionContent(
  transition: SignalEvaluationTransition,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: transition.schemaVersion,
    kind: transition.kind,
    signalRunId: transition.signalRunId,
    triggeringRevisionId: transition.triggeringRevisionId,
    processingPosition: transition.processingPosition,
    currentEvaluationId: transition.currentEvaluationId,
    ...(transition.predecessorEvaluationId === undefined
      ? {}
      : { predecessorEvaluationId: transition.predecessorEvaluationId }),
    ...(transition.currentOccurrenceId === undefined
      ? {}
      : { currentOccurrenceId: transition.currentOccurrenceId }),
    ...(transition.retractedOccurrenceId === undefined
      ? {}
      : { retractedOccurrenceId: transition.retractedOccurrenceId }),
    latestRevisionState: transition.latestRevisionState,
  };
}

export function signalTransitionIdentity(transition: SignalEvaluationTransition): string {
  return sha256Canonical(JSON.stringify(transitionContent(transition)));
}

export function serializeSignalTransition(transition: SignalEvaluationTransition): string {
  const runtime = transition as unknown as Readonly<Record<string, unknown>>;
  if (runtime.schemaVersion !== SIGNAL_TRANSITION_SCHEMA_VERSION) {
    throw new SignalError('serialization_invalid');
  }
  if (signalTransitionIdentity(transition) !== transition.transitionId) {
    throw new SignalError('serialization_invalid');
  }
  return JSON.stringify({
    ...transitionContent(transition),
    transitionId: transition.transitionId,
  });
}
