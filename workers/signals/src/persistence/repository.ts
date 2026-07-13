import { createHash } from 'node:crypto';

import { createUtcTimestamp, type Clock, type UtcTimestamp } from '@daily-trader/domain';
import {
  CANONICAL_REVISION_SCHEMA_VERSION,
  MARKET_DATA_SCHEMA_VERSION,
  createCanonicalRevision,
  deserializeOneMinuteBarEvent,
  type CanonicalRevision,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import {
  createSignalTransition,
  createSignalConfiguration,
  semanticVersions,
  serializeSignalConfiguration,
  serializeSignalEvaluation,
  type SignalConfiguration,
  type SignalEvaluation,
} from '@daily-trader/signals';
import type { SignalOperationalConfiguration } from '@daily-trader/config';

import { SignalsWorkerError } from '../errors.js';
import { persistSignalEvaluation, persistSignalRunAssociation } from './signal-store.js';
import type { SqlClient, SqlPool, SqlQueryable, SqlRow } from './sql.js';

const SERIES_LOCK_KEYS = Object.freeze(['XNAS:AAPL|1m', 'ARCX:SPY|1m']);
const WORKER_OWNER_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

interface RunRow extends SqlRow {
  readonly run_id: unknown;
  readonly state: unknown;
  readonly configuration_hash: unknown;
  readonly operational_configuration_hash: unknown;
  readonly start_position: unknown;
  readonly stop_position: unknown;
  readonly cursor_position: unknown;
  readonly claim_fence: unknown;
  readonly claim_owner_id: unknown;
  readonly claim_lease_ms: unknown;
  readonly claim_renew_interval_ms: unknown;
  readonly capture_active: unknown;
}

interface CommitRunRow extends RunRow {
  readonly cursor_value: unknown;
}

interface StatusLeaseRow extends SqlRow {
  readonly claim_fence: unknown;
}

interface StatusLease {
  readonly ownerId: string;
  readonly fenceToken: string;
}

interface RevisionRow extends SqlRow {
  readonly position: unknown;
  readonly revision_id: unknown;
  readonly operation: unknown;
  readonly ordering_key: unknown;
  readonly previous_event_id: unknown;
  readonly new_event_id: unknown;
  readonly historical: unknown;
  readonly arrival_classification: unknown;
  readonly filled_known_gap: unknown;
  readonly gap_state: unknown;
  readonly event_json: unknown;
  readonly journaled_at: unknown;
}

export interface LiveRunClaim {
  readonly runId: string;
  readonly state: 'active' | 'closing' | 'pending';
  readonly cursorPosition: string;
  readonly stopPosition: string | null;
  readonly fenceToken: string;
  readonly ownerId: string;
  readonly statusFenceToken: string;
  readonly leaseDurationMs: number;
  readonly renewIntervalMs: number;
}

export interface PersistedRunSettings {
  readonly configuration: SignalConfiguration;
  readonly operational: SignalOperationalConfiguration;
}

export interface JournalRevision {
  readonly revision: CanonicalRevision;
  readonly event: OneMinuteBarEvent;
  readonly journaledAt: UtcTimestamp;
  readonly arrivalClassification: 'accepted' | 'correction' | 'out_of_order';
  readonly gapState: 'complete' | 'gapped' | 'unknown';
}

export interface PersistedSignalStatus {
  readonly lifecycle: 'disabled' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  readonly runId: string | null;
  readonly runState: string | null;
  readonly cursorPosition: string | null;
  readonly stopPosition: string | null;
  readonly backlogCount: string;
  readonly revisionGapDetected: boolean;
  readonly heartbeatAt: UtcTimestamp | null;
  readonly lastEvaluatedBarStart: UtcTimestamp | null;
  readonly failureCode: string | null;
  readonly semantics: Readonly<{
    definitionVersion: string;
    configurationVersion: string;
    configurationHash: string;
    arithmeticPolicyVersion: string;
    calendarVersion: string;
    marketEventSchemaVersion: string;
    revisionSchemaVersion: string;
    featureSchemaVersion: string;
    evaluationSchemaVersion: string;
    dataQualityPolicyVersion: string;
    freshnessThresholdMs: number;
    lookbackBars: number;
    volumeMultiplier: string;
  }> | null;
  readonly latestMarketData: Readonly<{
    AAPL: SignalStatusMarketData | undefined;
    SPY: SignalStatusMarketData | undefined;
  }>;
  readonly latest: readonly SignalStatusEvaluation[];
  readonly latestValidFired: readonly SignalStatusEvaluation[];
}

export interface SignalStatusMarketData {
  readonly event: OneMinuteBarEvent;
  readonly freshnessThresholdMs: number;
}

type NonFailedSignalLifecycle = Exclude<PersistedSignalStatus['lifecycle'], 'failed'>;

export interface SignalStatusEvaluation {
  readonly symbol: string;
  readonly venue: string;
  readonly evaluationBarStart: UtcTimestamp;
  readonly outcome: string;
  readonly reason: string;
  readonly direction: string | null;
  readonly observationAsOf: UtcTimestamp;
  readonly knowledgeAsOf: UtcTimestamp;
  readonly mode: string;
  readonly sourceProvider: string;
  readonly sourceFeed: string;
  readonly sourceEntitlement: string;
  readonly closePrice: string | null;
  readonly breakoutReference: string | null;
  readonly priorHigh: string | null;
  readonly priorLow: string | null;
  readonly currentVolume: string | null;
  readonly priorVolumeSum: string | null;
  readonly priorCount: number | null;
  readonly volumeMultiplier: string | null;
  readonly windowStart: UtcTimestamp | null;
  readonly windowEnd: UtcTimestamp | null;
  readonly invalidationCondition: string | null;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new SignalsWorkerError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return value;
}

function bigintText(value: unknown, field: string): string {
  const candidate = text(value, field);
  if (!/^(?:0|[1-9]\d*)$/u.test(candidate)) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return candidate;
}

function timestamp(value: unknown, field: string): UtcTimestamp {
  try {
    return createUtcTimestamp(value instanceof Date ? value.toISOString() : value);
  } catch (error) {
    throw new SignalsWorkerError('stored_data_invalid', {
      cause: new TypeError(`invalid stored ${field}`, { cause: error }),
    });
  }
}

function marketEvent(value: unknown, field: string): OneMinuteBarEvent {
  try {
    return deserializeOneMinuteBarEvent(text(value, field));
  } catch (error) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: error });
  }
}

function canonicalOperationalPayload(configuration: SignalOperationalConfiguration): string {
  return JSON.stringify({
    journalPollIntervalMs: configuration.journalPollIntervalMs,
    claimBatchSize: configuration.claimBatchSize,
    queueCapacity: configuration.queueCapacity,
    claimLeaseMs: configuration.claimLeaseMs,
    claimRenewIntervalMs: configuration.claimRenewIntervalMs,
    retry: {
      maxAttempts: configuration.retry.maxAttempts,
      baseDelayMs: configuration.retry.baseDelayMs,
      maxDelayMs: configuration.retry.maxDelayMs,
      jitterPercent: configuration.retry.jitterPercent,
    },
    backlogLimit: configuration.backlogLimit,
    statementTimeoutMs: configuration.statementTimeoutMs,
    shutdownTimeoutMs: configuration.shutdownTimeoutMs,
  });
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return value as Readonly<Record<string, unknown>>;
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return value;
}

