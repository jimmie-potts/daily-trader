import {
  MARKET_DATA_DELAY_MILLISECONDS,
  MARKET_DATA_ENTITLEMENT,
  MARKET_DATA_FEED,
  MARKET_DATA_PROVIDER,
  MARKET_DATA_SCHEMA_VERSION,
  deserializeOneMinuteBarEvent,
  serializeOneMinuteBarEvent,
  utcEpochMilliseconds,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import { createHash } from 'node:crypto';

import { MarketDataRecordingError } from './errors.js';
import {
  PORTABLE_RECORDING_FORMAT_VERSION,
  type CanonicalEventLedgerReader,
  type ExportRecordingRequest,
  type PortableRecordingManifest,
  type RecordingSourceMetadata,
  type VerifiedMarketDataRecording,
  type VerifiedRecordingEvent,
} from './types.js';

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CHECKSUM = /^[a-f0-9]{64}$/u;
const DESCRIPTION = /^[\x20-\x7e]{1,256}$/u;
const EVENT_ID = /^[a-f0-9]{64}$/u;
const MIN_FRESHNESS_THRESHOLD_MS = 60_000;
const MAX_FRESHNESS_THRESHOLD_MS = 300_000;

const INSTRUMENTS = Object.freeze([
  Object.freeze({ symbol: 'AAPL' as const, venue: 'XNAS' as const }),
  Object.freeze({ symbol: 'SPY' as const, venue: 'ARCX' as const }),
] as const);

const VERIFIED_RECORDING = Symbol('verified-market-data-recording');

interface ManifestWithoutChecksum {
  readonly formatVersion: typeof PORTABLE_RECORDING_FORMAT_VERSION;
  readonly eventSchemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
  readonly sourceSessionId: string;
  readonly instruments: typeof INSTRUMENTS;
  readonly provider: typeof MARKET_DATA_PROVIDER;
  readonly feed: typeof MARKET_DATA_FEED;
  readonly entitlement: typeof MARKET_DATA_ENTITLEMENT;
  readonly delayMilliseconds: typeof MARKET_DATA_DELAY_MILLISECONDS;
  readonly sessionStart: string;
  readonly sessionEnd: string;
  readonly eventCount: number;
  readonly configurationVersion: string;
  readonly freshnessThresholdMs: number;
  readonly sourceMetadata: RecordingSourceMetadata;
}

interface EventSetAnalysis {
  readonly events: readonly VerifiedRecordingEvent[];
  readonly eventObjects: readonly unknown[];
  readonly sessionStart: string;
  readonly sessionEnd: string;
}

function record(
  value: unknown,
  code: 'manifest_invalid' | 'recording_malformed',
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MarketDataRecordingError(code);
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, code: 'manifest_invalid' | 'recording_malformed'): string {
  if (typeof value !== 'string') {
    throw new MarketDataRecordingError(code);
  }
  return value;
}

function validateIdentifier(value: unknown): string {
  const identifier = string(value, 'manifest_invalid');
  if (!IDENTIFIER.test(identifier)) {
    throw new MarketDataRecordingError('manifest_invalid');
  }
  return identifier;
}

function validateSourceMetadata(value: unknown): RecordingSourceMetadata {
  const metadata = record(value, 'manifest_invalid');
  if (
    (metadata.kind !== 'normalized_ledger' && metadata.kind !== 'synthetic_fixture') ||
    typeof metadata.description !== 'string' ||
    !DESCRIPTION.test(metadata.description) ||
    metadata.containsRawProviderFrames !== false ||
    Object.keys(metadata).length !== 3
  ) {
    throw new MarketDataRecordingError('manifest_invalid');
  }
  return Object.freeze({
    kind: metadata.kind,
    description: metadata.description,
    containsRawProviderFrames: false,
  });
}

function validateFreshnessThreshold(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== 'number' ||
    value < MIN_FRESHNESS_THRESHOLD_MS ||
    value > MAX_FRESHNESS_THRESHOLD_MS
  ) {
    throw new MarketDataRecordingError('manifest_invalid');
  }
  return value;
}

