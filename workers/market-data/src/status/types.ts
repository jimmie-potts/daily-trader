import type { Clock, ExactDecimal, UtcTimestamp, VenueCode } from '@daily-trader/domain';
import type {
  GapState,
  MarketDataConnectionState,
  MarketSessionCalendar,
  OneMinuteBarEvent,
  ProviderTimestamp,
  SupportedMarketDataSymbol,
} from '@daily-trader/market-data';

export type OperationalHealth = 'degraded' | 'healthy' | 'unavailable' | 'unknown';

export type MarketStatusConnectionState = MarketDataConnectionState | 'disconnected';

export interface LatestCanonicalMarketEvents {
  readonly AAPL: OneMinuteBarEvent | undefined;
  readonly SPY: OneMinuteBarEvent | undefined;
}

export interface MarketStatusRepositorySnapshot {
  readonly latest: LatestCanonicalMarketEvents;
  readonly redisDelivery: OperationalHealth;
  readonly postgresPersistence: OperationalHealth;
}

/** Read-only persistence boundary; implementations must return canonical events. */
export interface MarketStatusRepository {
  queryLatestMarketStatus(): Promise<MarketStatusRepositorySnapshot>;
}

export type PresentMarketDataFreshness =
  'fresh' | 'future' | 'outside_session' | 'stale' | 'unknown';

export type MissingMarketDataFreshness = 'no_data' | 'outside_session' | 'unknown';

export type StatusEntitlement = 'delayed' | 'real_time' | 'unknown';

export interface MarketStatusSourceRow {
  readonly provider: 'alpaca' | 'unknown';
  readonly feed: 'delayed_sip' | 'iex' | 'sip' | 'unknown';
  readonly entitlement: StatusEntitlement;
  readonly delayMilliseconds: number;
}

/**
 * Presentation-owned row. It intentionally permits delayed source metadata even
 * though the current canonical IEX event contract is fixed to real-time/zero delay.
 */
export interface PresentMarketStatusRow {
  readonly state: 'present';
  readonly symbol: SupportedMarketDataSymbol;
  readonly venue: VenueCode;
  readonly close: ExactDecimal;
  readonly currency: string;
  readonly priceUnit: string;
  readonly barStart: UtcTimestamp;
  readonly asOf: UtcTimestamp;
  readonly providerTimestamp: ProviderTimestamp;
  readonly receivedAt: UtcTimestamp;
  readonly ageMilliseconds: number;
  readonly freshness: PresentMarketDataFreshness;
  readonly arrival: 'late' | 'on_time';
  readonly source: MarketStatusSourceRow;
}

export interface MissingMarketStatusRow {
  readonly state: 'missing';
  readonly symbol: SupportedMarketDataSymbol;
  readonly venue: VenueCode;
  readonly freshness: MissingMarketDataFreshness;
}

export type MarketStatusRow = PresentMarketStatusRow | MissingMarketStatusRow;

export interface MarketStatusOverall {
  readonly connection: MarketStatusConnectionState;
  readonly lastSuccessfulEvent: UtcTimestamp | undefined;
  readonly gap: GapState;
  readonly redisDelivery: OperationalHealth;
  readonly postgresPersistence: OperationalHealth;
}

export interface MarketStatusModel {
  readonly observedAt: UtcTimestamp;
  readonly rows: readonly [MarketStatusRow, MarketStatusRow];
  readonly overall: MarketStatusOverall;
}

export interface BuildMarketStatusInput {
  readonly repository: MarketStatusRepositorySnapshot;
  readonly connection: MarketStatusConnectionState;
  readonly lastSuccessfulEvent: UtcTimestamp | undefined;
  readonly gap: GapState;
  readonly clock: Clock;
  readonly calendar?: MarketSessionCalendar;
  readonly freshnessThresholdMs?: number;
  /** Suppresses `fresh` for rows received before the latest reconnect began. */
  readonly freshnessNotBefore?: UtcTimestamp;
}