function parseOperational(payload: string, expectedHash: string): SignalOperationalConfiguration {
  if (sha256(payload) !== expectedHash) throw new SignalsWorkerError('stored_data_invalid');
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload) as unknown;
  } catch (error) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: error });
  }
  const root = record(decoded, 'operational configuration');
  const retry = record(root.retry, 'operational retry');
  const parsed: SignalOperationalConfiguration = Object.freeze({
    journalPollIntervalMs: safeInteger(root.journalPollIntervalMs, 'journalPollIntervalMs'),
    claimBatchSize: safeInteger(root.claimBatchSize, 'claimBatchSize'),
    queueCapacity: safeInteger(root.queueCapacity, 'queueCapacity'),
    claimLeaseMs: safeInteger(root.claimLeaseMs, 'claimLeaseMs'),
    claimRenewIntervalMs: safeInteger(root.claimRenewIntervalMs, 'claimRenewIntervalMs'),
    retry: Object.freeze({
      maxAttempts: safeInteger(retry.maxAttempts, 'maxAttempts'),
      baseDelayMs: safeInteger(retry.baseDelayMs, 'baseDelayMs'),
      maxDelayMs: safeInteger(retry.maxDelayMs, 'maxDelayMs'),
      jitterPercent: safeInteger(retry.jitterPercent, 'jitterPercent'),
    }),
    backlogLimit: safeInteger(root.backlogLimit, 'backlogLimit'),
    statementTimeoutMs: safeInteger(root.statementTimeoutMs, 'statementTimeoutMs'),
    shutdownTimeoutMs: safeInteger(root.shutdownTimeoutMs, 'shutdownTimeoutMs'),
  });
  if (canonicalOperationalPayload(parsed) !== payload) {
    throw new SignalsWorkerError('stored_data_invalid');
  }
  return parsed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runIdentifier(configurationHash: string, now: UtcTimestamp): string {
  return `live-${now.replace(/[-:.tz]/giu, '').toLowerCase()}-${configurationHash.slice(0, 16)}`;
}

async function transaction<T>(pool: SqlPool, work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (began) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new SignalsWorkerError('persistence_failed', { cause: rollbackError });
      }
    }
    if (error instanceof SignalsWorkerError) throw error;
    throw new SignalsWorkerError('persistence_failed', { cause: error });
  } finally {
    client.release();
  }
}

async function lockCutover(
  client: SqlQueryable,
  configuration: SignalConfiguration | null,
): Promise<string> {
  const requireFreshWriterCapability = configuration !== null;
  for (const key of SERIES_LOCK_KEYS) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }
  const capability = await client.query<{ readonly available: unknown }>(
    `SELECT to_regclass('market_data_canonical_revisions') IS NOT NULL
       AND to_regprocedure('enforce_signal_capture_writer_contract()') IS NOT NULL
       AND (
         NOT $1::boolean
         OR (
           to_regclass('market_data_writer_capabilities') IS NOT NULL
           AND to_regprocedure('enforce_open_paper_writer_capability()') IS NOT NULL
           AND to_regprocedure('lock_paper_writer_capability_cutover()') IS NOT NULL
         )
       ) AS available`,
    [requireFreshWriterCapability],
  );
  if (capability.rows[0]?.available !== true) {
    throw new SignalsWorkerError('writer_contract_unavailable');
  }
  const counter = await client.query<{ readonly next_position: unknown }>(
    'SELECT next_position FROM market_data_canonical_revision_counter WHERE singleton FOR UPDATE',
  );
  const next = bigintText(counter.rows[0]?.next_position, 'next_position');
  if (configuration !== null) {
    const dataQualityPolicyVersion = semanticVersions(configuration).dataQualityPolicyVersion;
    const activeWriters = await client.query<{ readonly available: unknown }>(
      `SELECT NOT EXISTS (
         SELECT 1
         FROM market_data_ingestion_sessions AS session
         LEFT JOIN market_data_writer_capabilities AS capability
           ON capability.session_id = session.session_id
          AND capability.session_mode = 'paper'
         WHERE session.mode = 'paper'
           AND session.ended_at IS NULL
           AND (
             capability.session_id IS NULL
             OR capability.capability_state <> 'accepted'
             OR capability.revision_contract_version <> $1
             OR capability.freshness_threshold_ms <> $2
             OR capability.data_quality_policy_version <> $3
             OR capability.retired_at IS NOT NULL
             OR capability.heartbeat_at > CURRENT_TIMESTAMP
           )
       ) AS available`,
      [
        CANONICAL_REVISION_SCHEMA_VERSION,
        configuration.freshnessThresholdMs,
        dataQualityPolicyVersion,
      ],
    );
    if (activeWriters.rows[0]?.available !== true) {
      throw new SignalsWorkerError('writer_contract_unavailable');
    }
  }
  return (BigInt(next) - 1n).toString();
}

function claim(row: RunRow, statusLease: StatusLease): LiveRunClaim {
  const state = text(row.state, 'state');
  if (state !== 'active' && state !== 'closing' && state !== 'pending') {
    throw new SignalsWorkerError('stored_data_invalid');
  }
  return Object.freeze({
    runId: text(row.run_id, 'run_id'),
    state,
    cursorPosition: bigintText(row.cursor_position, 'cursor_position'),
    stopPosition:
      row.stop_position === null ? null : bigintText(row.stop_position, 'stop_position'),
    fenceToken: bigintText(row.claim_fence, 'claim_fence'),
    ownerId: text(row.claim_owner_id, 'claim_owner_id'),
    statusFenceToken: statusLease.fenceToken,
    leaseDurationMs: integer(row.claim_lease_ms, 'claim_lease_ms'),
    renewIntervalMs: integer(row.claim_renew_interval_ms, 'claim_renew_interval_ms'),
  });
}

function statusLeaseFromClaim(claimed: LiveRunClaim): StatusLease {
  return Object.freeze({ ownerId: claimed.ownerId, fenceToken: claimed.statusFenceToken });
}

async function warmupRows(client: SqlQueryable, lookbackBars: number): Promise<readonly SqlRow[]> {
  const rows = await client.query(
    `WITH ranked AS (
       SELECT bars.instrument_symbol, bars.instrument_venue, bars.bar_start, ledger.event_id,
              ledger.event_json,
              (bars.bar_start AT TIME ZONE 'America/New_York')::date AS session_date,
              max((bars.bar_start AT TIME ZONE 'America/New_York')::date)
                OVER (PARTITION BY bars.instrument_symbol) AS latest_session_date
       FROM market_data_one_minute_bars AS bars
       JOIN market_data_event_ledger AS ledger ON ledger.event_id = bars.event_id
       WHERE bars.instrument_symbol IN ('AAPL', 'SPY')
     ), bounded AS (
       SELECT *, row_number() OVER (
         PARTITION BY instrument_symbol ORDER BY bar_start DESC
       ) AS reverse_ordinal
       FROM ranked WHERE session_date = latest_session_date
     )
     SELECT instrument_symbol, instrument_venue, bar_start, event_id, event_json
     FROM bounded WHERE reverse_ordinal <= $1
     ORDER BY instrument_symbol, bar_start`,
    [lookbackBars],
  );
  return rows.rows;
}

