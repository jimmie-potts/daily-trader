import {
  NYSE_CORE_SESSION_CALENDAR,
  deserializeOneMinuteBarEvent,
  serializeOneMinuteBarEvent,
  utcEpochMilliseconds,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';

import {
  createSignalConfiguration,
  semanticVersions,
  serializeSignalConfiguration,
  type SignalConfiguration,
} from '../configuration.js';
import { SignalError } from '../errors.js';
import { sha256Canonical } from '../identity.js';
import {
  MAX_SIGNAL_REPLAY_CATALOG_EVENTS,
  MAX_SIGNAL_REPLAY_RECORDING_CHARACTERS,
  MAX_SIGNAL_REPLAY_SCHEDULE_ENTRIES,
  SIGNAL_REPLAY_CATALOG_VERSION,
  SIGNAL_REPLAY_MANIFEST_VERSION,
  SIGNAL_REPLAY_OUTPUT_VERSION,
  SIGNAL_REPLAY_RECORDING_VERSION,
  SIGNAL_REPLAY_SCHEDULE_VERSION,
  type SignalReplayCatalog,
  type SignalReplayManifest,
  type SignalReplayRecordingInput,
  type SignalReplaySchedule,
  type SignalReplaySourceMetadata,
  type VerifiedSignalReplayRecording,
} from './types.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const DESCRIPTION = /^[\x20-\x7e]{1,256}$/u;
const VERIFIED_RECORDINGS = new WeakSet<object>();

function replayError(): never {
  throw new SignalError('replay_invalid');
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) replayError();
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) replayError();
}

function requireChecksum(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) replayError();
  return value;
}

function eventObjects(events: readonly OneMinuteBarEvent[]): readonly unknown[] {
  return Object.freeze(
    events.map((event) => JSON.parse(serializeOneMinuteBarEvent(event)) as unknown),
  );
}

function catalogUnsigned(events: readonly OneMinuteBarEvent[]): Readonly<Record<string, unknown>> {
  return { version: SIGNAL_REPLAY_CATALOG_VERSION, events: eventObjects(events) };
}

function scheduleUnsigned(eventIds: readonly string[]): Readonly<Record<string, unknown>> {
  return {
    version: SIGNAL_REPLAY_SCHEDULE_VERSION,
    entries: eventIds.map((eventId, index) => ({ targetOrdinal: index + 1, eventId })),
  };
}

function sourceMetadata(description: string): SignalReplaySourceMetadata {
  if (!DESCRIPTION.test(description)) replayError();
  return Object.freeze({
    kind: 'synthetic_signal_scenario',
    description,
    containsRawProviderFrames: false,
    containsCredentials: false,
    containsDerivedOutputClaims: false,
  });
}

function sessionBounds(events: readonly OneMinuteBarEvent[]): { start: string; end: string } {
  if (events.length === 0) replayError();
  const first = events[0];
  if (first === undefined) replayError();
  let start = first.barStart;
  let end = first.barEnd;
  for (const event of events.slice(1)) {
    if (event.barStart < start) start = event.barStart;
    if (event.barEnd > end) end = event.barEnd;
  }
  return { start, end };
}

function manifestUnsigned(input: {
  readonly catalogChecksum: string;
  readonly scheduleChecksum: string;
  readonly expectedOutputChecksum: string;
  readonly configuration: SignalConfiguration;
  readonly metadata: SignalReplaySourceMetadata;
  readonly events: readonly OneMinuteBarEvent[];
  readonly scheduleCount: number;
}): Omit<SignalReplayManifest, 'checksum'> {
  const bounds = sessionBounds(input.events);
  return {
    version: SIGNAL_REPLAY_MANIFEST_VERSION,
    recordingVersion: SIGNAL_REPLAY_RECORDING_VERSION,
    catalogVersion: SIGNAL_REPLAY_CATALOG_VERSION,
    scheduleVersion: SIGNAL_REPLAY_SCHEDULE_VERSION,
    outputVersion: SIGNAL_REPLAY_OUTPUT_VERSION,
    catalogChecksum: input.catalogChecksum,
    scheduleChecksum: input.scheduleChecksum,
    expectedOutputChecksum: input.expectedOutputChecksum,
    configuration: input.configuration,
    semantics: semanticVersions(input.configuration),
    sourceMetadata: input.metadata,
    scope: Object.freeze([
      Object.freeze({ symbol: 'AAPL' as const, venue: 'XNAS' as const }),
      Object.freeze({ symbol: 'SPY' as const, venue: 'ARCX' as const }),
    ]),
    sessionStart: bounds.start,
    sessionEnd: bounds.end,
    catalogEventCount: input.events.length,
    scheduleEntryCount: input.scheduleCount,
  };
}