function validateManifestScope(manifest: Readonly<Record<string, unknown>>): void {
  if (
    manifest.provider !== MARKET_DATA_PROVIDER ||
    manifest.feed !== MARKET_DATA_FEED ||
    manifest.entitlement !== MARKET_DATA_ENTITLEMENT ||
    manifest.delayMilliseconds !== MARKET_DATA_DELAY_MILLISECONDS ||
    !Array.isArray(manifest.instruments) ||
    manifest.instruments.length !== 2
  ) {
    throw new MarketDataRecordingError('scope_unsupported');
  }
  const first = record(manifest.instruments[0], 'manifest_invalid');
  const second = record(manifest.instruments[1], 'manifest_invalid');
  if (
    first.symbol !== 'AAPL' ||
    first.venue !== 'XNAS' ||
    Object.keys(first).length !== 2 ||
    second.symbol !== 'SPY' ||
    second.venue !== 'ARCX' ||
    Object.keys(second).length !== 2
  ) {
    throw new MarketDataRecordingError('scope_unsupported');
  }
}

function sourceMetadataObject(metadata: RecordingSourceMetadata): RecordingSourceMetadata {
  return {
    kind: metadata.kind,
    description: metadata.description,
    containsRawProviderFrames: false,
  };
}

function manifestWithoutChecksum(input: {
  readonly sourceSessionId: string;
  readonly sessionStart: string;
  readonly sessionEnd: string;
  readonly eventCount: number;
  readonly configurationVersion: string;
  readonly freshnessThresholdMs: number;
  readonly sourceMetadata: RecordingSourceMetadata;
}): ManifestWithoutChecksum {
  return {
    formatVersion: PORTABLE_RECORDING_FORMAT_VERSION,
    eventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    sourceSessionId: input.sourceSessionId,
    instruments: INSTRUMENTS,
    provider: MARKET_DATA_PROVIDER,
    feed: MARKET_DATA_FEED,
    entitlement: MARKET_DATA_ENTITLEMENT,
    delayMilliseconds: MARKET_DATA_DELAY_MILLISECONDS,
    sessionStart: input.sessionStart,
    sessionEnd: input.sessionEnd,
    eventCount: input.eventCount,
    configurationVersion: input.configurationVersion,
    freshnessThresholdMs: input.freshnessThresholdMs,
    sourceMetadata: sourceMetadataObject(input.sourceMetadata),
  };
}

function unsignedCanonicalJson(
  manifest: ManifestWithoutChecksum,
  eventObjects: readonly unknown[],
): string {
  return `${canonicalPrettyJson({ manifest, events: eventObjects })}\n`;
}

function canonicalPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(
      /^(\s*)\{\n\s+"symbol": "(AAPL|SPY)",\n\s+"venue": "(XNAS|ARCX)"\n\s+\}/gmu,
      '$1{ "symbol": "$2", "venue": "$3" }',
    )
    .replace(
      /"instrument": \{\n\s+"symbol": "(AAPL|SPY)",\n\s+"venue": "(XNAS|ARCX)"\n\s+\}/gu,
      '"instrument": { "symbol": "$1", "venue": "$2" }',
    );
}

function recordingChecksum(
  manifest: ManifestWithoutChecksum,
  eventObjects: readonly unknown[],
): string {
  return createHash('sha256')
    .update(unsignedCanonicalJson(manifest, eventObjects), 'utf8')
    .digest('hex');
}

function canonicalRecordingJson(
  manifest: ManifestWithoutChecksum,
  checksum: string,
  eventObjects: readonly unknown[],
): string {
  return `${canonicalPrettyJson({
    manifest: {
      ...manifest,
      checksum,
    },
    events: eventObjects,
  })}\n`;
}

