import {
  CANONICAL_REVISION_SCHEMA_VERSION as MARKET_DATA_CANONICAL_REVISION_SCHEMA_VERSION,
  MARKET_DATA_QUALITY_POLICY_VERSION,
  MARKET_DATA_SCHEMA_VERSION,
  NYSE_CORE_SESSION_CALENDAR_VERSION,
  PHASE_2_INSTRUMENTS,
  PHASE_2_SYMBOLS,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';

import {
  SIGNAL_ARITHMETIC_POLICY_VERSION,
  compareSignalDecimals,
  createSignalDecimal,
  type SignalDecimal,
} from './arithmetic.js';
import { SignalError } from './errors.js';
import { requireIdentifier, sha256Canonical } from './identity.js';

export const SIGNAL_CONFIGURATION_SCHEMA_VERSION = 'daily-trader.signals.configuration.v1' as const;
export const CANONICAL_REVISION_SCHEMA_VERSION = MARKET_DATA_CANONICAL_REVISION_SCHEMA_VERSION;
export const FEATURE_RESULT_SCHEMA_VERSION = 'daily-trader.signals.feature-result.v1' as const;
export const SIGNAL_EVALUATION_SCHEMA_VERSION = 'daily-trader.signals.evaluation.v1' as const;
export const SIGNAL_TRANSITION_SCHEMA_VERSION = 'daily-trader.signals.transition.v1' as const;
export const BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION = 'breakout_plus_volume.v1' as const;
export const NYSE_CALENDAR_SNAPSHOT_VERSION = NYSE_CORE_SESSION_CALENDAR_VERSION;
export const DATA_QUALITY_POLICY_VERSION = MARKET_DATA_QUALITY_POLICY_VERSION;
export const MIN_LOOKBACK_BARS = 1;
export const MAX_LOOKBACK_BARS = 390;

const MIN_MULTIPLIER = createSignalDecimal('1');
const MAX_MULTIPLIER = createSignalDecimal('10');

export interface SignalConfigurationInput {
  readonly configurationVersion: unknown;
  readonly lookbackBars: unknown;
  readonly volumeMultiplier: unknown;
  readonly freshnessThresholdMs: unknown;
}

export interface SignalSemanticVersions {
  readonly marketEventSchemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
  readonly canonicalRevisionSchemaVersion: typeof CANONICAL_REVISION_SCHEMA_VERSION;
  readonly arithmeticPolicyVersion: typeof SIGNAL_ARITHMETIC_POLICY_VERSION;
  readonly calendarSnapshotVersion: typeof NYSE_CALENDAR_SNAPSHOT_VERSION;
  readonly dataQualityPolicyVersion: typeof DATA_QUALITY_POLICY_VERSION;
  readonly featureResultSchemaVersion: typeof FEATURE_RESULT_SCHEMA_VERSION;
  readonly evaluationSchemaVersion: typeof SIGNAL_EVALUATION_SCHEMA_VERSION;
  readonly signalDefinitionVersion: typeof BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION;
  readonly configurationVersion: string;
  readonly configurationHash: string;
}

export interface SignalConfiguration {
  readonly schemaVersion: typeof SIGNAL_CONFIGURATION_SCHEMA_VERSION;
  readonly signalDefinitionVersion: typeof BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION;
  readonly scope: readonly Readonly<{
    symbol: OneMinuteBarEvent['instrument']['symbol'];
    venue: OneMinuteBarEvent['instrument']['venue'];
    interval: '1m';
  }>[];
  readonly lookbackBars: number;
  readonly volumeMultiplier: SignalDecimal;
  readonly freshnessThresholdMs: number;
  readonly arithmeticPolicyVersion: typeof SIGNAL_ARITHMETIC_POLICY_VERSION;
  readonly calendarSnapshotVersion: typeof NYSE_CALENDAR_SNAPSHOT_VERSION;
  readonly configurationVersion: string;
  readonly configurationHash: string;
}

function configurationWithoutHash(input: {
  readonly lookbackBars: number;
  readonly volumeMultiplier: SignalDecimal;
  readonly freshnessThresholdMs: number;
  readonly configurationVersion: string;
}): Omit<SignalConfiguration, 'configurationHash'> {
  return {
    schemaVersion: SIGNAL_CONFIGURATION_SCHEMA_VERSION,
    signalDefinitionVersion: BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
    scope: Object.freeze(
      PHASE_2_SYMBOLS.map((symbol) =>
        Object.freeze({
          symbol: PHASE_2_INSTRUMENTS[symbol].symbol,
          venue: PHASE_2_INSTRUMENTS[symbol].venue,
          interval: '1m' as const,
        }),
      ),
    ),
    lookbackBars: input.lookbackBars,
    volumeMultiplier: input.volumeMultiplier,
    freshnessThresholdMs: input.freshnessThresholdMs,
    arithmeticPolicyVersion: SIGNAL_ARITHMETIC_POLICY_VERSION,
    calendarSnapshotVersion: NYSE_CALENDAR_SNAPSHOT_VERSION,
    configurationVersion: input.configurationVersion,
  };
}

export function createSignalConfiguration(input: SignalConfigurationInput): SignalConfiguration;
export function createSignalConfiguration(input: unknown): SignalConfiguration {
  if (typeof input !== 'object' || input === null) {
    throw new SignalError('configuration_invalid');
  }
  const record = input as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  if (
    keys.join(',') !== 'configurationVersion,freshnessThresholdMs,lookbackBars,volumeMultiplier'
  ) {
    throw new SignalError('configuration_invalid');
  }
  if (
    typeof record.lookbackBars !== 'number' ||
    !Number.isSafeInteger(record.lookbackBars) ||
    record.lookbackBars < MIN_LOOKBACK_BARS ||
    record.lookbackBars > MAX_LOOKBACK_BARS
  ) {
    throw new SignalError('configuration_invalid');
  }
  if (
    typeof record.freshnessThresholdMs !== 'number' ||
    !Number.isSafeInteger(record.freshnessThresholdMs) ||
    record.freshnessThresholdMs < 60_000 ||
    record.freshnessThresholdMs > 300_000
  ) {
    throw new SignalError('configuration_invalid');
  }
  let multiplier: SignalDecimal;
  try {
    multiplier = createSignalDecimal(record.volumeMultiplier);
  } catch {
    throw new SignalError('configuration_invalid');
  }
  if (
    compareSignalDecimals(multiplier, MIN_MULTIPLIER) < 0 ||
    compareSignalDecimals(multiplier, MAX_MULTIPLIER) > 0
  ) {
    throw new SignalError('configuration_invalid');
  }
  const configurationVersion = requireIdentifier(record.configurationVersion);
  const unsigned = configurationWithoutHash({
    lookbackBars: record.lookbackBars,
    volumeMultiplier: multiplier,
    freshnessThresholdMs: record.freshnessThresholdMs,
    configurationVersion,
  });
  const configurationHash = sha256Canonical(JSON.stringify(unsigned));
  return Object.freeze({ ...unsigned, configurationHash });
}

export function serializeSignalConfiguration(configuration: SignalConfiguration): string {
  const unsigned = configurationWithoutHash(configuration);
  const runtime = configuration as unknown as Readonly<Record<string, unknown>>;
  if (
    runtime.schemaVersion !== SIGNAL_CONFIGURATION_SCHEMA_VERSION ||
    runtime.signalDefinitionVersion !== BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION ||
    runtime.arithmeticPolicyVersion !== SIGNAL_ARITHMETIC_POLICY_VERSION ||
    runtime.calendarSnapshotVersion !== NYSE_CALENDAR_SNAPSHOT_VERSION ||
    JSON.stringify(configuration.scope) !== JSON.stringify(unsigned.scope)
  ) {
    throw new SignalError('configuration_invalid');
  }
  const expectedHash = sha256Canonical(JSON.stringify(unsigned));
  if (expectedHash !== configuration.configurationHash) {
    throw new SignalError('configuration_invalid');
  }
  return JSON.stringify({ ...unsigned, configurationHash: expectedHash });
}

export function semanticVersions(configuration: SignalConfiguration): SignalSemanticVersions {
  return Object.freeze({
    marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    canonicalRevisionSchemaVersion: CANONICAL_REVISION_SCHEMA_VERSION,
    arithmeticPolicyVersion: SIGNAL_ARITHMETIC_POLICY_VERSION,
    calendarSnapshotVersion: NYSE_CALENDAR_SNAPSHOT_VERSION,
    dataQualityPolicyVersion: DATA_QUALITY_POLICY_VERSION,
    featureResultSchemaVersion: FEATURE_RESULT_SCHEMA_VERSION,
    evaluationSchemaVersion: SIGNAL_EVALUATION_SCHEMA_VERSION,
    signalDefinitionVersion: BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
    configurationVersion: configuration.configurationVersion,
    configurationHash: configuration.configurationHash,
  });
}