function canonicalRecording(input: {
  readonly manifest: Omit<SignalReplayManifest, 'checksum'>;
  readonly manifestChecksum: string;
  readonly catalog: Readonly<Record<string, unknown>>;
  readonly catalogChecksum: string;
  readonly schedule: Readonly<Record<string, unknown>>;
  readonly scheduleChecksum: string;
}): string {
  return `${JSON.stringify(
    {
      manifest: { ...input.manifest, checksum: input.manifestChecksum },
      catalog: { ...input.catalog, checksum: input.catalogChecksum },
      schedule: { ...input.schedule, checksum: input.scheduleChecksum },
    },
    null,
    2,
  )}\n`;
}

function validateCounts(eventCount: number, scheduleCount: number): void {
  if (
    !Number.isSafeInteger(eventCount) ||
    eventCount < 1 ||
    eventCount > MAX_SIGNAL_REPLAY_CATALOG_EVENTS ||
    !Number.isSafeInteger(scheduleCount) ||
    scheduleCount < 1 ||
    scheduleCount > MAX_SIGNAL_REPLAY_SCHEDULE_ENTRIES
  ) {
    replayError();
  }
}

function validateCatalog(events: readonly OneMinuteBarEvent[]): void {
  const eventIds = new Set<string>();
  const symbols = new Set<string>();
  let calendarDate: string | undefined;
  for (const event of events) {
    if (eventIds.has(event.eventId)) replayError();
    eventIds.add(event.eventId);
    symbols.add(event.instrument.symbol);
    const session = NYSE_CORE_SESSION_CALENDAR.classify(event.barStart);
    if (session.state !== 'open') replayError();
    calendarDate ??= session.calendarDate;
    if (session.calendarDate !== calendarDate) replayError();
  }
  if (!symbols.has('AAPL') || !symbols.has('SPY')) replayError();
}

function validateContiguousCoverage(
  events: readonly OneMinuteBarEvent[],
  configuration: SignalConfiguration,
): void {
  for (const symbol of ['AAPL', 'SPY'] as const) {
    const starts = [
      ...new Set(
        events
          .filter((event) => event.instrument.symbol === symbol)
          .map((event) => utcEpochMilliseconds(event.barStart)),
      ),
    ].sort((left, right) => left - right);
    let longest = 0;
    let current = 0;
    let previous: number | undefined;
    for (const start of starts) {
      current = previous !== undefined && start === previous + 60_000 ? current + 1 : 1;
      if (current > longest) longest = current;
      previous = start;
    }
    if (longest < configuration.lookbackBars + 1) replayError();
  }
}

function validateSchedule(events: readonly OneMinuteBarEvent[], ids: readonly string[]): void {
  if (ids.length === 0) replayError();
  const catalogIds = new Set(events.map(({ eventId }) => eventId));
  if (ids.some((eventId) => !catalogIds.has(eventId))) replayError();
  const referenced = new Set(ids);
  if ([...catalogIds].some((eventId) => !referenced.has(eventId))) replayError();
}

export function createSignalReplayRecording(input: SignalReplayRecordingInput): string {
  requireChecksum(input.expectedOutputChecksum);
  serializeSignalConfiguration(input.configuration);
  validateCounts(input.events.length, input.scheduleEventIds.length);
  const events = input.events.map((event) =>
    deserializeOneMinuteBarEvent(serializeOneMinuteBarEvent(event)),
  );
  validateCatalog(events);
  validateContiguousCoverage(events, input.configuration);
  validateSchedule(events, input.scheduleEventIds);
  const catalog = catalogUnsigned(events);
  const schedule = scheduleUnsigned(input.scheduleEventIds);
  const catalogChecksum = sha256Canonical(JSON.stringify(catalog));
  const scheduleChecksum = sha256Canonical(JSON.stringify(schedule));
  const manifest = manifestUnsigned({
    catalogChecksum,
    scheduleChecksum,
    expectedOutputChecksum: input.expectedOutputChecksum,
    configuration: input.configuration,
    metadata: sourceMetadata(input.sourceDescription),
    events,
    scheduleCount: input.scheduleEventIds.length,
  });
  const serialized = canonicalRecording({
    manifest,
    manifestChecksum: sha256Canonical(JSON.stringify(manifest)),
    catalog,
    catalogChecksum,
    schedule,
    scheduleChecksum,
  });
  if (serialized.length > MAX_SIGNAL_REPLAY_RECORDING_CHARACTERS) replayError();
  return serialized;
}