function supportedEventScope(value: Readonly<Record<string, unknown>>): void {
  if (value.schemaVersion !== MARKET_DATA_SCHEMA_VERSION) {
    throw new MarketDataRecordingError('event_schema_unsupported');
  }
  const instrument = record(value.instrument, 'recording_malformed');
  const supported =
    (instrument.symbol === 'AAPL' && instrument.venue === 'XNAS') ||
    (instrument.symbol === 'SPY' && instrument.venue === 'ARCX');
  if (!supported) {
    throw new MarketDataRecordingError('scope_unsupported');
  }
}

function decodeCanonicalEvent(value: unknown): VerifiedRecordingEvent {
  const eventObject = record(value, 'recording_malformed');
  supportedEventScope(eventObject);
  const canonicalJson = JSON.stringify(eventObject);
  let event: OneMinuteBarEvent;
  try {
    event = deserializeOneMinuteBarEvent(canonicalJson);
  } catch {
    throw new MarketDataRecordingError('event_noncanonical');
  }
  if (serializeOneMinuteBarEvent(event) !== canonicalJson) {
    throw new MarketDataRecordingError('event_noncanonical');
  }
  return Object.freeze({ event, canonicalJson });
}

function analyzeEvents(values: readonly unknown[]): EventSetAnalysis {
  if (values.length === 0) {
    throw new MarketDataRecordingError('incomplete_scope');
  }
  const events: VerifiedRecordingEvent[] = [];
  const eventObjects: unknown[] = [];
  const eventIds = new Set<string>();
  const symbols = new Set<string>();
  let startEpoch = Number.POSITIVE_INFINITY;
  let endEpoch = Number.NEGATIVE_INFINITY;
  let sessionStart = '';
  let sessionEnd = '';

  for (const value of values) {
    const decoded = decodeCanonicalEvent(value);
    if (!EVENT_ID.test(decoded.event.eventId) || eventIds.has(decoded.event.eventId)) {
      throw new MarketDataRecordingError('duplicate_event');
    }
    eventIds.add(decoded.event.eventId);
    symbols.add(decoded.event.instrument.symbol);
    const eventStart = utcEpochMilliseconds(decoded.event.barStart);
    const eventEnd = utcEpochMilliseconds(decoded.event.barEnd);
    if (eventStart < startEpoch) {
      startEpoch = eventStart;
      sessionStart = decoded.event.barStart;
    }
    if (eventEnd > endEpoch) {
      endEpoch = eventEnd;
      sessionEnd = decoded.event.barEnd;
    }
    events.push(decoded);
    eventObjects.push(value);
  }

  if (!symbols.has('AAPL') || !symbols.has('SPY')) {
    throw new MarketDataRecordingError('incomplete_scope');
  }
  return Object.freeze({
    events: Object.freeze(events),
    eventObjects: Object.freeze(eventObjects),
    sessionStart,
    sessionEnd,
  });
}

function parseManifest(value: unknown): {
  readonly manifest: PortableRecordingManifest;
  readonly unsigned: ManifestWithoutChecksum;
} {
  const input = record(value, 'manifest_invalid');
  if (input.formatVersion !== PORTABLE_RECORDING_FORMAT_VERSION) {
    throw new MarketDataRecordingError('format_unsupported');
  }
  if (input.eventSchemaVersion !== MARKET_DATA_SCHEMA_VERSION) {
    throw new MarketDataRecordingError('event_schema_unsupported');
  }
  validateManifestScope(input);
  const sourceSessionId = validateIdentifier(input.sourceSessionId);
  const configurationVersion = validateIdentifier(input.configurationVersion);
  const freshnessThresholdMs = validateFreshnessThreshold(input.freshnessThresholdMs);
  const sessionStart = string(input.sessionStart, 'manifest_invalid');
  const sessionEnd = string(input.sessionEnd, 'manifest_invalid');
  if (!Number.isSafeInteger(input.eventCount) || Number(input.eventCount) < 1) {
    throw new MarketDataRecordingError('manifest_invalid');
  }
  const sourceMetadata = validateSourceMetadata(input.sourceMetadata);
  const checksum = string(input.checksum, 'manifest_invalid');
  if (!CHECKSUM.test(checksum)) {
    throw new MarketDataRecordingError('manifest_invalid');
  }

  const unsigned = manifestWithoutChecksum({
    sourceSessionId,
    sessionStart,
    sessionEnd,
    eventCount: Number(input.eventCount),
    configurationVersion,
    freshnessThresholdMs,
    sourceMetadata,
  });
  const manifest: PortableRecordingManifest = Object.freeze({
    ...unsigned,
    sourceMetadata,
    checksum,
  });
  return Object.freeze({ manifest, unsigned });
}

