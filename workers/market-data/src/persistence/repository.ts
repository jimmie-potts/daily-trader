import { createUtcTimestamp, type UtcTimestamp } from '@daily-trader/domain';
import {
  CANONICAL_REVISION_SCHEMA_VERSION,
  MARKET_DATA_ENTITLEMENT,
  MARKET_DATA_FEED,
  FRESHNESS_THRESHOLD_MS,
  MARKET_DATA_PROVIDER,
  MARKET_DATA_QUALITY_POLICY_VERSION,
  MARKET_DATA_SCHEMA_VERSION,
  NYSE_CORE_SESSION_CALENDAR,
  PHASE_2_SYMBOLS,
  MarketDataValidationError,
  addUtcMilliseconds,
  assessIntervalGap,
  classifyMarketDataFreshness,
  createCanonicalRevision,
  decideCanonicalTransition,
  deserializeOneMinuteBarEvent,
  isLateArrival,
  serializeOneMinuteBarEvent,
  utcEpochMilliseconds,
  type EventOrderingClassification,
  type GapAssessment,
  type GapState,
  type MarketDataFreshness,
  type MarketSessionCalendar,
  type OneMinuteBarEvent,
  type SupportedMarketDataSymbol,
} from '@daily-trader/market-data';

export type SqlRow = Readonly<Record<string, unknown>>;

export interface SqlQueryResult<Row extends SqlRow = SqlRow> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface SqlQueryable {
  query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface SqlPoolClient extends SqlQueryable {
  release(): void;
}

export interface SqlPool extends SqlQueryable {
  connect(): Promise<SqlPoolClient>;
  end(): Promise<void>;
  destroy(): Promise<void>;
}

export type IngestionSessionMode = 'fixture' | 'paper' | 'replay';

export interface CreateIngestionSessionInput {
  readonly sessionId: string;
  readonly mode: IngestionSessionMode;
  readonly configurationVersion: string;
  readonly startedAt: UtcTimestamp;
}

export interface MarketDataRepositoryOptions {
  readonly calendar?: MarketSessionCalendar;
  readonly freshnessThresholdMs?: number;
  readonly writerCapabilityLeaseMs?: number;
  readonly monotonicNow?: () => number;
  readonly onCanonicalRevisionTiming?: (timing: CanonicalRevisionTiming) => void;
}

export interface CanonicalRevisionTiming {
  readonly counterLockWaitMs: number;
  readonly transactionDurationMs: number;
}

export interface ReplayIngestionSessionState {
  readonly open: boolean;
}

export interface PersistMarketDataEntry {
  readonly sessionId: string;
  readonly eventId: string;
  readonly orderingKey: string;
  readonly schemaVersion: string;
  readonly eventJson: string;
}

export type PersistedArrivalClassification = Exclude<EventOrderingClassification, 'duplicate'>;
export type PersistedTimeliness = 'fresh' | 'late' | 'outside_session' | 'unknown';

export interface PersistMarketDataResult {
  readonly event: OneMinuteBarEvent;
  readonly classification: EventOrderingClassification;
  readonly timeliness: PersistedTimeliness;
  readonly gapState: GapState;
  readonly canonicalized: boolean;
}

export interface LatestPersistedBar {
  readonly event: OneMinuteBarEvent;
  readonly arrivalClassification: PersistedArrivalClassification;
  readonly timeliness: PersistedTimeliness;
  readonly gapState: GapState;
  readonly freshness: MarketDataFreshness;
  readonly current: boolean;
}

export type MarketDataPersistenceErrorCode =
  | 'capacity_exceeded'
  | 'connection_failed'
  | 'entry_invalid'
  | 'query_failed'
  | 'rollback_failed'
  | 'session_invalid'
  | 'session_not_open'
  | 'shutdown_failed'
  | 'stored_data_invalid'
  | 'writer_contract_unavailable';

export class MarketDataPersistenceError extends Error {
  public readonly code: MarketDataPersistenceErrorCode;