function parseConfiguration(value: unknown): SignalConfiguration {
  const candidate = record(value);
  exactKeys(candidate, [
    'schemaVersion',
    'signalDefinitionVersion',
    'scope',
    'lookbackBars',
    'volumeMultiplier',
    'freshnessThresholdMs',
    'arithmeticPolicyVersion',
    'calendarSnapshotVersion',
    'configurationVersion',
    'configurationHash',
  ]);
  let configuration: SignalConfiguration;
  try {
    configuration = createSignalConfiguration({
      configurationVersion: candidate.configurationVersion,
      lookbackBars: candidate.lookbackBars,
      volumeMultiplier: candidate.volumeMultiplier,
      freshnessThresholdMs: candidate.freshnessThresholdMs,
    });
  } catch {
    return replayError();
  }
  if (serializeSignalConfiguration(configuration) !== JSON.stringify(value)) replayError();
  return configuration;
}

export function verifySignalReplayRecording(
  serialized: unknown,
  expectedConfiguration: SignalConfiguration,
): VerifiedSignalReplayRecording {
  if (typeof serialized !== 'string') replayError();
  if (serialized.length > MAX_SIGNAL_REPLAY_RECORDING_CHARACTERS) replayError();
  let root: Readonly<Record<string, unknown>>;
  try {
    root = record(JSON.parse(serialized) as unknown);
  } catch {
    replayError();
  }
  exactKeys(root, ['manifest', 'catalog', 'schedule']);
  const catalogRecord = record(root.catalog);
  exactKeys(catalogRecord, ['version', 'checksum', 'events']);
  if (
    catalogRecord.version !== SIGNAL_REPLAY_CATALOG_VERSION ||
    !Array.isArray(catalogRecord.events) ||
    catalogRecord.events.length < 1 ||
    catalogRecord.events.length > MAX_SIGNAL_REPLAY_CATALOG_EVENTS
  )
    replayError();
  const events = catalogRecord.events.map((value) => {
    try {
      return deserializeOneMinuteBarEvent(JSON.stringify(value));
    } catch {
      return replayError();
    }
  });
  validateCatalog(events);
  const catalog = catalogUnsigned(events);
  const catalogChecksum = requireChecksum(catalogRecord.checksum);
  if (sha256Canonical(JSON.stringify(catalog)) !== catalogChecksum) replayError();

  const scheduleRecord = record(root.schedule);
  exactKeys(scheduleRecord, ['version', 'checksum', 'entries']);
  if (
    scheduleRecord.version !== SIGNAL_REPLAY_SCHEDULE_VERSION ||
    !Array.isArray(scheduleRecord.entries) ||
    scheduleRecord.entries.length < 1 ||
    scheduleRecord.entries.length > MAX_SIGNAL_REPLAY_SCHEDULE_ENTRIES
  )
    replayError();
  const scheduleIds = scheduleRecord.entries.map((value, index) => {
    const entry = record(value);
    exactKeys(entry, ['targetOrdinal', 'eventId']);
    if (entry.targetOrdinal !== index + 1 || typeof entry.eventId !== 'string') replayError();
    return entry.eventId;
  });
  validateSchedule(events, scheduleIds);
  const schedule = scheduleUnsigned(scheduleIds);
  const scheduleChecksum = requireChecksum(scheduleRecord.checksum);
  if (sha256Canonical(JSON.stringify(schedule)) !== scheduleChecksum) replayError();

  const manifestRecord = record(root.manifest);
  exactKeys(manifestRecord, [
    'version',
    'recordingVersion',
    'catalogVersion',
    'scheduleVersion',
    'outputVersion',
    'catalogChecksum',
    'scheduleChecksum',
    'expectedOutputChecksum',
    'configuration',
    'semantics',
    'sourceMetadata',
    'scope',
    'sessionStart',
    'sessionEnd',
    'catalogEventCount',
    'scheduleEntryCount',
    'checksum',
  ]);
  const configuration = parseConfiguration(manifestRecord.configuration);
  validateCounts(events.length, scheduleIds.length);
  validateContiguousCoverage(events, configuration);
  if (
    serializeSignalConfiguration(configuration) !==
    serializeSignalConfiguration(expectedConfiguration)
  ) {
    throw new SignalError('replay_configuration_mismatch');
  }
  const metadataRecord = record(manifestRecord.sourceMetadata);
  const metadata = sourceMetadata(
    typeof metadataRecord.description === 'string' ? metadataRecord.description : replayError(),
  );
  if (JSON.stringify(metadataRecord) !== JSON.stringify(metadata)) replayError();
  const manifest = manifestUnsigned({
    catalogChecksum,
    scheduleChecksum,
    expectedOutputChecksum: requireChecksum(manifestRecord.expectedOutputChecksum),
    configuration,
    metadata,
    events,
    scheduleCount: scheduleIds.length,
  });
  if (
    manifestRecord.version !== SIGNAL_REPLAY_MANIFEST_VERSION ||
    manifestRecord.recordingVersion !== SIGNAL_REPLAY_RECORDING_VERSION ||
    manifestRecord.catalogVersion !== SIGNAL_REPLAY_CATALOG_VERSION ||
    manifestRecord.scheduleVersion !== SIGNAL_REPLAY_SCHEDULE_VERSION ||
    manifestRecord.outputVersion !== SIGNAL_REPLAY_OUTPUT_VERSION ||
    manifestRecord.catalogChecksum !== catalogChecksum ||
    manifestRecord.scheduleChecksum !== scheduleChecksum ||
    manifestRecord.catalogEventCount !== events.length ||
    manifestRecord.scheduleEntryCount !== scheduleIds.length ||
    JSON.stringify(manifestRecord.semantics) !== JSON.stringify(semanticVersions(configuration)) ||
    JSON.stringify(manifestRecord.scope) !== JSON.stringify(manifest.scope) ||
    manifestRecord.sessionStart !== manifest.sessionStart ||
    manifestRecord.sessionEnd !== manifest.sessionEnd
  )
    replayError();
  const manifestChecksum = requireChecksum(manifestRecord.checksum);
  if (sha256Canonical(JSON.stringify(manifest)) !== manifestChecksum) replayError();
  const canonical = canonicalRecording({
    manifest,
    manifestChecksum,
    catalog,
    catalogChecksum,
    schedule,
    scheduleChecksum,
  });
  if (canonical !== serialized) replayError();
  const verifiedManifest: SignalReplayManifest = Object.freeze({
    ...manifest,
    checksum: manifestChecksum,
  });
  const verifiedCatalog = Object.freeze({
    version: SIGNAL_REPLAY_CATALOG_VERSION,
    checksum: catalogChecksum,
    events: Object.freeze(events),
  }) satisfies SignalReplayCatalog;
  const verifiedSchedule = Object.freeze({
    version: SIGNAL_REPLAY_SCHEDULE_VERSION,
    checksum: scheduleChecksum,
    entries: Object.freeze(
      scheduleIds.map((eventId, index) => Object.freeze({ targetOrdinal: index + 1, eventId })),
    ),
  }) satisfies SignalReplaySchedule;
  const verified = Object.freeze({
    manifest: verifiedManifest,
    catalog: verifiedCatalog,
    schedule: verifiedSchedule,
    serialized,
    inputChecksum: sha256Canonical(
      JSON.stringify({
        catalogChecksum,
        scheduleChecksum,
        configurationHash: configuration.configurationHash,
      }),
    ),
  });
  VERIFIED_RECORDINGS.add(verified);
  return verified;
}

export function isVerifiedSignalReplayRecording(
  value: unknown,
): value is VerifiedSignalReplayRecording {
  return typeof value === 'object' && value !== null && VERIFIED_RECORDINGS.has(value);
}