export async function exportPortableRecording(
  reader: CanonicalEventLedgerReader,
  request: ExportRecordingRequest,
): Promise<string> {
  const sourceSessionId = validateIdentifier(request.sourceSessionId);
  const configurationVersion = validateIdentifier(request.configurationVersion);
  const freshnessThresholdMs = validateFreshnessThreshold(request.freshnessThresholdMs);
  const sourceMetadata = validateSourceMetadata(request.sourceMetadata);
  let canonicalEvents: readonly string[];
  try {
    canonicalEvents = await reader.readCanonicalEvents(sourceSessionId);
  } catch {
    throw new MarketDataRecordingError('reader_failed');
  }
  if (!Array.isArray(canonicalEvents)) {
    throw new MarketDataRecordingError('reader_failed');
  }

  const eventObjects = canonicalEvents.map((canonicalJson) => {
    if (typeof canonicalJson !== 'string') {
      throw new MarketDataRecordingError('event_noncanonical');
    }
    try {
      const event = deserializeOneMinuteBarEvent(canonicalJson);
      if (serializeOneMinuteBarEvent(event) !== canonicalJson) {
        throw new MarketDataRecordingError('event_noncanonical');
      }
      return JSON.parse(canonicalJson) as unknown;
    } catch (error) {
      if (error instanceof MarketDataRecordingError) {
        throw error;
      }
      throw new MarketDataRecordingError('event_noncanonical');
    }
  });
  const analysis = analyzeEvents(eventObjects);
  const unsigned = manifestWithoutChecksum({
    sourceSessionId,
    sessionStart: analysis.sessionStart,
    sessionEnd: analysis.sessionEnd,
    eventCount: analysis.events.length,
    configurationVersion,
    freshnessThresholdMs,
    sourceMetadata,
  });
  const checksum = recordingChecksum(unsigned, analysis.eventObjects);
  const recording = canonicalRecordingJson(unsigned, checksum, analysis.eventObjects);
  verifyPortableRecording(recording);
  return recording;
}

export function verifyPortableRecording(serialized: unknown): VerifiedMarketDataRecording {
  if (typeof serialized !== 'string') {
    throw new MarketDataRecordingError('recording_malformed');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    throw new MarketDataRecordingError('recording_malformed');
  }
  const root = record(decoded, 'recording_malformed');
  if (!Array.isArray(root.events)) {
    throw new MarketDataRecordingError('recording_malformed');
  }
  const { manifest, unsigned } = parseManifest(root.manifest);
  if (root.events.length !== manifest.eventCount) {
    throw new MarketDataRecordingError('count_mismatch');
  }
  const analysis = analyzeEvents(root.events);
  if (
    analysis.sessionStart !== manifest.sessionStart ||
    analysis.sessionEnd !== manifest.sessionEnd
  ) {
    throw new MarketDataRecordingError('bounds_mismatch');
  }
  const checksum = recordingChecksum(unsigned, analysis.eventObjects);
  if (checksum !== manifest.checksum) {
    throw new MarketDataRecordingError('checksum_mismatch');
  }
  if (canonicalRecordingJson(unsigned, checksum, analysis.eventObjects) !== serialized) {
    throw new MarketDataRecordingError('recording_noncanonical');
  }

  return Object.freeze({
    manifest,
    events: analysis.events,
    [VERIFIED_RECORDING]: true,
  }) as unknown as VerifiedMarketDataRecording;
}

export function isVerifiedMarketDataRecording(value: VerifiedMarketDataRecording): boolean {
  return (value as unknown as Readonly<Record<PropertyKey, unknown>>)[VERIFIED_RECORDING] === true;
}