  public constructor(code: MarketDataPersistenceErrorCode) {
    super(`Market-data persistence failed: ${code}`);
    this.name = 'MarketDataPersistenceError';
    this.code = code;
  }
}

const SESSION_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CONFIGURATION_VERSION = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const EVENT_ID = /^[0-9a-f]{64}$/u;
const NONNEGATIVE_INTEGER_TEXT = /^(?:0|[1-9][0-9]*)$/u;
const WRITER_CAPABILITY_LOCK_KEYS = Object.freeze(['XNAS:AAPL|1m', 'ARCX:SPY|1m']);
const DEFAULT_WRITER_CAPABILITY_LEASE_MS = 90_000;
const MINIMUM_WRITER_CAPABILITY_LEASE_MS = 3_000;
const MAXIMUM_WRITER_CAPABILITY_LEASE_MS = 900_000;

const CREATE_SESSION_SQL = `
  /* market-data:create-session */
  INSERT INTO market_data_ingestion_sessions (
    session_id,
    mode,
    provider,
    feed,
    entitlement,
    configuration_version,
    freshness_threshold_ms,
    started_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

const ENSURE_REPLAY_SESSION_SQL = `
  /* market-data:ensure-replay-session */
  INSERT INTO market_data_ingestion_sessions (
    session_id,
    mode,
    provider,
    feed,
    entitlement,
    configuration_version,
    freshness_threshold_ms,
    started_at
  ) VALUES ($1, 'replay', $2, $3, $4, $5, $6, $7)
  ON CONFLICT (session_id) DO NOTHING
`;

const SELECT_REPLAY_SESSION_SQL = `
  /* market-data:select-replay-session */
  SELECT mode, provider, feed, entitlement, configuration_version, freshness_threshold_ms,
    ended_at IS NULL AS is_open
  FROM market_data_ingestion_sessions
  WHERE session_id = $1
`;

const CLOSE_SESSION_SQL = `
  /* market-data:close-session */
  UPDATE market_data_ingestion_sessions
  SET ended_at = $1
  WHERE session_id = $2 AND ended_at IS NULL
`;

const SELECT_SESSION_MODE_SQL = `
  /* market-data:select-session-mode */
  SELECT mode
  FROM market_data_ingestion_sessions
  WHERE session_id = $1
`;

const SELECT_OPEN_PAPER_SESSION_FOR_UPDATE_SQL = `
  /* market-data:select-open-paper-session-for-update */
  SELECT 1 AS open
  FROM market_data_ingestion_sessions
  WHERE session_id = $1 AND mode = 'paper' AND ended_at IS NULL
  FOR UPDATE
`;

const REGISTER_WRITER_CAPABILITY_SQL = `
  /* market-data:register-writer-capability */
  INSERT INTO market_data_writer_capabilities (
    session_id,
    session_mode,
    capability_state,
    revision_contract_version,
    expires_at,
    freshness_threshold_ms,
    data_quality_policy_version
  ) VALUES (
    $1,
    'paper',
    'accepted',
    $2,
    CURRENT_TIMESTAMP + ($3::integer * interval '1 millisecond'),
    $4,
    $5
  )
`;

const RENEW_WRITER_CAPABILITY_SQL = `
  /* market-data:renew-writer-capability */
  UPDATE market_data_writer_capabilities AS capability
  SET heartbeat_at = CURRENT_TIMESTAMP,
      expires_at = CURRENT_TIMESTAMP + ($3::integer * interval '1 millisecond'),
      updated_at = CURRENT_TIMESTAMP
  FROM market_data_ingestion_sessions AS session
  WHERE capability.session_id = $1
    AND capability.session_id = session.session_id
    AND capability.session_mode = 'paper'
    AND session.mode = 'paper'
    AND session.ended_at IS NULL
    AND capability.capability_state = 'accepted'
    AND capability.revision_contract_version = $2
    AND capability.freshness_threshold_ms = $4
    AND capability.data_quality_policy_version = $5
    AND capability.retired_at IS NULL
    AND capability.expires_at > CURRENT_TIMESTAMP
`;

const RETIRE_WRITER_CAPABILITY_SQL = `
  /* market-data:retire-writer-capability */
  UPDATE market_data_writer_capabilities
  SET capability_state = 'retired',
      retired_at = GREATEST(CURRENT_TIMESTAMP, heartbeat_at),
      updated_at = GREATEST(CURRENT_TIMESTAMP, heartbeat_at)
  WHERE session_id = $1
    AND session_mode = 'paper'
    AND capability_state = 'accepted'
    AND revision_contract_version = $2
    AND retired_at IS NULL
`;

const SELECT_OPEN_SESSION_SQL = `
  /* market-data:select-open-session */
  SELECT ended_at IS NULL AS is_open
  FROM market_data_ingestion_sessions
  WHERE session_id = $1
  FOR SHARE
`;

const SELECT_DUPLICATE_SQL = `
  /* market-data:select-duplicate */
  SELECT event_json, arrival_classification, timeliness, gap_state
  FROM market_data_event_ledger
  WHERE event_id = $1
`;

const LOCK_MARKET_SERIES_SQL = `
  /* market-data:lock-market-series */
  SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
`;

const SET_CANONICAL_REVISION_WRITER_CONTRACT_SQL = `
  /* market-data:set-canonical-revision-writer-contract */
  SELECT set_config('daily_trader.canonical_revision_contract', $1, true),
         set_config('daily_trader.market_data_writer_session_id', $2, true)
`;

const ASSERT_CANONICAL_WRITER_CAPABILITY_SQL = `
  /* market-data:assert-canonical-writer-capability */
  SELECT NOT EXISTS (SELECT 1 FROM signal_runs WHERE capture_active)
    OR EXISTS (
      SELECT 1
      FROM signal_runs AS run
      JOIN market_data_ingestion_sessions AS session ON true
      JOIN market_data_writer_capabilities AS capability
        ON capability.session_id = session.session_id
       AND capability.session_mode = 'paper'
      WHERE session.session_id = $1
        AND run.capture_active
        AND session.mode = 'paper'
        AND session.ended_at IS NULL
        AND capability.capability_state = 'accepted'
        AND capability.revision_contract_version = $2
        AND capability.freshness_threshold_ms = run.freshness_threshold_ms
        AND capability.data_quality_policy_version = run.data_quality_policy_version
        AND capability.retired_at IS NULL
        AND capability.heartbeat_at <= clock_timestamp()
        AND capability.expires_at > clock_timestamp()
    ) AS available
`;

const SELECT_SESSION_EVENT_LINK_SQL = `
  /* market-data:select-session-event-link */
  SELECT 1 AS linked
  FROM market_data_session_events
  WHERE session_id = $1 AND event_id = $2
`;

const INSERT_SESSION_EVENT_LINK_SQL = `
  /* market-data:insert-session-event-link */
  INSERT INTO market_data_session_events (session_id, event_id)
  VALUES ($1, $2)
  ON CONFLICT (session_id, event_id) DO NOTHING
`;

const SELECT_CORRECTION_SQL = `
  /* market-data:select-correction */
  SELECT gap_state
  FROM market_data_event_ledger
  WHERE ordering_key = $1
  ORDER BY received_at DESC, event_id DESC
  LIMIT 1
`;

const SELECT_LATEST_SERIES_EVENT_SQL = `
  /* market-data:select-latest-series-event */
  SELECT event_json, gap_state
  FROM market_data_event_ledger
  WHERE instrument_symbol = $1
    AND instrument_venue = $2
    AND interval_iso = $3
    AND timeliness IN ('fresh', 'late')
  ORDER BY bar_start DESC, received_at DESC, event_id DESC
  LIMIT 1
`;

const SELECT_PRIOR_CANONICAL_BAR_SQL = `
  /* market-data:select-prior-canonical-bar */
  SELECT ledger.event_json
  FROM market_data_one_minute_bars AS bar
  INNER JOIN market_data_event_ledger AS ledger ON ledger.event_id = bar.event_id
  WHERE bar.instrument_symbol = $1
    AND bar.instrument_venue = $2
    AND bar.bar_start = $3
`;

const SELECT_CANONICAL_SERIES_FRONTIER_SQL = `
  /* market-data:select-canonical-series-frontier */
  SELECT ledger.event_json
  FROM market_data_one_minute_bars AS bar
  INNER JOIN market_data_event_ledger AS ledger ON ledger.event_id = bar.event_id
  WHERE bar.instrument_symbol = $1
    AND bar.instrument_venue = $2
  ORDER BY bar.bar_start DESC, bar.event_id DESC
  LIMIT 1
`;

const INSERT_LEDGER_EVENT_SQL = `
  /* market-data:insert-ledger-event */
  INSERT INTO market_data_event_ledger (
    event_id,
    session_id,
    freshness_threshold_ms,
    data_quality_policy_version,
    schema_version,
    event_type,
    ordering_key,
    arrival_classification,
    timeliness,
    gap_state,
    instrument_symbol,
    instrument_venue,
    interval_iso,
    currency,
    price_unit,
    volume_unit,
    provider,
    feed,
    entitlement,
    delay_milliseconds,
    source_identifier,
    provider_timestamp,
    bar_start,
    bar_end,
    received_at,
    processed_at,
    open_price,
    high_price,
    low_price,
    close_price,
    volume,
    event_json
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
    $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
    $31, $32
  )
`;

const MARK_GAP_OBSERVED_SQL = `
  /* market-data:mark-gap-observed */
  UPDATE market_data_gaps
  SET status = 'observed_later'
  WHERE instrument_symbol = $1
    AND instrument_venue = $2
    AND expected_bar_start = $3
    AND status = 'detected'
`;

const INSERT_GAPS_SQL = `
  /* market-data:insert-gaps */
  INSERT INTO market_data_gaps (
    instrument_symbol,
    instrument_venue,
    expected_bar_start,
    first_detected_at,
    source_event_id,
    status
  )
  SELECT $1, $2, expected_bar_start, $3, $4, 'detected'
  FROM unnest($5::timestamptz[]) AS expected_bar_start
  ON CONFLICT (instrument_symbol, instrument_venue, expected_bar_start) DO NOTHING
`;

const UPSERT_CANONICAL_BAR_SQL = `
  /* market-data:upsert-canonical-bar */
  INSERT INTO market_data_one_minute_bars (
    instrument_symbol,
    instrument_venue,
    bar_start,
    bar_end,
    event_id,
    schema_version,
    currency,
    price_unit,
    volume_unit,
    open_price,
    high_price,
    low_price,
    close_price,
    volume,
    provider,
    feed,
    entitlement,
    delay_milliseconds,
    source_identifier,
    provider_timestamp,
    received_at,
    processed_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
  )
  ON CONFLICT (instrument_symbol, instrument_venue, bar_start) DO UPDATE SET
    bar_end = EXCLUDED.bar_end,
    event_id = EXCLUDED.event_id,
    schema_version = EXCLUDED.schema_version,
    currency = EXCLUDED.currency,
    price_unit = EXCLUDED.price_unit,
    volume_unit = EXCLUDED.volume_unit,
    open_price = EXCLUDED.open_price,
    high_price = EXCLUDED.high_price,
    low_price = EXCLUDED.low_price,
    close_price = EXCLUDED.close_price,
    volume = EXCLUDED.volume,
    provider = EXCLUDED.provider,
    feed = EXCLUDED.feed,
    entitlement = EXCLUDED.entitlement,
    delay_milliseconds = EXCLUDED.delay_milliseconds,
    source_identifier = EXCLUDED.source_identifier,
    provider_timestamp = EXCLUDED.provider_timestamp,
    received_at = EXCLUDED.received_at,
    processed_at = EXCLUDED.processed_at,
    updated_at = CURRENT_TIMESTAMP
  WHERE (EXCLUDED.received_at, EXCLUDED.event_id) >
        (market_data_one_minute_bars.received_at, market_data_one_minute_bars.event_id)
  RETURNING event_id
`;

const LOCK_CANONICAL_REVISION_COUNTER_SQL = `
  /* market-data:lock-canonical-revision-counter */
  SELECT next_position::text AS next_position
  FROM market_data_canonical_revision_counter
  WHERE singleton
  FOR UPDATE
`;

const SELECT_ACTIVE_CAPTURE_RUN_SQL = `
  /* market-data:select-active-capture-run */
  SELECT run.run_id, run.backlog_limit,
    (
      SELECT count(*)::text
      FROM market_data_canonical_revisions AS revision
      WHERE revision.run_id = run.run_id
        AND revision.position > run.cursor_position
    ) AS backlog_count
  FROM signal_runs AS run
  WHERE run.capture_active
  FOR SHARE
`;

const ADVANCE_CANONICAL_REVISION_COUNTER_SQL = `
  /* market-data:advance-canonical-revision-counter */
  UPDATE market_data_canonical_revision_counter
  SET next_position = next_position + 1
  WHERE singleton AND next_position::text = $1
`;

const INSERT_CANONICAL_REVISION_SQL = `
  /* market-data:insert-canonical-revision */
  INSERT INTO market_data_canonical_revisions (
    position,
    revision_id,
    run_id,
    schema_version,
    operation,
    ordering_key,
    instrument_symbol,
    instrument_venue,
    bar_start,
    previous_event_id,
    new_event_id,
    arrival_classification,
    gap_state,
    historical,
    filled_known_gap
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15
  )
`;

const SELECT_LATEST_BARS_SQL = `
  /* market-data:select-latest-bars */
  SELECT DISTINCT ON (bar.instrument_symbol)
    ledger.event_json,
    ledger.arrival_classification,
    ledger.timeliness,
    ledger.gap_state
  FROM market_data_one_minute_bars AS bar
  INNER JOIN market_data_event_ledger AS ledger ON ledger.event_id = bar.event_id
  WHERE bar.instrument_symbol IN ('AAPL', 'SPY')
    AND bar.bar_end <= $1
  ORDER BY bar.instrument_symbol, bar.bar_start DESC, bar.event_id DESC
`;

const SELECT_LAST_EVENT_SQL = `
  /* market-data:select-last-event */
  SELECT event_json
  FROM market_data_event_ledger
  ORDER BY received_at DESC, event_id DESC
  LIMIT 1
`;

const SELECT_SESSION_EVENTS_SQL = `
  /* market-data:select-session-events */
  SELECT ledger.event_json
  FROM market_data_session_events AS session_event
  INNER JOIN market_data_event_ledger AS ledger ON ledger.event_id = session_event.event_id
  WHERE session_event.session_id = $1
  ORDER BY session_event.session_sequence ASC
`;

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID.test(sessionId)) {
    throw new MarketDataPersistenceError('session_invalid');
  }
}

function validateConfigurationVersion(value: string): void {
  if (!CONFIGURATION_VERSION.test(value)) {
    throw new MarketDataPersistenceError('session_invalid');
  }
}

function validateSessionMode(value: string): void {
  if (value !== 'fixture' && value !== 'paper' && value !== 'replay') {
    throw new MarketDataPersistenceError('session_invalid');
  }
}

function stringField(row: SqlRow, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return value;
}

function positiveIntegerField(row: SqlRow, field: string): number {
  const value = row[field];
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return value;
}

function nonnegativeIntegerTextField(row: SqlRow, field: string): string {
  const value = stringField(row, field);
  if (!NONNEGATIVE_INTEGER_TEXT.test(value)) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return value;
}

function arrivalClassification(row: SqlRow): PersistedArrivalClassification {
  const value = stringField(row, 'arrival_classification');
  if (value !== 'accepted' && value !== 'correction' && value !== 'out_of_order') {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return value;
}

function timeliness(row: SqlRow): PersistedTimeliness {
  const value = stringField(row, 'timeliness');
  if (value !== 'fresh' && value !== 'late' && value !== 'outside_session' && value !== 'unknown') {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return value;
}

function gapState(row: SqlRow): GapState {
  const value = stringField(row, 'gap_state');
  if (value !== 'complete' && value !== 'gapped' && value !== 'unknown') {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return value;
}

function supportedSymbol(value: string): SupportedMarketDataSymbol {
  if (value !== 'AAPL' && value !== 'SPY') {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return value;
}

function validatePersistenceEnvelope(entry: PersistMarketDataEntry): void {
  validateSessionId(entry.sessionId);
  if (entry.schemaVersion !== MARKET_DATA_SCHEMA_VERSION || !EVENT_ID.test(entry.eventId)) {
    throw new MarketDataPersistenceError('entry_invalid');
  }
}

function deserializePersistenceEntry(entry: PersistMarketDataEntry): OneMinuteBarEvent {
  const event = deserializeOneMinuteBarEvent(entry.eventJson);
  if (event.eventId !== entry.eventId || event.orderingKey !== entry.orderingKey) {
    throw new MarketDataPersistenceError('entry_invalid');
  }
  return event;
}

function classifyTimeliness(
  event: OneMinuteBarEvent,
  calendar: MarketSessionCalendar,
  freshnessThresholdMs: number,
): PersistedTimeliness {
  const session = calendar.classify(event.barStart);
  if (session.state === 'unknown') {
    return 'unknown';
  }
  if (session.state === 'outside_session') {
    return 'outside_session';
  }
  return isLateArrival(event, event.receivedAt, freshnessThresholdMs) ? 'late' : 'fresh';
}

function isCoreSessionTimeliness(value: PersistedTimeliness): boolean {
  return value === 'fresh' || value === 'late';
}

interface OrderingDecision {
  readonly classification: PersistedArrivalClassification;
  readonly gap: GapAssessment;
}

const UNKNOWN_GAP: GapAssessment = Object.freeze({
  state: 'unknown',
  missingIntervalCount: 0,
  scanLimited: false,
});

function gapFromState(state: GapState): GapAssessment {
  return Object.freeze({
    state,
    missingIntervalCount: 0,
    scanLimited: false,
  });
}

async function classifyOrdering(
  client: SqlQueryable,
  event: OneMinuteBarEvent,
  eventTimeliness: PersistedTimeliness,
  calendar: MarketSessionCalendar,
): Promise<OrderingDecision> {
  const correction = await client.query(SELECT_CORRECTION_SQL, [event.orderingKey]);
  const correctionRow = correction.rows[0];
  if (correctionRow !== undefined) {
    return Object.freeze({
      classification: 'correction',
      gap: gapFromState(gapState(correctionRow)),
    });
  }

  const latest = await client.query(SELECT_LATEST_SERIES_EVENT_SQL, [
    event.instrument.symbol,
    event.instrument.venue,
    event.interval,
  ]);
  const latestRow = latest.rows[0];
  if (latestRow === undefined) {
    return Object.freeze({ classification: 'accepted', gap: UNKNOWN_GAP });
  }

  const latestEvent = deserializeOneMinuteBarEvent(stringField(latestRow, 'event_json'));
  const latestGapState = gapState(latestRow);
  if (utcEpochMilliseconds(event.barStart) < utcEpochMilliseconds(latestEvent.barStart)) {
    return Object.freeze({
      classification: 'out_of_order',
      gap: gapFromState(latestGapState),
    });
  }
  if (!isCoreSessionTimeliness(eventTimeliness)) {
    return Object.freeze({ classification: 'accepted', gap: UNKNOWN_GAP });
  }

  const assessed = assessIntervalGap(latestEvent.barStart, event.barStart, calendar);
  return Object.freeze({
    classification: 'accepted',
    gap: latestGapState === 'gapped' ? gapFromState('gapped') : assessed,
  });
}

function missingGapIntervals(
  assessment: GapAssessment,
  calendar: MarketSessionCalendar,
): readonly UtcTimestamp[] {
  if (
    assessment.state !== 'gapped' ||
    assessment.firstMissingBarStart === undefined ||
    assessment.lastMissingBarStart === undefined
  ) {
    return [];
  }
  const intervals: UtcTimestamp[] = [];
  let candidate = assessment.firstMissingBarStart;
  while (utcEpochMilliseconds(candidate) <= utcEpochMilliseconds(assessment.lastMissingBarStart)) {
    if (calendar.classify(candidate).state === 'open') {
      intervals.push(candidate);
    }
    candidate = addUtcMilliseconds(candidate, 60_000);
  }
  if (intervals.length !== assessment.missingIntervalCount) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return Object.freeze(intervals);
}

function ledgerValues(
  sessionId: string,
  event: OneMinuteBarEvent,
  classification: PersistedArrivalClassification,
  eventTimeliness: PersistedTimeliness,
  eventGapState: GapState,
  eventJson: string,
  freshnessThresholdMs: number,
): readonly unknown[] {
  return [
    event.eventId,
    sessionId,
    freshnessThresholdMs,
    MARKET_DATA_QUALITY_POLICY_VERSION,
    event.schemaVersion,
    event.kind,
    event.orderingKey,
    classification,
    eventTimeliness,
    eventGapState,
    event.instrument.symbol,
    event.instrument.venue,
    event.interval,
    event.currency,
    event.priceUnit,
    event.volumeUnit,
    event.source.provider,
    event.source.feed,
    event.source.entitlement,
    event.source.delayMilliseconds,
    event.source.identifier,
    event.providerTimestamp,
    event.barStart,
    event.barEnd,
    event.receivedAt,
    event.processedAt,
    event.open,
    event.high,
    event.low,
    event.close,
    event.volume,
    eventJson,
  ];
}

async function priorCanonicalEvent(
  client: SqlQueryable,
  event: OneMinuteBarEvent,
): Promise<OneMinuteBarEvent | undefined> {
  const result = await client.query(SELECT_PRIOR_CANONICAL_BAR_SQL, [
    event.instrument.symbol,
    event.instrument.venue,
    event.barStart,
  ]);
  if (result.rows.length > 1) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : deserializeOneMinuteBarEvent(stringField(row, 'event_json'));
}

async function isHistoricalCanonicalChange(
  client: SqlQueryable,
  event: OneMinuteBarEvent,
): Promise<boolean> {
  const result = await client.query(SELECT_CANONICAL_SERIES_FRONTIER_SQL, [
    event.instrument.symbol,
    event.instrument.venue,
  ]);
  if (result.rows.length > 1) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  const row = result.rows[0];
  if (row === undefined) {
    return false;
  }
  const frontier = deserializeOneMinuteBarEvent(stringField(row, 'event_json'));
  return utcEpochMilliseconds(event.barStart) < utcEpochMilliseconds(frontier.barStart);
}

async function journalCanonicalChange(
  client: SqlQueryable,
  input: {
    readonly event: OneMinuteBarEvent;
    readonly previousCanonicalEventId: string | null;
    readonly ordering: OrderingDecision;
    readonly historical: boolean;
    readonly filledKnownGap: boolean;
    readonly monotonicNow: () => number;
  },
): Promise<number | undefined> {
  const counterLockStartedAt = input.monotonicNow();
  const counter = await client.query(LOCK_CANONICAL_REVISION_COUNTER_SQL);
  const counterLockWaitMs = Math.max(0, input.monotonicNow() - counterLockStartedAt);
  if (counter.rows.length !== 1) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  const counterRow = counter.rows[0];
  if (counterRow === undefined) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  const processingPosition = stringField(counterRow, 'next_position');

  const capture = await client.query(SELECT_ACTIVE_CAPTURE_RUN_SQL);
  if (capture.rows.length > 1) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  const captureRow = capture.rows[0];
  if (captureRow === undefined) {
    return undefined;
  }
  const runId = stringField(captureRow, 'run_id');
  const backlogLimit = positiveIntegerField(captureRow, 'backlog_limit');
  const backlogCount = nonnegativeIntegerTextField(captureRow, 'backlog_count');
  if (BigInt(backlogCount) >= BigInt(backlogLimit)) {
    throw new MarketDataPersistenceError('capacity_exceeded');
  }
  const revision = createCanonicalRevision(
    input.previousCanonicalEventId === null
      ? {
          operation: 'insert',
          processingPosition,
          logicalBarKey: input.event.orderingKey,
          previousCanonicalEventId: null,
          newCanonicalEventId: input.event.eventId,
          marketEventSchemaVersion: input.event.schemaVersion,
          arrival: {
            classification: input.ordering.classification,
            historical: input.historical,
            outOfOrder: input.ordering.classification === 'out_of_order',
          },
          gap: { state: input.ordering.gap.state, filledKnownGap: input.filledKnownGap },
        }
      : {
          operation: 'replace',
          processingPosition,
          logicalBarKey: input.event.orderingKey,
          previousCanonicalEventId: input.previousCanonicalEventId,
          newCanonicalEventId: input.event.eventId,
          marketEventSchemaVersion: input.event.schemaVersion,
          arrival: {
            classification: input.ordering.classification,
            historical: input.historical,
            outOfOrder: false,
          },
          gap: { state: input.ordering.gap.state, filledKnownGap: false },
        },
  );

  const advanced = await client.query(ADVANCE_CANONICAL_REVISION_COUNTER_SQL, [
    revision.processingPosition,
  ]);
  if (advanced.rowCount !== 1) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  const inserted = await client.query(INSERT_CANONICAL_REVISION_SQL, [
    revision.processingPosition,
    revision.revisionId,
    runId,
    revision.schemaVersion,
    revision.operation,
    revision.logicalBarKey,
    input.event.instrument.symbol,
    input.event.instrument.venue,
    input.event.barStart,
    revision.previousCanonicalEventId,
    revision.newCanonicalEventId,
    revision.arrival.classification,
    revision.gap.state,
    revision.arrival.historical,
    revision.gap.filledKnownGap,
  ]);
  if (inserted.rowCount !== 1) {
    throw new MarketDataPersistenceError('stored_data_invalid');
  }
  return counterLockWaitMs;
}

function canonicalBarValues(event: OneMinuteBarEvent): readonly unknown[] {
  return [
    event.instrument.symbol,
    event.instrument.venue,
    event.barStart,
    event.barEnd,
    event.eventId,
    event.schemaVersion,
    event.currency,
    event.priceUnit,
    event.volumeUnit,
    event.open,
    event.high,
    event.low,
    event.close,
    event.volume,
    event.source.provider,
    event.source.feed,
    event.source.entitlement,
    event.source.delayMilliseconds,
    event.source.identifier,
    event.providerTimestamp,
    event.receivedAt,
    event.processedAt,
  ];
}

async function requireOpenSession(client: SqlQueryable, sessionId: string): Promise<void> {
  const result = await client.query(SELECT_OPEN_SESSION_SQL, [sessionId]);
  if (result.rows.length !== 1 || result.rows[0]?.is_open !== true) {
    throw new MarketDataPersistenceError('session_not_open');
  }
}

function translateTransactionError(error: unknown): Error {
  if (error instanceof MarketDataPersistenceError || error instanceof MarketDataValidationError) {
    return error;
  }
  return new MarketDataPersistenceError('query_failed');
}

export class MarketDataRepository {
  readonly #pool: SqlPool;
  readonly #calendar: MarketSessionCalendar;
  readonly #freshnessThresholdMs: number;
  readonly #writerCapabilityLeaseMs: number;
  readonly #monotonicNow: () => number;
  readonly #onCanonicalRevisionTiming: ((timing: CanonicalRevisionTiming) => void) | undefined;
  #writerSessionId: string | undefined;
  #closePromise: Promise<void> | undefined;
  #forceClosePromise: Promise<void> | undefined;

  public constructor(pool: SqlPool, options: MarketDataRepositoryOptions = {}) {
    const freshnessThresholdMs = options.freshnessThresholdMs ?? FRESHNESS_THRESHOLD_MS;
    const writerCapabilityLeaseMs =
      options.writerCapabilityLeaseMs ?? DEFAULT_WRITER_CAPABILITY_LEASE_MS;
    if (
      !Number.isSafeInteger(freshnessThresholdMs) ||
      freshnessThresholdMs < 60_000 ||
      freshnessThresholdMs > 300_000
    ) {
      throw new TypeError('freshnessThresholdMs must be between 60000 and 300000');
    }
    if (
      !Number.isSafeInteger(writerCapabilityLeaseMs) ||
      writerCapabilityLeaseMs < MINIMUM_WRITER_CAPABILITY_LEASE_MS ||
      writerCapabilityLeaseMs > MAXIMUM_WRITER_CAPABILITY_LEASE_MS
    ) {
      throw new TypeError('writerCapabilityLeaseMs must be between 3000 and 900000');
    }
    this.#pool = pool;
    this.#calendar = options.calendar ?? NYSE_CORE_SESSION_CALENDAR;
    this.#freshnessThresholdMs = freshnessThresholdMs;
    this.#writerCapabilityLeaseMs = writerCapabilityLeaseMs;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#onCanonicalRevisionTiming = options.onCanonicalRevisionTiming;
  }

  public async createIngestionSession(input: CreateIngestionSessionInput): Promise<void> {
    validateSessionId(input.sessionId);
    validateSessionMode(input.mode);
    validateConfigurationVersion(input.configurationVersion);
    const startedAt = createUtcTimestamp(input.startedAt);
    const values = [
      input.sessionId,
      input.mode,
      MARKET_DATA_PROVIDER,
      MARKET_DATA_FEED,
      MARKET_DATA_ENTITLEMENT,
      input.configurationVersion,
      this.#freshnessThresholdMs,
      startedAt,
    ] as const;
    if (input.mode !== 'paper') {
      try {
        await this.#pool.query(CREATE_SESSION_SQL, values);
      } catch (error) {
        throw translateTransactionError(error);
      }
      return;
    }
    if (this.#writerSessionId !== undefined) {
      throw new MarketDataPersistenceError('session_invalid');
    }

    let client: SqlPoolClient;
    try {
      client = await this.#pool.connect();
    } catch {
      throw new MarketDataPersistenceError('connection_failed');
    }
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      for (const key of WRITER_CAPABILITY_LOCK_KEYS) {
        await client.query(LOCK_MARKET_SERIES_SQL, [key]);
      }
      await client.query(CREATE_SESSION_SQL, values);
      await client.query(REGISTER_WRITER_CAPABILITY_SQL, [
        input.sessionId,
        CANONICAL_REVISION_SCHEMA_VERSION,
        this.#writerCapabilityLeaseMs,
        this.#freshnessThresholdMs,
        MARKET_DATA_QUALITY_POLICY_VERSION,
      ]);
      await client.query('COMMIT');
      transactionStarted = false;
      this.#writerSessionId = input.sessionId;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch {
          throw new MarketDataPersistenceError('rollback_failed');
        }
      }
      throw translateTransactionError(error);
    } finally {
      client.release();
    }
  }

  public async ensureReplayIngestionSession(
    input: Omit<CreateIngestionSessionInput, 'mode'>,
  ): Promise<ReplayIngestionSessionState> {
    validateSessionId(input.sessionId);
    validateConfigurationVersion(input.configurationVersion);
    const startedAt = createUtcTimestamp(input.startedAt);
    try {
      await this.#pool.query(ENSURE_REPLAY_SESSION_SQL, [
        input.sessionId,
        MARKET_DATA_PROVIDER,
        MARKET_DATA_FEED,
        MARKET_DATA_ENTITLEMENT,
        input.configurationVersion,
        this.#freshnessThresholdMs,
        startedAt,
      ]);
      const result = await this.#pool.query(SELECT_REPLAY_SESSION_SQL, [input.sessionId]);
      const row = result.rows[0];
      if (
        result.rows.length !== 1 ||
        row === undefined ||
        stringField(row, 'mode') !== 'replay' ||
        stringField(row, 'provider') !== MARKET_DATA_PROVIDER ||
        stringField(row, 'feed') !== MARKET_DATA_FEED ||
        stringField(row, 'entitlement') !== MARKET_DATA_ENTITLEMENT ||
        stringField(row, 'configuration_version') !== input.configurationVersion ||
        row.freshness_threshold_ms !== this.#freshnessThresholdMs ||
        typeof row.is_open !== 'boolean'
      ) {
        throw new MarketDataPersistenceError('session_invalid');
      }
      return Object.freeze({ open: row.is_open });
    } catch (error) {
      throw translateTransactionError(error);
    }
  }

  public async closeIngestionSession(sessionId: string, endedAt: UtcTimestamp): Promise<void> {
    validateSessionId(sessionId);
    const validatedEndedAt = createUtcTimestamp(endedAt);
    let selected: SqlQueryResult;
    try {
      selected = await this.#pool.query(SELECT_SESSION_MODE_SQL, [sessionId]);
    } catch (error) {
      throw translateTransactionError(error);
    }
    const selectedRow = selected.rows[0];
    if (selected.rows.length !== 1 || selectedRow === undefined) {
      throw new MarketDataPersistenceError('session_not_open');
    }
    if (stringField(selectedRow, 'mode') === 'paper') {
      await this.#closePaperIngestionSession(sessionId, validatedEndedAt);
      return;
    }
    let result: SqlQueryResult;
    try {
      result = await this.#pool.query(CLOSE_SESSION_SQL, [validatedEndedAt, sessionId]);
    } catch (error) {
      throw translateTransactionError(error);
    }
    if (result.rowCount !== 1) {
      throw new MarketDataPersistenceError('session_not_open');
    }
  }

  public async renewWriterCapability(sessionId: string): Promise<void> {
    validateSessionId(sessionId);
    if (sessionId !== this.#writerSessionId) {
      throw new MarketDataPersistenceError('writer_contract_unavailable');
    }
    let result: SqlQueryResult;
    try {
      result = await this.#pool.query(RENEW_WRITER_CAPABILITY_SQL, [
        sessionId,
        CANONICAL_REVISION_SCHEMA_VERSION,
        this.#writerCapabilityLeaseMs,
        this.#freshnessThresholdMs,
        MARKET_DATA_QUALITY_POLICY_VERSION,
      ]);
    } catch (error) {
      throw translateTransactionError(error);
    }
    if (result.rowCount !== 1) {
      throw new MarketDataPersistenceError('writer_contract_unavailable');
    }
  }

  async #closePaperIngestionSession(sessionId: string, endedAt: UtcTimestamp): Promise<void> {
    let client: SqlPoolClient;
    try {
      client = await this.#pool.connect();
    } catch {
      throw new MarketDataPersistenceError('connection_failed');
    }
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      for (const key of WRITER_CAPABILITY_LOCK_KEYS) {
        await client.query(LOCK_MARKET_SERIES_SQL, [key]);
      }
      const open = await client.query(SELECT_OPEN_PAPER_SESSION_FOR_UPDATE_SQL, [sessionId]);
      if (open.rows.length !== 1) {
        throw new MarketDataPersistenceError('session_not_open');
      }
      const retired = await client.query(RETIRE_WRITER_CAPABILITY_SQL, [
        sessionId,
        CANONICAL_REVISION_SCHEMA_VERSION,
      ]);
      if (retired.rowCount !== 1) {
        throw new MarketDataPersistenceError('writer_contract_unavailable');
      }
      const closed = await client.query(CLOSE_SESSION_SQL, [endedAt, sessionId]);
      if (closed.rowCount !== 1) {
        throw new MarketDataPersistenceError('session_not_open');
      }
      await client.query('COMMIT');
      transactionStarted = false;
      if (this.#writerSessionId === sessionId) this.#writerSessionId = undefined;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch {
          throw new MarketDataPersistenceError('rollback_failed');
        }
      }
      throw translateTransactionError(error);
    } finally {
      client.release();
    }
  }

  public async persistEntry(entry: PersistMarketDataEntry): Promise<PersistMarketDataResult> {
    validatePersistenceEnvelope(entry);
    let client: SqlPoolClient;
    try {
      client = await this.#pool.connect();
    } catch {
      throw new MarketDataPersistenceError('connection_failed');
    }

    let transactionStarted = false;
    let transactionStartedAt = 0;
    let counterLockWaitMs: number | undefined;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      transactionStartedAt = this.#monotonicNow();
      await client.query(SET_CANONICAL_REVISION_WRITER_CONTRACT_SQL, [
        CANONICAL_REVISION_SCHEMA_VERSION,
        this.#writerSessionId ?? '',
      ]);
      const event = deserializePersistenceEntry(entry);

      await client.query(LOCK_MARKET_SERIES_SQL, [
        `${event.instrument.venue}:${event.instrument.symbol}|${event.interval}`,
      ]);

      const duplicate = await client.query(SELECT_DUPLICATE_SQL, [event.eventId]);
      const duplicateRow = duplicate.rows[0];
      if (duplicateRow !== undefined) {
        const storedEvent = deserializeOneMinuteBarEvent(stringField(duplicateRow, 'event_json'));
        if (storedEvent.eventId !== event.eventId) {
          throw new MarketDataPersistenceError('stored_data_invalid');
        }
        const sessionLink = await client.query(SELECT_SESSION_EVENT_LINK_SQL, [
          entry.sessionId,
          event.eventId,
        ]);
        if (sessionLink.rows.length === 0) {
          await requireOpenSession(client, entry.sessionId);
          await client.query(INSERT_SESSION_EVENT_LINK_SQL, [entry.sessionId, event.eventId]);
        }
        const result = Object.freeze({
          event: storedEvent,
          classification: 'duplicate' as const,
          timeliness: timeliness(duplicateRow),
          gapState: gapState(duplicateRow),
          canonicalized: false,
        });
        await client.query('COMMIT');
        transactionStarted = false;
        return result;
      }

      await requireOpenSession(client, entry.sessionId);

      const eventTimeliness = classifyTimeliness(event, this.#calendar, this.#freshnessThresholdMs);
      const ordering = await classifyOrdering(client, event, eventTimeliness, this.#calendar);
      const canonicalJson = serializeOneMinuteBarEvent(event);
      await client.query(
        INSERT_LEDGER_EVENT_SQL,
        ledgerValues(
          entry.sessionId,
          event,
          ordering.classification,
          eventTimeliness,
          ordering.gap.state,
          canonicalJson,
          this.#freshnessThresholdMs,
        ),
      );
      await client.query(INSERT_SESSION_EVENT_LINK_SQL, [entry.sessionId, event.eventId]);

      let canonicalized = false;
      if (isCoreSessionTimeliness(eventTimeliness)) {
        const currentCanonical = await priorCanonicalEvent(client, event);
        const transition = decideCanonicalTransition({
          currentCanonical,
          candidate: event,
          candidateEligible: true,
        });
        if (transition.operation !== 'no_op') {
          const writerCapability = await client.query(ASSERT_CANONICAL_WRITER_CAPABILITY_SQL, [
            this.#writerSessionId ?? '',
            CANONICAL_REVISION_SCHEMA_VERSION,
          ]);
          if (writerCapability.rows[0]?.available !== true) {
            throw new MarketDataPersistenceError('writer_contract_unavailable');
          }
          const historical = await isHistoricalCanonicalChange(client, event);
          const gapObservation = await client.query(MARK_GAP_OBSERVED_SQL, [
            event.instrument.symbol,
            event.instrument.venue,
            event.barStart,
          ]);
          if (gapObservation.rowCount !== 0 && gapObservation.rowCount !== 1) {
            throw new MarketDataPersistenceError('stored_data_invalid');
          }
          const filledKnownGap = gapObservation.rowCount === 1;
          const missingIntervals = missingGapIntervals(ordering.gap, this.#calendar);
          if (missingIntervals.length > 0) {
            await client.query(INSERT_GAPS_SQL, [
              event.instrument.symbol,
              event.instrument.venue,
              event.receivedAt,
              event.eventId,
              missingIntervals,
            ]);
          }
          const upsert = await client.query(UPSERT_CANONICAL_BAR_SQL, canonicalBarValues(event));
          const canonicalRow = upsert.rows[0];
          if (
            upsert.rowCount !== 1 ||
            upsert.rows.length !== 1 ||
            canonicalRow === undefined ||
            stringField(canonicalRow, 'event_id') !== event.eventId
          ) {
            throw new MarketDataPersistenceError('stored_data_invalid');
          }
          counterLockWaitMs = await journalCanonicalChange(client, {
            event,
            previousCanonicalEventId: transition.previousCanonicalEventId,
            ordering,
            historical,
            filledKnownGap,
            monotonicNow: this.#monotonicNow,
          });
          canonicalized = true;
        }
      }

      await client.query('COMMIT');
      transactionStarted = false;
      if (counterLockWaitMs !== undefined) {
        const timing = Object.freeze({
          counterLockWaitMs,
          transactionDurationMs: Math.max(0, this.#monotonicNow() - transactionStartedAt),
        });
        try {
          this.#onCanonicalRevisionTiming?.(timing);
        } catch {
          // A best-effort telemetry observer cannot make an already committed write appear failed.
        }
      }
      return Object.freeze({
        event,
        classification: ordering.classification,
        timeliness: eventTimeliness,
        gapState: ordering.gap.state,
        canonicalized,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch {
          throw new MarketDataPersistenceError('rollback_failed');
        }
      }
      throw translateTransactionError(error);
    } finally {
      client.release();
    }
  }

  public async findLatestBars(observedAt: UtcTimestamp): Promise<readonly LatestPersistedBar[]> {
    const observed = createUtcTimestamp(observedAt);
    let rows: readonly SqlRow[];
    try {
      rows = (await this.#pool.query(SELECT_LATEST_BARS_SQL, [observed])).rows;
    } catch (error) {
      throw translateTransactionError(error);
    }

    const bySymbol = new Map<SupportedMarketDataSymbol, LatestPersistedBar>();
    for (const row of rows) {
      const event = deserializeOneMinuteBarEvent(stringField(row, 'event_json'));
      if (utcEpochMilliseconds(event.barEnd) > utcEpochMilliseconds(observed)) {
        continue;
      }
      const symbol = supportedSymbol(event.instrument.symbol);
      if (bySymbol.has(symbol)) {
        throw new MarketDataPersistenceError('stored_data_invalid');
      }
      const storedTimeliness = timeliness(row);
      const freshness = classifyMarketDataFreshness(
        event,
        observed,
        this.#calendar,
        this.#freshnessThresholdMs,
      );
      bySymbol.set(
        symbol,
        Object.freeze({
          event,
          arrivalClassification: arrivalClassification(row),
          timeliness: storedTimeliness,
          gapState: gapState(row),
          freshness,
          current: freshness.state === 'fresh' && storedTimeliness === 'fresh',
        }),
      );
    }

    return Object.freeze(
      PHASE_2_SYMBOLS.flatMap((symbol) => {
        const bar = bySymbol.get(symbol);
        return bar === undefined ? [] : [bar];
      }),
    );
  }

  public async findLastEventReceivedAt(): Promise<UtcTimestamp | undefined> {
    let rows: readonly SqlRow[];
    try {
      rows = (await this.#pool.query(SELECT_LAST_EVENT_SQL)).rows;
    } catch (error) {
      throw translateTransactionError(error);
    }
    const row = rows[0];
    if (row === undefined) return undefined;
    if (rows.length !== 1) throw new MarketDataPersistenceError('stored_data_invalid');
    const canonicalJson = stringField(row, 'event_json');
    const event = deserializeOneMinuteBarEvent(canonicalJson);
    if (serializeOneMinuteBarEvent(event) !== canonicalJson) {
      throw new MarketDataPersistenceError('stored_data_invalid');
    }
    return event.receivedAt;
  }

  public async readCanonicalEvents(sourceSessionId: string): Promise<readonly string[]> {
    validateSessionId(sourceSessionId);
    let rows: readonly SqlRow[];
    try {
      rows = (await this.#pool.query(SELECT_SESSION_EVENTS_SQL, [sourceSessionId])).rows;
    } catch (error) {
      throw translateTransactionError(error);
    }

    return Object.freeze(
      rows.map((row) => {
        const canonicalJson = stringField(row, 'event_json');
        const event = deserializeOneMinuteBarEvent(canonicalJson);
        if (serializeOneMinuteBarEvent(event) !== canonicalJson) {
          throw new MarketDataPersistenceError('stored_data_invalid');
        }
        return canonicalJson;
      }),
    );
  }

  public close(): Promise<void> {
    this.#closePromise ??= this.#pool.end().catch(() => {
      throw new MarketDataPersistenceError('shutdown_failed');
    });
    return this.#closePromise;
  }

  public forceClose(): Promise<void> {
    this.#forceClosePromise ??= this.#pool.destroy().catch(() => {
      throw new MarketDataPersistenceError('shutdown_failed');
    });
    this.#closePromise ??= this.#forceClosePromise;
    return this.#forceClosePromise;
  }
}
