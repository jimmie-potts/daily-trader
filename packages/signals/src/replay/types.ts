import type { OneMinuteBarEvent } from '@daily-trader/market-data';

import type { SignalConfiguration, SignalSemanticVersions } from '../configuration.js';
import type {
  FeatureResult,
  SignalEvaluation,
  SignalEvaluationTransition,
  SignalOccurrence,
} from '../contracts.js';

export const SIGNAL_REPLAY_CATALOG_VERSION = 'daily-trader.signals.replay-catalog.v1' as const;
export const SIGNAL_REPLAY_SCHEDULE_VERSION = 'daily-trader.signals.replay-schedule.v1' as const;
export const SIGNAL_REPLAY_MANIFEST_VERSION = 'daily-trader.signals.replay-manifest.v1' as const;
export const SIGNAL_REPLAY_RECORDING_VERSION = 'daily-trader.signals.replay-recording.v1' as const;
export const SIGNAL_REPLAY_OUTPUT_VERSION = 'daily-trader.signals.replay-output.v1' as const;

// One reviewed core-session scenario remains deliberately smaller than a backtest dataset.
export const MAX_SIGNAL_REPLAY_RECORDING_CHARACTERS = 4_194_304 as const;
export const MAX_SIGNAL_REPLAY_CATALOG_EVENTS = 2_048 as const;
export const MAX_SIGNAL_REPLAY_SCHEDULE_ENTRIES = 4_096 as const;
export const MAX_SIGNAL_REPLAY_ASSOCIATIONS = 100_000 as const;

export interface SignalReplayScheduleEntry {
  readonly targetOrdinal: number;
  readonly eventId: string;
}

export interface SignalReplayCatalog {
  readonly version: typeof SIGNAL_REPLAY_CATALOG_VERSION;
  readonly checksum: string;
  readonly events: readonly OneMinuteBarEvent[];
}

export interface SignalReplaySchedule {
  readonly version: typeof SIGNAL_REPLAY_SCHEDULE_VERSION;
  readonly checksum: string;
  readonly entries: readonly SignalReplayScheduleEntry[];
}

export interface SignalReplaySourceMetadata {
  readonly kind: 'synthetic_signal_scenario';
  readonly description: string;
  readonly containsRawProviderFrames: false;
  readonly containsCredentials: false;
  readonly containsDerivedOutputClaims: false;
}

export interface SignalReplayManifest {
  readonly version: typeof SIGNAL_REPLAY_MANIFEST_VERSION;
  readonly recordingVersion: typeof SIGNAL_REPLAY_RECORDING_VERSION;
  readonly catalogVersion: typeof SIGNAL_REPLAY_CATALOG_VERSION;
  readonly scheduleVersion: typeof SIGNAL_REPLAY_SCHEDULE_VERSION;
  readonly outputVersion: typeof SIGNAL_REPLAY_OUTPUT_VERSION;
  readonly catalogChecksum: string;
  readonly scheduleChecksum: string;
  readonly expectedOutputChecksum: string;
  readonly configuration: SignalConfiguration;
  readonly semantics: SignalSemanticVersions;
  readonly sourceMetadata: SignalReplaySourceMetadata;
  readonly scope: readonly Readonly<{ symbol: 'AAPL' | 'SPY'; venue: 'XNAS' | 'ARCX' }>[];
  readonly sessionStart: string;
  readonly sessionEnd: string;
  readonly catalogEventCount: number;
  readonly scheduleEntryCount: number;
  readonly checksum: string;
}

export interface VerifiedSignalReplayRecording {
  readonly manifest: SignalReplayManifest;
  readonly catalog: SignalReplayCatalog;
  readonly schedule: SignalReplaySchedule;
  readonly serialized: string;
  readonly inputChecksum: string;
}

export interface SignalReplayRecordingInput {
  readonly events: readonly OneMinuteBarEvent[];
  readonly scheduleEventIds: readonly string[];
  readonly configuration: SignalConfiguration;
  readonly expectedOutputChecksum: string;
  readonly sourceDescription: string;
}

export interface SignalReplayAssociation {
  readonly targetOrdinal: number;
  readonly scheduleOrdinal: number;
  readonly triggeringRevisionId: string;
  readonly evaluationBarKey: string;
  readonly featureResultId: string;
  readonly evaluationId: string;
  readonly outcome: SignalEvaluation['outcome'];
  readonly transitionKind: SignalEvaluationTransition['kind'];
  readonly occurrenceId?: string;
  readonly retractedOccurrenceId?: string;
}

export interface SignalReplayLatestEvaluation {
  readonly evaluationBarKey: string;
  readonly targetOrdinal: number;
  readonly evaluation: SignalEvaluation;
}

export interface SignalReplayActiveOccurrence {
  readonly evaluationBarKey: string;
  readonly targetOrdinal: number;
  readonly occurrence: SignalOccurrence;
}

export interface SignalReplayCanonicalOutput {
  readonly version: typeof SIGNAL_REPLAY_OUTPUT_VERSION;
  readonly targetId: string;
  readonly inputChecksum: string;
  readonly configurationHash: string;
  readonly catalogEventCount: number;
  readonly scheduleEntryCount: number;
  readonly processedScheduleEntryCount: number;
  readonly canonicalRevisionCount: number;
  readonly canonicalNoOpCount: number;
  readonly associations: readonly SignalReplayAssociation[];
  readonly latestEvaluations: readonly SignalReplayLatestEvaluation[];
  readonly activeFiredHistory: readonly SignalReplayActiveOccurrence[];
  readonly checksum: string;
}

export interface SignalReplayArtifact {
  readonly association: SignalReplayAssociation;
  readonly featureResult: FeatureResult;
  readonly evaluation: SignalEvaluation;
  readonly transition: SignalEvaluationTransition;
}

export interface SignalReplayProjection {
  readonly output: SignalReplayCanonicalOutput;
  readonly serializedOutput: string;
  readonly artifacts: readonly SignalReplayArtifact[];
}

export interface SignalReplayTargetDescriptor {
  readonly targetId: string;
  readonly inputChecksum: string;
  readonly configuration: SignalConfiguration;
  readonly manifest: SignalReplayManifest;
  readonly expectedAssociationCount: number;
  readonly expectedOutputChecksum: string;
  readonly outputVersion: typeof SIGNAL_REPLAY_OUTPUT_VERSION;
}

/** The worker owns transactions, idempotency, fencing, retry, and cleanup behind this port. */
export interface SignalReplayPersistencePort {
  beginTarget(target: SignalReplayTargetDescriptor): Promise<unknown>;
  persistAssociation(targetId: string, artifact: SignalReplayArtifact): Promise<unknown>;
  completeTarget(targetId: string, output: SignalReplayCanonicalOutput): Promise<unknown>;
  failTarget(targetId: string): Promise<unknown>;
}