async function insertRunBootstrap(
  client: SqlQueryable,
  runId: string,
  rows: readonly SqlRow[],
  now: UtcTimestamp,
): Promise<void> {
  const bySymbol = new Map<string, SqlRow[]>();
  for (const row of rows) {
    const symbol = text(row.instrument_symbol, 'instrument_symbol');
    const list = bySymbol.get(symbol) ?? [];
    list.push(row);
    bySymbol.set(symbol, list);
  }
  for (const [symbol, venue] of [
    ['AAPL', 'XNAS'],
    ['SPY', 'ARCX'],
  ] as const) {
    const selected = bySymbol.get(symbol) ?? [];
    for (const [ordinal, row] of selected.entries()) {
      await client.query(
        `INSERT INTO signal_run_bootstrap_events
          (run_id, instrument_symbol, instrument_venue, ordinal, event_id, bar_start, evidence_only)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [
          runId,
          symbol,
          venue,
          ordinal,
          text(row.event_id, 'event_id'),
          timestamp(row.bar_start, 'bar_start'),
        ],
      );
    }
    const latest = selected.at(-1);
    const boundary =
      latest === undefined
        ? new Date(Math.floor(Date.parse(now) / 60_000) * 60_000).toISOString()
        : new Date(Date.parse(timestamp(latest.bar_start, 'bar_start')) + 60_000).toISOString();
    await client.query(
      `INSERT INTO signal_run_boundaries
        (run_id, instrument_symbol, first_evaluation_bar_start) VALUES ($1, $2, $3)`,
      [runId, symbol, boundary],
    );
  }
}

function parseEvaluation(payload: unknown): SignalEvaluation {
  const serialized = text(payload, 'canonical_payload');
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: error });
  }
  if (typeof value !== 'object' || value === null || !('evaluationId' in value)) {
    throw new SignalsWorkerError('stored_data_invalid');
  }
  try {
    const evaluation = value as SignalEvaluation;
    if (serializeSignalEvaluation(evaluation) !== serialized) {
      throw new TypeError('noncanonical evaluation payload');
    }
    return evaluation;
  } catch (error) {
    throw new SignalsWorkerError('stored_data_invalid', { cause: error });
  }
}

export class SignalsRepository {
  readonly #pool: SqlPool;
  readonly #ownerId: string;

  public constructor(pool: SqlPool, ownerId: string) {
    if (!WORKER_OWNER_ID.test(ownerId)) {
      throw new TypeError('ownerId must be a bounded worker identifier');
    }
    this.#pool = pool;
    this.#ownerId = ownerId;
  }

  async #acquireStatusLease(
    client: SqlQueryable,
    leaseDurationMs: number,
    force: boolean,
  ): Promise<StatusLease> {
    if (
      !Number.isSafeInteger(leaseDurationMs) ||
      leaseDurationMs < 5_000 ||
      leaseDurationMs > 120_000
    ) {
      throw new SignalsWorkerError('configuration_conflict');
    }
    const result = await client.query<StatusLeaseRow>(
      `UPDATE signal_worker_status
       SET claim_fence = CASE
             WHEN claim_owner_id = $1 AND claim_expires_at > CURRENT_TIMESTAMP
               THEN claim_fence
             ELSE claim_fence + 1
           END,
           claim_owner_id = $1,
           claim_expires_at = CURRENT_TIMESTAMP + ($2::integer * interval '1 millisecond'),
           updated_at = CURRENT_TIMESTAMP
       WHERE singleton
         AND ($3::boolean OR claim_owner_id IS NULL OR claim_owner_id = $1
              OR claim_expires_at <= CURRENT_TIMESTAMP)
       RETURNING claim_fence`,
      [this.#ownerId, leaseDurationMs, force],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new SignalsWorkerError('cursor_conflict');
    }
    return Object.freeze({
      ownerId: this.#ownerId,
      fenceToken: bigintText(row.claim_fence, 'claim_fence'),
    });
  }

  async #renewClaim(client: SqlQueryable, claimed: LiveRunClaim): Promise<void> {
    if (claimed.ownerId !== this.#ownerId) throw new SignalsWorkerError('cursor_conflict');
    const status = await client.query(
      `UPDATE signal_worker_status
       SET claim_expires_at = CURRENT_TIMESTAMP + ($3::integer * interval '1 millisecond'),
           updated_at = CURRENT_TIMESTAMP
       WHERE singleton AND claim_owner_id = $1 AND claim_fence = $2
         AND claim_expires_at > CURRENT_TIMESTAMP`,
      [claimed.ownerId, claimed.statusFenceToken, claimed.leaseDurationMs],
    );
    if (status.rowCount !== 1) throw new SignalsWorkerError('cursor_conflict');
    const run = await client.query(
      `UPDATE signal_runs
       SET claim_expires_at = CURRENT_TIMESTAMP + ($4::integer * interval '1 millisecond')
       WHERE run_id = $1 AND source_kind = 'live_journal'
         AND claim_owner_id = $2 AND claim_fence = $3
         AND claim_expires_at > CURRENT_TIMESTAMP`,
      [claimed.runId, claimed.ownerId, claimed.fenceToken, claimed.leaseDurationMs],
    );
    if (run.rowCount !== 1) throw new SignalsWorkerError('cursor_conflict');
  }

  public async enableOrResume(
    configuration: SignalConfiguration,
    operational: SignalOperationalConfiguration,
    clock: Clock,
  ): Promise<LiveRunClaim> {
    return transaction(this.#pool, async (client) => {
      const watermark = await lockCutover(client, configuration);
      const operationalPayload = canonicalOperationalPayload(operational);
      const operationalHash = sha256(operationalPayload);
      const captures = await client.query<RunRow>(
        `SELECT run_id, state, configuration_hash, operational_configuration_hash,
                start_position, stop_position, cursor_position, claim_fence, claim_owner_id,
                claim_lease_ms, claim_renew_interval_ms, capture_active
         FROM signal_runs WHERE source_kind = 'live_journal' AND capture_active FOR UPDATE`,
      );
      const current = captures.rows[0];
      const currentMatches =
        current !== undefined &&
        current.configuration_hash === configuration.configurationHash &&
        current.operational_configuration_hash === operationalHash;
      const existingClosing = await client.query<{ readonly present: unknown }>(
        `SELECT EXISTS (
           SELECT 1 FROM signal_runs
           WHERE source_kind = 'live_journal' AND state = 'closing'
         ) AS present`,
      );
      const hasClosing = boolean(existingClosing.rows[0]?.present, 'present');
      if (current !== undefined && !currentMatches && hasClosing) {
        throw new SignalsWorkerError('configuration_conflict');
      }
      const statusLease = await this.#acquireStatusLease(client, operational.claimLeaseMs, false);
      if (currentMatches) {
        const resumed = await client.query<RunRow>(
          `UPDATE signal_runs SET claim_fence = claim_fence + 1,
             claim_owner_id = $2,
             claim_expires_at = CURRENT_TIMESTAMP
               + (claim_lease_ms * interval '1 millisecond')
           WHERE run_id = $1
             AND (claim_owner_id IS NULL OR claim_owner_id = $2
                  OR claim_expires_at <= CURRENT_TIMESTAMP)
           RETURNING run_id, state, configuration_hash, operational_configuration_hash,
             start_position, stop_position, cursor_position, claim_fence, claim_owner_id,
             claim_lease_ms, claim_renew_interval_ms, capture_active`,
          [text(current.run_id, 'run_id'), this.#ownerId],
        );
        const resumedRow = resumed.rows[0];
        if (resumed.rowCount !== 1 || resumedRow === undefined) {
          throw new SignalsWorkerError('cursor_conflict');
        }
        const resumedClaim = claim(resumedRow, statusLease);
        const cursor = await client.query(
          `UPDATE signal_run_cursors SET fence_token = $2, updated_at = $3 WHERE run_id = $1`,
          [resumedClaim.runId, resumedClaim.fenceToken, clock.now()],
        );
        if (cursor.rowCount !== 1) throw new SignalsWorkerError('stored_data_invalid');
        const closing = await this.#claimClosing(client, statusLease, clock.now(), false);
        await this.updateWorkerStatus(
          client,
          statusLease,
          'starting',
          closing?.runId ?? resumedClaim.runId,
          clock.now(),
        );
        return closing ?? resumedClaim;
      }

      if (current !== undefined) {
        const frozen = await client.query(
          `UPDATE signal_runs SET capture_active = false, state = 'closing', stop_position = $2
           WHERE run_id = $1
             AND (claim_owner_id IS NULL OR claim_owner_id = $3
                  OR claim_expires_at <= CURRENT_TIMESTAMP)`,
          [text(current.run_id, 'run_id'), watermark, this.#ownerId],
        );
        if (frozen.rowCount !== 1) throw new SignalsWorkerError('cursor_conflict');
      }

      const now = clock.now();
      const runId = runIdentifier(configuration.configurationHash, now);
      const versions = semanticVersions(configuration);
      const bootstrap = await warmupRows(client, configuration.lookbackBars);
      const createdState = current !== undefined || hasClosing ? 'pending' : 'active';
      await client.query(
        `INSERT INTO signal_runs (
           run_id, source_kind, state, definition_version, configuration_version,
           configuration_hash, configuration_payload, operational_configuration_hash,
           operational_configuration_payload, backlog_limit, arithmetic_policy_version, calendar_version,
           market_event_schema_version, revision_schema_version, feature_schema_version,
           evaluation_schema_version, data_quality_policy_version, freshness_threshold_ms,
           lookback_window, volume_multiplier,
           source_provenance, source_cursor_namespace, start_position, cursor_position,
           capture_active, claim_fence, claim_owner_id, claim_expires_at,
           claim_lease_ms, claim_renew_interval_ms, started_at
         ) VALUES (
           $1, 'live_journal', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, 'daily-trader.market-data.quality.v1', $16, $17, $18,
           'postgresql.canonical-revision-journal', $19, $20, $20, true, 1, $21,
           CURRENT_TIMESTAMP + ($22::integer * interval '1 millisecond'), $22, $23, $24
         )`,
        [
          runId,
          createdState,
          configuration.signalDefinitionVersion,
          configuration.configurationVersion,
          configuration.configurationHash,
          serializeSignalConfiguration(configuration),
          operationalHash,
          operationalPayload,
          operational.backlogLimit,
          versions.arithmeticPolicyVersion,
          versions.calendarSnapshotVersion,
          versions.marketEventSchemaVersion,
          versions.canonicalRevisionSchemaVersion,
          versions.featureResultSchemaVersion,
          versions.evaluationSchemaVersion,
          configuration.freshnessThresholdMs,
          configuration.lookbackBars,
          configuration.volumeMultiplier,
          `live-journal.${runId}`,
          watermark,
          this.#ownerId,
          operational.claimLeaseMs,
          operational.claimRenewIntervalMs,
          now,
        ],
      );
      await insertRunBootstrap(client, runId, bootstrap, now);
      await client.query(
        `INSERT INTO signal_run_cursors (run_id, source_kind, cursor_value, fence_token, updated_at)
         VALUES ($1, 'live_journal', $2, 1, $3)`,
        [runId, watermark, now],
      );
      const closing = await this.#claimClosing(client, statusLease, now, false);
      const created: LiveRunClaim = Object.freeze({
        runId,
        state: createdState,
        cursorPosition: watermark,
        stopPosition: null,
        fenceToken: '1',
        ownerId: this.#ownerId,
        statusFenceToken: statusLease.fenceToken,
        leaseDurationMs: operational.claimLeaseMs,
        renewIntervalMs: operational.claimRenewIntervalMs,
      });
      await this.updateWorkerStatus(client, statusLease, 'starting', closing?.runId ?? runId, now);
      return closing ?? created;
    });
  }

  public async disable(clock: Clock, claimLeaseMs: number): Promise<LiveRunClaim | null> {
    return transaction(this.#pool, async (client) => {
      const watermark = await lockCutover(client, null);
      const statusLease = await this.#acquireStatusLease(client, claimLeaseMs, true);
      const active = await client.query<RunRow>(
        `SELECT run_id, state, configuration_hash, operational_configuration_hash,
                start_position, stop_position, cursor_position, claim_fence, claim_owner_id,
                claim_lease_ms, claim_renew_interval_ms, capture_active
         FROM signal_runs WHERE source_kind = 'live_journal' AND capture_active FOR UPDATE`,
      );
      const row = active.rows[0];
      if (row !== undefined) {
        await client.query(
          `UPDATE signal_runs SET capture_active = false, state = 'closing', stop_position = $2
           WHERE run_id = $1`,
          [text(row.run_id, 'run_id'), watermark],
        );
      }
      const closing = await this.#claimClosing(client, statusLease, clock.now(), true);
      await this.updateWorkerStatus(
        client,
        statusLease,
        closing === null ? 'disabled' : 'stopping',
        closing?.runId ?? null,
        clock.now(),
      );
      return closing;
    });
  }

  async #claimClosing(
    client: SqlQueryable,
    statusLease: StatusLease,
    now: UtcTimestamp,
    force: boolean,
  ): Promise<LiveRunClaim | null> {
    const result = await client.query<RunRow>(
      `UPDATE signal_runs SET claim_fence = claim_fence + 1,
         claim_owner_id = $1,
         claim_expires_at = CURRENT_TIMESTAMP
           + (claim_lease_ms * interval '1 millisecond')
       WHERE run_id = (
         SELECT run_id FROM signal_runs
         WHERE source_kind = 'live_journal' AND state = 'closing'
         ORDER BY created_at LIMIT 1 FOR UPDATE
       )
         AND ($2::boolean OR claim_owner_id IS NULL OR claim_owner_id = $1
              OR claim_expires_at <= CURRENT_TIMESTAMP)
       RETURNING run_id, state, configuration_hash, operational_configuration_hash,
         start_position, stop_position, cursor_position, claim_fence, claim_owner_id,
         claim_lease_ms, claim_renew_interval_ms, capture_active`,
      [this.#ownerId, force],
    );
    const row = result.rows[0];
    if (row === undefined) {
      const closing = await client.query<{ readonly present: unknown }>(
        `SELECT EXISTS (
           SELECT 1 FROM signal_runs
           WHERE source_kind = 'live_journal' AND state = 'closing'
         ) AS present`,
      );
      if (closing.rows[0]?.present === true) throw new SignalsWorkerError('cursor_conflict');
      return null;
    }
    const claimed = claim(row, statusLease);
    const cursor = await client.query(
      `UPDATE signal_run_cursors SET fence_token = $2, updated_at = $3 WHERE run_id = $1`,
      [claimed.runId, claimed.fenceToken, now],
    );
    if (cursor.rowCount !== 1) throw new SignalsWorkerError('stored_data_invalid');
    return claimed;
  }

  public async readRevisions(
    claimed: LiveRunClaim,
    limit: number,
  ): Promise<readonly JournalRevision[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new SignalsWorkerError('capacity_exceeded');
    }
    const result = await this.#pool.query<RevisionRow>(
      `SELECT revision.position, revision.revision_id, revision.operation, revision.ordering_key,
              revision.previous_event_id, revision.new_event_id, revision.historical,
              revision.arrival_classification, revision.gap_state, revision.filled_known_gap,
              revision.journaled_at,
              ledger.event_json
       FROM market_data_canonical_revisions AS revision
       JOIN market_data_event_ledger AS ledger ON ledger.event_id = revision.new_event_id
       WHERE revision.run_id = $1 AND revision.position > $2
         AND ($3::bigint IS NULL OR revision.position <= $3)
       ORDER BY revision.position LIMIT $4`,
      [claimed.runId, claimed.cursorPosition, claimed.stopPosition, limit],
    );
    let expected = BigInt(claimed.cursorPosition) + 1n;
    return Object.freeze(
      result.rows.map((row) => {
        const position = bigintText(row.position, 'position');
        if (BigInt(position) !== expected) throw new SignalsWorkerError('journal_gap');
        expected += 1n;
        const rawClassification = text(row.arrival_classification, 'arrival_classification');
        if (
          rawClassification !== 'accepted' &&
          rawClassification !== 'correction' &&
          rawClassification !== 'out_of_order'
        ) {
          throw new SignalsWorkerError('stored_data_invalid');
        }
        const rawGapState = text(row.gap_state, 'gap_state');
        if (rawGapState !== 'complete' && rawGapState !== 'gapped' && rawGapState !== 'unknown') {
          throw new SignalsWorkerError('stored_data_invalid');
        }
        const operation = text(row.operation, 'operation');
        if (operation !== 'insert' && operation !== 'replace') {
          throw new SignalsWorkerError('stored_data_invalid');
        }
        const previousCanonicalEventId =
          row.previous_event_id === null ? null : text(row.previous_event_id, 'previous_event_id');
        const revisionInput = {
          processingPosition: position,
          logicalBarKey: text(row.ordering_key, 'ordering_key'),
          newCanonicalEventId: text(row.new_event_id, 'new_event_id'),
          marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
          arrival: {
            classification: rawClassification,
            historical: boolean(row.historical, 'historical'),
            outOfOrder: rawClassification === 'out_of_order',
          },
          gap: {
            state: rawGapState,
            filledKnownGap: boolean(row.filled_known_gap, 'filled_known_gap'),
          },
        };
        const revision =
          operation === 'insert'
            ? createCanonicalRevision({
                ...revisionInput,
                operation,
                previousCanonicalEventId: null,
              })
            : createCanonicalRevision({
                ...revisionInput,
                operation,
                previousCanonicalEventId,
              });
        if (revision.revisionId !== text(row.revision_id, 'revision_id')) {
          throw new SignalsWorkerError('stored_data_invalid');
        }
        return Object.freeze({
          revision,
          event: marketEvent(row.event_json, 'event_json'),
          journaledAt: timestamp(row.journaled_at, 'journaled_at'),
          arrivalClassification: rawClassification,
          gapState: rawGapState,
        });
      }),
    );
  }

  public async loadRunSettings(runId: string): Promise<PersistedRunSettings> {
    const result = await this.#pool.query<{
      readonly configuration_payload: unknown;
      readonly configuration_hash: unknown;
      readonly operational_configuration_payload: unknown;
      readonly operational_configuration_hash: unknown;
    }>(
      `SELECT configuration_payload, configuration_hash,
              operational_configuration_payload, operational_configuration_hash
       FROM signal_runs WHERE run_id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new SignalsWorkerError('stored_data_invalid');
    const configurationPayload = text(row.configuration_payload, 'configuration_payload');
    let decoded: unknown;
    try {
      decoded = JSON.parse(configurationPayload) as unknown;
    } catch (error) {
      throw new SignalsWorkerError('stored_data_invalid', { cause: error });
    }
    const source = record(decoded, 'configuration_payload');
    const configuration = createSignalConfiguration({
      configurationVersion: source.configurationVersion,
      lookbackBars: source.lookbackBars,
      volumeMultiplier: source.volumeMultiplier,
      freshnessThresholdMs: source.freshnessThresholdMs,
    });
    if (
      configuration.configurationHash !== text(row.configuration_hash, 'configuration_hash') ||
      serializeSignalConfiguration(configuration) !== configurationPayload
    ) {
      throw new SignalsWorkerError('stored_data_invalid');
    }
    const operationalPayload = text(
      row.operational_configuration_payload,
      'operational_configuration_payload',
    );
    const operational = parseOperational(
      operationalPayload,
      text(row.operational_configuration_hash, 'operational_configuration_hash'),
    );
    return Object.freeze({ configuration, operational });
  }

  public async refreshClaim(claimed: LiveRunClaim): Promise<LiveRunClaim> {
    return transaction(this.#pool, async (client) => {
      await this.#renewClaim(client, claimed);
      const result = await client.query<RunRow>(
        `SELECT run_id, state, configuration_hash, operational_configuration_hash,
                start_position, stop_position, cursor_position, claim_fence, claim_owner_id,
                claim_lease_ms, claim_renew_interval_ms, capture_active
         FROM signal_runs WHERE run_id = $1 AND claim_fence = $2 AND claim_owner_id = $3`,
        [claimed.runId, claimed.fenceToken, claimed.ownerId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new SignalsWorkerError('cursor_conflict');
      return claim(row, statusLeaseFromClaim(claimed));
    });
  }

  public async refreshBacklog(
    claimed: LiveRunClaim,
    backlogLimit: number,
    clock: Clock,
  ): Promise<string> {
    return transaction(this.#pool, async (client) => {
      await this.#renewClaim(client, claimed);
      const result = await client.query<{ readonly backlog_count: unknown }>(
        `SELECT count(*)::bigint AS backlog_count
         FROM market_data_canonical_revisions
         WHERE run_id = $1 AND position > $2
           AND ($3::bigint IS NULL OR position <= $3)`,
        [claimed.runId, claimed.cursorPosition, claimed.stopPosition],
      );
      const count = bigintText(result.rows[0]?.backlog_count, 'backlog_count');
      const updated = await client.query(
        `UPDATE signal_worker_status SET active_run_id = $1, heartbeat_at = $2,
           backlog_count = $3, updated_at = $2
         WHERE singleton AND claim_owner_id = $4 AND claim_fence = $5`,
        [claimed.runId, clock.now(), count, claimed.ownerId, claimed.statusFenceToken],
      );
      if (updated.rowCount !== 1) throw new SignalsWorkerError('cursor_conflict');
      if (BigInt(count) > BigInt(backlogLimit)) throw new SignalsWorkerError('capacity_exceeded');
      return count;
    });
  }

  /**
   * Reconstructs only one instrument/exchange session through the claimed
   * cursor. Bootstrap rows have position zero; later run revisions replace
   * them by logical bar time. The bounded session projection is disposable and
   * never substitutes current global canonical rows for run-owned history.
   */
  public async loadSessionBars(
    claimed: LiveRunClaim,
    symbol: 'AAPL' | 'SPY',
    calendarDate: string,
  ): Promise<readonly OneMinuteBarEvent[]> {
    if (!/^20(?:26|27|28)-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(calendarDate)) {
      throw new SignalsWorkerError('stored_data_invalid');
    }
    const result = await this.#pool.query<{ readonly event_json: unknown }>(
      `WITH candidates AS (
         SELECT bootstrap.bar_start, ledger.event_json, 0::bigint AS source_position
         FROM signal_run_bootstrap_events AS bootstrap
         JOIN market_data_event_ledger AS ledger ON ledger.event_id = bootstrap.event_id
         WHERE bootstrap.run_id = $1
           AND bootstrap.instrument_symbol = $2
           AND (bootstrap.bar_start AT TIME ZONE 'America/New_York')::date = $3::date
         UNION ALL
         SELECT revision.bar_start, ledger.event_json, revision.position AS source_position
         FROM market_data_canonical_revisions AS revision
         JOIN market_data_event_ledger AS ledger ON ledger.event_id = revision.new_event_id
         WHERE revision.run_id = $1
           AND revision.instrument_symbol = $2
           AND revision.position <= $4
           AND (revision.bar_start AT TIME ZONE 'America/New_York')::date = $3::date
       ), latest AS (
         SELECT DISTINCT ON (bar_start) bar_start, event_json
         FROM candidates
         ORDER BY bar_start, source_position DESC
       )
       SELECT event_json FROM latest ORDER BY bar_start`,
      [claimed.runId, symbol, calendarDate, claimed.cursorPosition],
    );
    return Object.freeze(
      result.rows.map((row) => {
        const event = marketEvent(row.event_json, 'event_json');
        if (event.instrument.symbol !== symbol) {
          throw new SignalsWorkerError('stored_data_invalid');
        }
        return event;
      }),
    );
  }

  public async boundaries(runId: string): Promise<ReadonlyMap<string, UtcTimestamp>> {
    const result = await this.#pool.query<{
      readonly instrument_symbol: unknown;
      readonly first_evaluation_bar_start: unknown;
    }>(
      `SELECT instrument_symbol, first_evaluation_bar_start
       FROM signal_run_boundaries WHERE run_id = $1`,
      [runId],
    );
    return new Map(
      result.rows.map((row) => [
        text(row.instrument_symbol, 'instrument_symbol'),
        timestamp(row.first_evaluation_bar_start, 'first_evaluation_bar_start'),
      ]),
    );
  }

  public async commitRevision(
    claimed: LiveRunClaim,
    revision: JournalRevision,
    evaluations: readonly SignalEvaluation[],
    clock: Clock,
  ): Promise<LiveRunClaim> {
    return transaction(this.#pool, async (client) => {
      await this.#renewClaim(client, claimed);
      const locked = await client.query<CommitRunRow>(
        `SELECT run.run_id, run.state, run.configuration_hash, run.operational_configuration_hash,
                run.start_position, run.stop_position, run.cursor_position, run.claim_fence,
                run.claim_owner_id, run.claim_lease_ms, run.claim_renew_interval_ms,
                run.capture_active, cursor.cursor_value
         FROM signal_runs AS run JOIN signal_run_cursors AS cursor USING (run_id)
         WHERE run.run_id = $1 AND run.source_kind = 'live_journal'
           AND cursor.source_kind = 'live_journal' AND run.claim_fence = $2
           AND cursor.fence_token = $2 AND run.claim_owner_id = $3 FOR UPDATE`,
        [claimed.runId, claimed.fenceToken, claimed.ownerId],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new SignalsWorkerError('cursor_conflict');
      const current = bigintText(row.cursor_position, 'cursor_position');
      const durableCursor = bigintText(row.cursor_value, 'cursor_value');
      if (durableCursor !== current || current !== claimed.cursorPosition) {
        throw new SignalsWorkerError('cursor_conflict');
      }
      const position = revision.revision.processingPosition;
      if (BigInt(position) !== BigInt(current) + 1n) throw new SignalsWorkerError('journal_gap');

      const ordered = [...evaluations].sort((left, right) =>
        left.featureResult.evaluationBar.barStart.localeCompare(
          right.featureResult.evaluationBar.barStart,
        ),
      );
      let ordinal = 0;
      let latestBar: UtcTimestamp | null = null;
      for (const evaluation of ordered) {
        await persistSignalEvaluation(
          client,
          evaluation,
          (cause) => new SignalsWorkerError('stored_data_invalid', { cause }),
        );
        const feature = evaluation.featureResult;
        const predecessorResult = await client.query<{ readonly canonical_payload: unknown }>(
          `SELECT evaluation.canonical_payload
           FROM signal_run_latest_evaluations AS latest
           JOIN signal_evaluations AS evaluation ON evaluation.evaluation_id = latest.evaluation_id
           WHERE latest.run_id = $1 AND latest.definition_version = $2
             AND latest.configuration_hash = $3 AND latest.instrument_symbol = $4
             AND latest.evaluation_bar_start = $5 FOR UPDATE OF latest`,
          [
            claimed.runId,
            evaluation.definitionVersion,
            feature.semantics.configurationHash,
            feature.instrument.symbol,
            feature.evaluationBar.barStart,
          ],
        );
        const predecessorRow = predecessorResult.rows[0];
        const predecessor =
          predecessorRow === undefined
            ? undefined
            : parseEvaluation(predecessorRow.canonical_payload);
        if (predecessor?.evaluationId === evaluation.evaluationId) continue;
        const transition = createSignalTransition({
          signalRunId: claimed.runId,
          triggeringRevisionId: revision.revision.revisionId,
          processingPosition: position,
          current: evaluation,
          ...(predecessor === undefined ? {} : { predecessor }),
        });
        await persistSignalRunAssociation(client, {
          runId: claimed.runId,
          sourceKind: 'live_journal',
          sourceOrdinal: position,
          transitionOrdinal: ordinal,
          transition,
          evaluation,
        });
        ordinal += 1;
        if (latestBar === null || feature.evaluationBar.barStart > latestBar) {
          latestBar = feature.evaluationBar.barStart;
        }
      }
      const now = clock.now();
      const cursorUpdated = await client.query(
        `UPDATE signal_run_cursors SET cursor_value = $2, updated_at = $3
         WHERE run_id = $1 AND fence_token = $4 AND cursor_value = $5`,
        [claimed.runId, position, now, claimed.fenceToken, current],
      );
      const updated = await client.query<RunRow>(
        `UPDATE signal_runs SET cursor_position = $2
         WHERE run_id = $1 AND claim_fence = $3 AND claim_owner_id = $4
           AND cursor_position = $5
         RETURNING run_id, state, configuration_hash, operational_configuration_hash,
           start_position, stop_position, cursor_position, claim_fence, claim_owner_id,
           claim_lease_ms, claim_renew_interval_ms, capture_active`,
        [claimed.runId, position, claimed.fenceToken, claimed.ownerId, current],
      );
      const workerStatus = await client.query(
        `UPDATE signal_worker_status SET lifecycle = 'running', active_run_id = $1,
           heartbeat_at = $2, last_progress_position = $3,
           last_evaluated_bar_start = COALESCE($4, last_evaluated_bar_start),
           revision_gap_detected = false, failure_code = NULL, updated_at = $2
         WHERE singleton AND claim_owner_id = $5 AND claim_fence = $6`,
        [claimed.runId, now, position, latestBar, claimed.ownerId, claimed.statusFenceToken],
      );
      const updatedRow = updated.rows[0];
      if (
        cursorUpdated.rowCount !== 1 ||
        updated.rowCount !== 1 ||
        updatedRow === undefined ||
        workerStatus.rowCount !== 1
      ) {
        throw new SignalsWorkerError('cursor_conflict');
      }
      return claim(updatedRow, statusLeaseFromClaim(claimed));
    });
  }

  public async completeIfDrained(claimed: LiveRunClaim, clock: Clock): Promise<boolean> {
    if (claimed.state !== 'closing' || claimed.stopPosition === null) return false;
    if (claimed.cursorPosition !== claimed.stopPosition) return false;
    return transaction(this.#pool, async (client) => {
      await this.#renewClaim(client, claimed);
      const completed = await client.query(
        `UPDATE signal_runs SET state = 'completed', ended_at = $2
         WHERE run_id = $1 AND state = 'closing' AND claim_fence = $3
           AND claim_owner_id = $4
           AND cursor_position = stop_position`,
        [claimed.runId, clock.now(), claimed.fenceToken, claimed.ownerId],
      );
      if (completed.rowCount !== 1) throw new SignalsWorkerError('cursor_conflict');
      await client.query(
        `UPDATE signal_runs SET state = 'active'
         WHERE run_id = (
           SELECT run_id FROM signal_runs WHERE source_kind = 'live_journal'
             AND state = 'pending' AND capture_active ORDER BY created_at LIMIT 1
         )`,
      );
      return true;
    });
  }

  public async heartbeat(
    claimed: LiveRunClaim | null,
    lifecycle: NonFailedSignalLifecycle,
    clock: Clock,
  ): Promise<void> {
    await transaction(this.#pool, async (client) => {
      const terminal = lifecycle === 'disabled' || lifecycle === 'stopped';
      const updated = await client.query(
        `UPDATE signal_worker_status SET lifecycle = $1, active_run_id = $2,
           heartbeat_at = $3, failure_code = NULL,
           claim_expires_at = CASE WHEN $4::boolean THEN CURRENT_TIMESTAMP ELSE claim_expires_at END,
           updated_at = $3
         WHERE singleton AND claim_owner_id = $5
           AND ($6::bigint IS NULL OR claim_fence = $6)`,
        [
          lifecycle,
          claimed?.runId ?? null,
          clock.now(),
          terminal,
          this.#ownerId,
          claimed?.statusFenceToken ?? null,
        ],
      );
      if (updated.rowCount !== 1) return;
      if (terminal && claimed !== null) {
        await client.query(
          `UPDATE signal_runs SET claim_expires_at = CURRENT_TIMESTAMP
           WHERE run_id = $1 AND claim_owner_id = $2 AND claim_fence = $3`,
          [claimed.runId, claimed.ownerId, claimed.fenceToken],
        );
      }
    });
  }

  public async fail(claimed: LiveRunClaim | null, code: string, clock: Clock): Promise<void> {
    if (claimed === null) return;
    await transaction(this.#pool, async (client) => {
      const updated = await client.query(
        `UPDATE signal_worker_status SET lifecycle = 'failed', active_run_id = $1,
           heartbeat_at = $2, failure_code = $3,
           revision_gap_detected = ($3 = 'journal_gap'),
           claim_expires_at = CURRENT_TIMESTAMP, updated_at = $2
         WHERE singleton AND claim_owner_id = $4 AND claim_fence = $5`,
        [claimed.runId, clock.now(), code, claimed.ownerId, claimed.statusFenceToken],
      );
      if (updated.rowCount !== 1) return;
      await client.query(
        `UPDATE signal_runs SET claim_expires_at = CURRENT_TIMESTAMP
         WHERE run_id = $1 AND claim_owner_id = $2 AND claim_fence = $3`,
        [claimed.runId, claimed.ownerId, claimed.fenceToken],
      );
    });
  }

  private async updateWorkerStatus(
    queryable: SqlQueryable,
    statusLease: StatusLease,
    lifecycle: NonFailedSignalLifecycle,
    runId: string | null,
    now: UtcTimestamp,
  ): Promise<void> {
    await queryable.query(
      `UPDATE signal_worker_status SET lifecycle = $1, active_run_id = $2,
         heartbeat_at = $3, failure_code = NULL, updated_at = $3
       WHERE singleton AND claim_owner_id = $4 AND claim_fence = $5`,
      [lifecycle, runId, now, statusLease.ownerId, statusLease.fenceToken],
    );
  }

  public async status(): Promise<PersistedSignalStatus> {
    const selected = await this.#pool.query<SqlRow>(
      `WITH selected_run AS (
         SELECT * FROM signal_runs WHERE source_kind = 'live_journal'
         ORDER BY
           (state IN ('pending','active','closing')) DESC,
           (run_id = (SELECT active_run_id FROM signal_worker_status WHERE singleton)) DESC,
           created_at DESC LIMIT 1
       )
       SELECT status.lifecycle, status.active_run_id, status.heartbeat_at,
              status.last_evaluated_bar_start, status.revision_gap_detected,
              status.backlog_count, status.failure_code,
              run.run_id, run.state, run.cursor_position, run.stop_position,
              run.definition_version, run.configuration_version, run.configuration_hash,
              run.arithmetic_policy_version, run.calendar_version,
              run.market_event_schema_version, run.revision_schema_version,
              run.feature_schema_version, run.evaluation_schema_version,
              run.data_quality_policy_version, run.freshness_threshold_ms,
              run.lookback_window, run.volume_multiplier
       FROM signal_worker_status AS status LEFT JOIN selected_run AS run ON true
       WHERE status.singleton`,
    );
    const row = selected.rows[0];
    if (row === undefined) throw new SignalsWorkerError('stored_data_invalid');
    const runId = row.run_id === null ? null : text(row.run_id, 'run_id');
    const latest =
      runId === null
        ? { rows: [] as readonly SqlRow[] }
        : await this.#pool.query<SqlRow>(
            `WITH supported_symbols (instrument_symbol) AS (
               VALUES ('AAPL'::text), ('SPY'::text)
             ), run_scope AS (
               SELECT run_id, definition_version, configuration_hash
               FROM signal_runs
               WHERE run_id = $1 AND source_kind = 'live_journal'
             ), bounded_projection AS (
               SELECT selected.projection_kind, selected.evaluation_id,
                      selected.occurrence_id
               FROM run_scope AS run
               CROSS JOIN supported_symbols AS symbol
               CROSS JOIN LATERAL (
                 (
                   SELECT 'latest'::text AS projection_kind,
                          current.evaluation_id, current.occurrence_id
                   FROM signal_run_latest_evaluations AS current
                   WHERE current.run_id = run.run_id
                     AND current.definition_version = run.definition_version
                     AND current.configuration_hash = run.configuration_hash
                     AND current.instrument_symbol = symbol.instrument_symbol
                   ORDER BY current.evaluation_bar_start DESC,
                            current.source_ordinal DESC, current.evaluation_id DESC
                   LIMIT 1
                 )
                 UNION ALL
                 (
                   SELECT 'latest_fired'::text AS projection_kind,
                          current.evaluation_id, current.occurrence_id
                   FROM signal_run_latest_evaluations AS current
                   WHERE current.run_id = run.run_id
                     AND current.definition_version = run.definition_version
                     AND current.configuration_hash = run.configuration_hash
                     AND current.instrument_symbol = symbol.instrument_symbol
                     AND current.occurrence_id IS NOT NULL
                   ORDER BY current.evaluation_bar_start DESC,
                            current.source_ordinal DESC, current.evaluation_id DESC
                   LIMIT 1
                 )
               ) AS selected
             )
             SELECT projection.projection_kind,
                    evaluation.instrument_symbol, evaluation.instrument_venue,
                    evaluation.evaluation_bar_start, evaluation.outcome, evaluation.reason,
                    evaluation.direction, evaluation.observation_as_of, evaluation.knowledge_as_of,
                    evaluation.evaluation_mode, evaluation.close_price,
                    evaluation.source_provider, evaluation.source_feed,
                    evaluation.source_entitlement,
                    evaluation.breakout_reference, evaluation.prior_high, evaluation.prior_low,
                    evaluation.current_volume,
                    evaluation.prior_volume_sum, evaluation.prior_count,
                    evaluation.volume_multiplier, evaluation.window_start, evaluation.window_end,
                    evaluation.invalidation_condition, projection.occurrence_id
             FROM bounded_projection AS projection
             JOIN signal_evaluations AS evaluation
               ON evaluation.evaluation_id = projection.evaluation_id
             ORDER BY evaluation.instrument_symbol,
                      CASE projection.projection_kind WHEN 'latest' THEN 0 ELSE 1 END,
                      evaluation.evaluation_bar_start DESC, evaluation.evaluation_id DESC`,
            [runId],
          );
    const latestMarketDataRows = await this.#pool.query<SqlRow>(
      `SELECT DISTINCT ON (bar.instrument_symbol) ledger.event_json,
              ledger.freshness_threshold_ms
       FROM market_data_one_minute_bars AS bar
       JOIN market_data_event_ledger AS ledger ON ledger.event_id = bar.event_id
       WHERE bar.instrument_symbol IN ('AAPL', 'SPY')
       ORDER BY bar.instrument_symbol, bar.bar_start DESC, bar.event_id DESC`,
    );
    const latestMarketData: {
      AAPL: SignalStatusMarketData | undefined;
      SPY: SignalStatusMarketData | undefined;
    } = { AAPL: undefined, SPY: undefined };
    for (const marketRow of latestMarketDataRows.rows) {
      const event = marketEvent(marketRow.event_json, 'event_json');
      const freshnessThresholdMs = integer(
        marketRow.freshness_threshold_ms,
        'freshness_threshold_ms',
      );
      if (freshnessThresholdMs < 60_000 || freshnessThresholdMs > 300_000) {
        throw new SignalsWorkerError('stored_data_invalid');
      }
      const marketData = Object.freeze({ event, freshnessThresholdMs });
      const symbol = event.instrument.symbol;
      if (symbol === 'AAPL') {
        if (latestMarketData.AAPL !== undefined) {
          throw new SignalsWorkerError('stored_data_invalid');
        }
        latestMarketData.AAPL = marketData;
      } else if (symbol === 'SPY') {
        if (latestMarketData.SPY !== undefined) {
          throw new SignalsWorkerError('stored_data_invalid');
        }
        latestMarketData.SPY = marketData;
      } else {
        throw new SignalsWorkerError('stored_data_invalid');
      }
    }
    if (latest.rows.length > 4) throw new SignalsWorkerError('stored_data_invalid');
    const seenProjections = new Set<string>();
    const evaluations: SignalStatusEvaluation[] = [];
    const latestValidFired: SignalStatusEvaluation[] = [];
    for (const value of latest.rows) {
      const symbol = text(value.instrument_symbol, 'instrument_symbol');
      if (symbol !== 'AAPL' && symbol !== 'SPY') {
        throw new SignalsWorkerError('stored_data_invalid');
      }
      const projectionKind = text(value.projection_kind, 'projection_kind');
      if (projectionKind !== 'latest' && projectionKind !== 'latest_fired') {
        throw new SignalsWorkerError('stored_data_invalid');
      }
      const projectionKey = `${symbol}:${projectionKind}`;
      if (seenProjections.has(projectionKey)) {
        throw new SignalsWorkerError('stored_data_invalid');
      }
      seenProjections.add(projectionKey);
      const statusEvaluation: SignalStatusEvaluation = {
        symbol,
        venue: text(value.instrument_venue, 'instrument_venue'),
        evaluationBarStart: timestamp(value.evaluation_bar_start, 'evaluation_bar_start'),
        outcome: text(value.outcome, 'outcome'),
        reason: text(value.reason, 'reason'),
        direction: optionalText(value.direction, 'direction'),
        observationAsOf: timestamp(value.observation_as_of, 'observation_as_of'),
        knowledgeAsOf: timestamp(value.knowledge_as_of, 'knowledge_as_of'),
        mode: text(value.evaluation_mode, 'evaluation_mode'),
        sourceProvider: text(value.source_provider, 'source_provider'),
        sourceFeed: text(value.source_feed, 'source_feed'),
        sourceEntitlement: text(value.source_entitlement, 'source_entitlement'),
        closePrice: optionalText(value.close_price, 'close_price'),
        breakoutReference: optionalText(value.breakout_reference, 'breakout_reference'),
        priorHigh: optionalText(value.prior_high, 'prior_high'),
        priorLow: optionalText(value.prior_low, 'prior_low'),
        currentVolume: optionalText(value.current_volume, 'current_volume'),
        priorVolumeSum: optionalText(value.prior_volume_sum, 'prior_volume_sum'),
        priorCount: value.prior_count === null ? null : integer(value.prior_count, 'prior_count'),
        volumeMultiplier: optionalText(value.volume_multiplier, 'volume_multiplier'),
        windowStart:
          value.window_start === null ? null : timestamp(value.window_start, 'window_start'),
        windowEnd: value.window_end === null ? null : timestamp(value.window_end, 'window_end'),
        invalidationCondition: optionalText(value.invalidation_condition, 'invalidation_condition'),
      };
      if (projectionKind === 'latest') {
        evaluations.push(statusEvaluation);
      } else {
        if (value.occurrence_id === null) throw new SignalsWorkerError('stored_data_invalid');
        text(value.occurrence_id, 'occurrence_id');
        latestValidFired.push(statusEvaluation);
      }
    }
    const lifecycle = text(row.lifecycle, 'lifecycle') as PersistedSignalStatus['lifecycle'];
    return Object.freeze({
      lifecycle,
      runId,
      runState: row.state === null ? null : text(row.state, 'state'),
      cursorPosition:
        row.cursor_position === null ? null : bigintText(row.cursor_position, 'cursor_position'),
      stopPosition:
        row.stop_position === null ? null : bigintText(row.stop_position, 'stop_position'),
      backlogCount: bigintText(row.backlog_count, 'backlog_count'),
      revisionGapDetected: boolean(row.revision_gap_detected, 'revision_gap_detected'),
      heartbeatAt: row.heartbeat_at === null ? null : timestamp(row.heartbeat_at, 'heartbeat_at'),
      lastEvaluatedBarStart:
        row.last_evaluated_bar_start === null
          ? null
          : timestamp(row.last_evaluated_bar_start, 'last_evaluated_bar_start'),
      failureCode: optionalText(row.failure_code, 'failure_code'),
      semantics:
        runId === null
          ? null
          : Object.freeze({
              definitionVersion: text(row.definition_version, 'definition_version'),
              configurationVersion: text(row.configuration_version, 'configuration_version'),
              configurationHash: text(row.configuration_hash, 'configuration_hash'),
              arithmeticPolicyVersion: text(
                row.arithmetic_policy_version,
                'arithmetic_policy_version',
              ),
              calendarVersion: text(row.calendar_version, 'calendar_version'),
              marketEventSchemaVersion: text(
                row.market_event_schema_version,
                'market_event_schema_version',
              ),
              revisionSchemaVersion: text(row.revision_schema_version, 'revision_schema_version'),
              featureSchemaVersion: text(row.feature_schema_version, 'feature_schema_version'),
              evaluationSchemaVersion: text(
                row.evaluation_schema_version,
                'evaluation_schema_version',
              ),
              dataQualityPolicyVersion: text(
                row.data_quality_policy_version,
                'data_quality_policy_version',
              ),
              freshnessThresholdMs: integer(row.freshness_threshold_ms, 'freshness_threshold_ms'),
              lookbackBars: integer(row.lookback_window, 'lookback_window'),
              volumeMultiplier: text(row.volume_multiplier, 'volume_multiplier'),
            }),
      latestMarketData: Object.freeze(latestMarketData),
      latest: Object.freeze(evaluations),
      latestValidFired: Object.freeze(latestValidFired),
    });
  }
}
