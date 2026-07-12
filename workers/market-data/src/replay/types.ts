import type {
  MARKET_DATA_DELAY_MILLISECONDS,
  MARKET_DATA_ENTITLEMENT,
  MARKET_DATA_FEED,
  MARKET_DATA_PROVIDER,
  MARKET_DATA_SCHEMA_VERSION,
  OneMinuteBarEvent,
} from '@daily-trader/market-data';

export const PORTABLE_RECORDING_FORMAT_VERSION = 'daily-trader.market-data.recording.v1' as const;

export type RecordingSourceKind = 'normalized_ledger' | 'synthetic_fixture';

export interface RecordingSourceMetadata {
  readonly kind: RecordingSourceKind;
  readonly description: string;
  readonly containsRawProviderFrames: false;
}

export interface RecordingInstrument {
  readonly symbol: 'AAPL' | 'SPY';
  readonly venue: 'ARCX' | 'XNAS';
}

export interface PortableRecordingManifest {
  readonly formatVersion: typeof PORTABLE_RECORDING_FORMAT_VERSION;
  readonly eventSchemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
  readonly sourceSessionId: string;
  readonly instruments: readonly [
    Readonly<{ symbol: 'AAPL'; venue: 'XNAS' }>,
    Readonly<{ symbol: 'SPY'; venue: 'ARCX' }>,
  ];
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
  readonly checksum: string;
}

export interface VerifiedRecordingEvent {
  readonly event: OneMinuteBarEvent;
  readonly canonicalJson: string;
}

declare const verifiedRecordingBrand: unique symbol;

export interface VerifiedMarketDataRecording {
  readonly manifest: PortableRecordingManifest;
  readonly events: readonly VerifiedRecordingEvent[];
  readonly [verifiedRecordingBrand]: true;
}

export interface CanonicalEventLedgerReader {
  readCanonicalEvents(sourceSessionId: string): Promise<readonly string[]>;
}

export interface ExportRecordingRequest {
  readonly sourceSessionId: string;
  readonly configurationVersion: string;
  readonly freshnessThresholdMs: number;
  readonly sourceMetadata: RecordingSourceMetadata;
}

export interface ReplayPublishableMarketDataEvent {
  readonly schemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
  readonly eventId: string;
  readonly orderingKey: string;
  readonly canonicalJson: string;
}

export interface ReplayMarketDataSink {
  publish(targetSessionId: string, event: ReplayPublishableMarketDataEvent): Promise<unknown>;
}

export type ReplayPacing =
  | Readonly<{ mode: 'unpaced' }>
  | Readonly<{
      mode: 'paced';
      speed: number;
      sleep(delayMilliseconds: number): Promise<void>;
    }>;

export interface ReplayResult {
  readonly targetSessionId: string;
  readonly publishedEventCount: number;
  readonly eventIds: readonly string[];
}
