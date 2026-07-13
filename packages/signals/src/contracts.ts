import type { ExactDecimal, InstrumentId, UtcTimestamp } from '@daily-trader/domain';
import type { MarketDataSource } from '@daily-trader/market-data';

import type { SignalDecimal } from './arithmetic.js';
import type {
  BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
  FEATURE_RESULT_SCHEMA_VERSION,
  SIGNAL_EVALUATION_SCHEMA_VERSION,
  SIGNAL_TRANSITION_SCHEMA_VERSION,
  SignalSemanticVersions,
} from './configuration.js';

export type SignalEvaluationMode = 'on_time' | 'retrospective';

export type FeatureSuppressionReason =
  | 'arithmetic_overflow'
  | 'future_evaluation_bar'
  | 'insufficient_warmup'
  | 'missing_interval'
  | 'unusable_volume_baseline';

export interface SignalEvaluationBar {
  readonly eventId: string;
  readonly barStart: UtcTimestamp;
  readonly barEnd: UtcTimestamp;
  readonly receivedAt: UtcTimestamp;
  readonly close: ExactDecimal;
  readonly volume: ExactDecimal;
}

export interface SignalEvidenceReference {
  readonly role: 'evaluation_bar' | 'reference_bar';
  readonly ordinal: number;
  readonly eventId: string;
  readonly barStart: UtcTimestamp;
  readonly receivedAt: UtcTimestamp;
}

export interface SignalUnits {
  readonly currency: 'USD';
  readonly price: 'USD/share';
  readonly volume: 'share';
}

interface FeatureResultBase {
  readonly schemaVersion: typeof FEATURE_RESULT_SCHEMA_VERSION;
  readonly definitionVersion: typeof BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION;
  readonly featureResultId: string;
  readonly instrument: InstrumentId;
  readonly evaluationBar: SignalEvaluationBar;
  readonly observationAsOf: UtcTimestamp;
  readonly knowledgeAsOf: UtcTimestamp;
  readonly mode: SignalEvaluationMode;
  readonly source: MarketDataSource;
  readonly units: SignalUnits;
  readonly evidence: readonly SignalEvidenceReference[];
  readonly semantics: SignalSemanticVersions;
}

export interface ReadyFeatureResult extends FeatureResultBase {
  readonly kind: 'ready';
  readonly priorRange: Readonly<{
    high: SignalDecimal;
    low: SignalDecimal;
  }>;
  readonly priorVolume: Readonly<{
    sum: SignalDecimal;
    count: number;
  }>;
  readonly window: Readonly<{
    firstBarStart: UtcTimestamp;
    lastBarStart: UtcTimestamp;
    count: number;
  }>;
}

export interface SuppressedFeatureResult extends FeatureResultBase {
  readonly kind: 'suppressed';
  readonly reason: FeatureSuppressionReason;
}

export type FeatureResult = ReadyFeatureResult | SuppressedFeatureResult;

export interface VolumeComparisonEvidence {
  readonly currentVolume: SignalDecimal;
  readonly priorVolumeSum: SignalDecimal;
  readonly priorCount: number;
  readonly multiplier: SignalDecimal;
  readonly leftProduct: SignalDecimal;
  readonly rightProduct: SignalDecimal;
  readonly operator: 'greater_than_or_equal';
  readonly confirmed: boolean;
}

export type BreakoutDirection = 'upward' | 'downward';

export interface SignalInvalidationCondition {
  readonly kind: 'close_returns_inside_prior_range';
  readonly operator: 'less_than_or_equal' | 'greater_than_or_equal';
  readonly reference: SignalDecimal;
}

export interface SignalOccurrence {
  readonly occurrenceId: string;
  readonly evaluationId: string;
  readonly definitionVersion: typeof BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION;
  readonly direction: BreakoutDirection;
  readonly reason:
    'upward_breakout_with_confirmed_volume' | 'downward_breakout_with_confirmed_volume';
  readonly observedClose: SignalDecimal;
  readonly observedVolume: SignalDecimal;
  readonly breakoutReference: SignalDecimal;
  readonly volumeComparison: VolumeComparisonEvidence;
  readonly invalidationCondition: SignalInvalidationCondition;
  readonly instrument: InstrumentId;
  readonly evaluationBar: SignalEvaluationBar;
  readonly observationAsOf: UtcTimestamp;
  readonly knowledgeAsOf: UtcTimestamp;
  readonly mode: SignalEvaluationMode;
  readonly source: MarketDataSource;
  readonly units: SignalUnits;
  readonly evidence: readonly SignalEvidenceReference[];
  readonly semantics: SignalSemanticVersions;
}

interface SignalEvaluationBase {
  readonly schemaVersion: typeof SIGNAL_EVALUATION_SCHEMA_VERSION;
  readonly definitionVersion: typeof BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION;
  readonly evaluationId: string;
  readonly featureResult: FeatureResult;
}

export interface SuppressedSignalEvaluation extends SignalEvaluationBase {
  readonly outcome: 'suppressed';
  readonly reason: FeatureSuppressionReason;
}

export interface NotFiredSignalEvaluation extends SignalEvaluationBase {
  readonly outcome: 'not_fired';
  readonly reason: 'price_not_breakout' | 'volume_not_confirmed';
  readonly breakoutDirection: BreakoutDirection | 'none';
  readonly volumeComparison: VolumeComparisonEvidence;
}

export interface FiredSignalEvaluation extends SignalEvaluationBase {
  readonly outcome: 'fired';
  readonly direction: BreakoutDirection;
  readonly volumeComparison: VolumeComparisonEvidence;
  readonly occurrence: SignalOccurrence;
}

export type SignalEvaluation =
  SuppressedSignalEvaluation | NotFiredSignalEvaluation | FiredSignalEvaluation;

export type SignalTransitionKind = 'initial' | 'supersession' | 'retraction';

/** Run-scoped history; operational ordering is intentionally absent from global identities. */
export interface SignalEvaluationTransition {
  readonly schemaVersion: typeof SIGNAL_TRANSITION_SCHEMA_VERSION;
  readonly transitionId: string;
  readonly kind: SignalTransitionKind;
  readonly signalRunId: string;
  readonly triggeringRevisionId: string;
  readonly processingPosition: string;
  readonly currentEvaluationId: string;
  readonly predecessorEvaluationId?: string;
  readonly currentOccurrenceId?: string;
  readonly retractedOccurrenceId?: string;
  readonly latestRevisionState: 'current' | 'superseded' | 'retracted';
}

export interface CanonicalRevisionSignalPort {
  loadCanonicalBootstrap(): Promise<readonly unknown[]>;
  readRevisionsAfter(processingPosition: string, limit: number): Promise<readonly unknown[]>;
}

/** Compile-time assertion that exact values in evidence remain string-backed. */
export type ExactSignalValue = ExactDecimal;
