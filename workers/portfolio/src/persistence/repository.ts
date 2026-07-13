import {
  PORTFOLIO_ARITHMETIC_POLICY_VERSION,
  PORTFOLIO_REQUEST_RECEIPT_SCHEMA_VERSION,
  PORTFOLIO_VALUATION_POLICY_VERSION,
  createPortfolioPreparedProjection,
  hashPortfolioCanonical,
  parsePortfolioSyncSnapshot,
  reconcilePortfolioProjection,
  serializePortfolioAccountObservation,
  serializePortfolioFillObservation,
  serializePortfolioOrderObservation,
  serializePortfolioPositionObservation,
  serializePortfolioPreparedProjection,
  serializePortfolioProjection,
  serializePortfolioReconciliation,
  serializePortfolioSnapshotDelta,
  serializePortfolioSyncSnapshot,
  type PortfolioFingerprint,
  type PortfolioHoldingSupport,
  type PortfolioHoldingSupportReason,
  type PortfolioPreparedProjection,
  type PortfolioProjection,
  type PortfolioRequestReceipt,
  type PortfolioReconciliation,
  type PortfolioSnapshotDelta,
  type PortfolioSyncSnapshot,
} from '@daily-trader/portfolio';
import { instrumentKey, type UtcTimestamp } from '@daily-trader/domain';

import { PortfolioWorkerError } from '../errors.js';
import type { PortfolioWorkerConfig } from '../config.js';
import type { SqlClient, SqlPool, SqlRow } from './sql.js';

const CONFIGURATION_VERSION = 'daily-trader.portfolio.config.v1' as const;
const SAFE_FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;

export interface PortfolioLease {
  readonly ownerId: string;
  readonly fenceToken: string;
  readonly accountFingerprint: PortfolioFingerprint;
}

export interface PortfolioSyncHandle {
  readonly syncRunId: string;
  readonly lease: PortfolioLease;
  readonly captureStartedAt: UtcTimestamp;
}

export interface CurrentPortfolioSnapshot {
  readonly syncRunId: string;
  readonly snapshot: PortfolioSyncSnapshot;
}

export interface PortfolioRepositoryStatus {
  readonly lifecycle: string;
  readonly failureCode: string | null;
  readonly heartbeatAt: string;
  readonly lastSyncStartedAt: string | null;
  readonly lastSyncCompletedAt: string | null;
  readonly currentSyncRunId: string | null;
  readonly currentSnapshotAt: string | null;
  readonly projectionState: string | null;
  readonly reconciliationState: string | null;
  readonly changeState: string | null;
  readonly positionCount: number | null;
  readonly orderCount: number | null;
  readonly fillCount: number | null;
}

interface LeaseRow extends SqlRow {
  readonly fence_token: unknown;
}

interface SnapshotRow extends SqlRow {
  readonly sync_run_id: unknown;
  readonly snapshot_hash: unknown;
  readonly snapshot_payload: unknown;
  readonly prepared_projection_id: unknown;
  readonly prepared_projection_payload: unknown;
  readonly reconciliation_id: unknown;
  readonly reconciliation_payload: unknown;
  readonly expected_portfolio_result_id: unknown;
  readonly integrity_state: unknown;
  readonly projection_hash: unknown;
}

interface ReceiptMatchRow extends SqlRow {
  readonly matches: unknown;
}

interface RequestReceiptRow extends SqlRow {
  readonly resource: unknown;
  readonly ordinal: unknown;
  readonly provider_request_fingerprint: unknown;
  readonly response_status: unknown;
}

interface PersistedAccountProjectionRow extends SqlRow {
  readonly account_fingerprint: unknown;
  readonly canonical_hash: unknown;
}

interface PersistedPositionProjectionRow extends SqlRow {
  readonly provider_asset_id: unknown;
  readonly canonical_hash: unknown;
  readonly supported_for_projection: unknown;
  readonly unsupported_reason: unknown;
}

interface PersistedOrderProjectionRow extends SqlRow {
  readonly provider_order_id: unknown;
  readonly canonical_hash: unknown;
  readonly supported_for_monitoring: unknown;
  readonly unsupported_reason: unknown;
}

interface PersistedFillProjectionRow extends SqlRow {
  readonly provider_activity_id: unknown;
  readonly canonical_hash: unknown;
}

interface PersistedProjectionResultRow extends SqlRow {
  readonly canonical_hash: unknown;
}

const PORTFOLIO_FINGERPRINT = /^[0-9a-f]{64}$/u;
const PORTFOLIO_SUPPORT_REASONS: readonly PortfolioHoldingSupportReason[] = [
  'missing_instrument',
  'unsupported_asset_class',
  'unsupported_currency',
  'unsupported_venue',
];

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PortfolioWorkerError('database_unavailable', `Invalid ${field}`, true);
  }
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function fingerprint(value: unknown, field: string): PortfolioFingerprint {
  const candidate = text(value, field);
  if (!PORTFOLIO_FINGERPRINT.test(candidate)) {
    throw new PortfolioWorkerError('database_unavailable', `Invalid ${field}`, false);
  }
  return candidate as PortfolioFingerprint;
}

function holdingSupport(
  supported: unknown,
  reason: unknown,
  field: string,
): PortfolioHoldingSupport {
  if (supported === true && reason === null) {
    return Object.freeze({ state: 'supported', reason: null });
  }
  if (
    supported === false &&
    typeof reason === 'string' &&
    PORTFOLIO_SUPPORT_REASONS.includes(reason as PortfolioHoldingSupportReason)
  ) {
    return Object.freeze({
      state: 'unsupported',
      reason: reason as PortfolioHoldingSupportReason,
    });
  }
  throw new PortfolioWorkerError('database_unavailable', `Invalid ${field}`, false);
}

function count(value: unknown, field: string): number | null {
  if (value === null) return null;
  const candidate = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new PortfolioWorkerError('database_unavailable', `Invalid ${field}`, true);
  }
  return candidate;
}

function validateCompleteRequestEvidence(
  rows: readonly RequestReceiptRow[],
  snapshot: PortfolioSyncSnapshot,
): void {
  const pages = new Map<string, number[]>([
    ['account', []],
    ['positions', []],
    ['orders', []],
    ['fills', []],
  ]);
  const requestFingerprints: string[] = [];
  for (const row of rows) {
    const resource = text(row.resource, 'request resource');
    const ordinals = pages.get(resource);
    const ordinal = count(row.ordinal, 'request ordinal');
    const responseStatus = count(row.response_status, 'request response status');
    if (ordinals === undefined || ordinal === null || responseStatus !== 200) {
      throw new PortfolioWorkerError(
        'sync_failed',
        'Portfolio request evidence is incomplete',
        false,
      );
    }
    ordinals.push(ordinal);
    requestFingerprints.push(
      text(row.provider_request_fingerprint, 'provider request fingerprint'),
    );
  }
  const isContiguous = (ordinals: readonly number[]): boolean =>
    ordinals.length > 0 &&
    [...ordinals].sort((left, right) => left - right).every((ordinal, index) => ordinal === index);
  if (
    pages.get('account')?.length !== 1 ||
    pages.get('account')?.[0] !== 0 ||
    pages.get('positions')?.length !== 1 ||
    pages.get('positions')?.[0] !== 0 ||
    !isContiguous(pages.get('orders') ?? []) ||
    !isContiguous(pages.get('fills') ?? []) ||
    [...requestFingerprints].sort().join(',') !==
      [...snapshot.sourceRequestFingerprints].sort().join(',')
  ) {
    throw new PortfolioWorkerError(
      'sync_failed',
      'Portfolio request evidence does not match the complete snapshot',
      false,
    );
  }
}

function configuration(config: PortfolioWorkerConfig): {
  readonly hash: PortfolioFingerprint;
  readonly payload: string;
} {
  const payload = JSON.stringify({
    schemaVersion: CONFIGURATION_VERSION,
    mode: config.portfolio.mode,
    provider: config.portfolio.provider,
    operational: config.portfolio.operational,
    brokerMode: config.trading.brokerMode,
    executionEnabled: config.trading.executionEnabled,
  });
  return Object.freeze({ hash: hashPortfolioCanonical(payload), payload });
}

async function transaction<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function requireLease(client: SqlClient, lease: PortfolioLease): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM portfolio_worker_status
      WHERE singleton
        AND owner_id = $1
        AND fence_token = $2::bigint
        AND account_fingerprint = $3
        AND lease_expires_at > clock_timestamp()
      FOR UPDATE`,
    [lease.ownerId, lease.fenceToken, lease.accountFingerprint],
  );
  if (result.rows.length !== 1) {
    throw new PortfolioWorkerError('claim_lost', 'Portfolio worker lease was lost', false);
  }
}

function nullableTimestampOriginal(
  value: Readonly<{ readonly original: string }> | null,
): string | null {
  return value?.original ?? null;
}

function nullableTimestampUtc(value: Readonly<{ readonly utc: string }> | null): string | null {
  return value?.utc ?? null;
}

function safeFailureCode(value: string): string {
  if (!SAFE_FAILURE_CODE.test(value)) {
    throw new PortfolioWorkerError('sync_failed', 'Portfolio failure code is invalid', false);
  }
  return value;
}

async function readPersistedPreparedProjection(
  database: Pick<SqlClient, 'query'>,
  syncRunId: string,
  snapshotId: PortfolioFingerprint,
): Promise<
  Readonly<{
    prepared: PortfolioPreparedProjection;
    projectionId: PortfolioFingerprint;
  }>
> {
  const accountResult = await database.query<PersistedAccountProjectionRow>(
    `SELECT account_fingerprint, canonical_hash
       FROM portfolio_account_observations
      WHERE sync_run_id = $1`,
    [syncRunId],
  );
  const account = accountResult.rows[0];
  if (accountResult.rows.length !== 1 || account === undefined) {
    throw new PortfolioWorkerError(
      'database_unavailable',
      'Persisted portfolio account evidence is incomplete',
      false,
    );
  }

  const positions = await database.query<PersistedPositionProjectionRow>(
    `SELECT provider_asset_id, canonical_hash,
            supported_for_projection, unsupported_reason
       FROM portfolio_position_observations
      WHERE sync_run_id = $1
      ORDER BY provider_asset_id`,
    [syncRunId],
  );
  const orders = await database.query<PersistedOrderProjectionRow>(
    `SELECT provider_order_id, canonical_hash,
            supported_for_monitoring, unsupported_reason
       FROM portfolio_order_observations
      WHERE sync_run_id = $1
      ORDER BY provider_order_id`,
    [syncRunId],
  );
  const fills = await database.query<PersistedFillProjectionRow>(
    `SELECT fill.provider_activity_id, fill.canonical_hash
       FROM portfolio_sync_fill_memberships AS membership
       JOIN portfolio_fill_observations AS fill
         ON fill.fill_observation_id = membership.fill_observation_id
      WHERE membership.sync_run_id = $1
      ORDER BY membership.ordinal`,
    [syncRunId],
  );
  const projectionResult = await database.query<PersistedProjectionResultRow>(
    `SELECT canonical_hash
       FROM portfolio_projections
      WHERE sync_run_id = $1`,
    [syncRunId],
  );
  const projection = projectionResult.rows[0];
  if (projectionResult.rows.length !== 1 || projection === undefined) {
    throw new PortfolioWorkerError(
      'database_unavailable',
      'Persisted portfolio projection evidence is incomplete',
      false,
    );
  }

  const projectionId = fingerprint(projection.canonical_hash, 'projection hash');
  const prepared = createPortfolioPreparedProjection({
    snapshotId,
    accountFingerprint: fingerprint(account.account_fingerprint, 'account fingerprint'),
    accountObservationId: fingerprint(account.canonical_hash, 'account observation hash'),
    positions: positions.rows.map((row) => ({
      assetFingerprint: fingerprint(row.provider_asset_id, 'position asset fingerprint'),
      observationId: fingerprint(row.canonical_hash, 'position observation hash'),
      support: holdingSupport(
        row.supported_for_projection,
        row.unsupported_reason,
        'position support',
      ),
    })),
    orders: orders.rows.map((row) => ({
      orderFingerprint: fingerprint(row.provider_order_id, 'order fingerprint'),
      observationId: fingerprint(row.canonical_hash, 'order observation hash'),
      support: holdingSupport(
        row.supported_for_monitoring,
        row.unsupported_reason,
        'order support',
      ),
    })),
    fills: fills.rows.map((row) => ({
      fillFingerprint: fingerprint(row.provider_activity_id, 'fill fingerprint'),
      observationId: fingerprint(row.canonical_hash, 'fill observation hash'),
    })),
    portfolioResultId: projectionId,
  });
  return Object.freeze({ prepared, projectionId });
}

/** Append-only PostgreSQL adapter for complete paper-portfolio synchronization cycles. */
export class PortfolioRepository {
  readonly #pool: SqlPool;
  readonly #config: ReturnType<typeof configuration>;

  public constructor(pool: SqlPool, config: PortfolioWorkerConfig) {
    this.#pool = pool;
    this.#config = configuration(config);
  }

  public async acquireLease(input: {
    readonly ownerId: string;
    readonly accountFingerprint: PortfolioFingerprint;
    readonly now: UtcTimestamp;
    readonly leaseMs: number;
  }): Promise<PortfolioLease> {
    void input.now;
    const result = await this.#pool.query<LeaseRow>(
      `UPDATE portfolio_worker_status
          SET owner_id = $1,
              account_fingerprint = $2,
              fence_token = fence_token + 1,
              lifecycle = CASE WHEN failure_code IS NULL THEN 'starting' ELSE 'degraded' END,
              heartbeat_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + ($3::text || ' milliseconds')::interval,
              updated_at = clock_timestamp()
        WHERE singleton
          AND (owner_id IS NULL OR lease_expires_at <= clock_timestamp() OR owner_id = $1)
        RETURNING fence_token::text`,
      [input.ownerId, input.accountFingerprint, String(input.leaseMs)],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PortfolioWorkerError('claim_lost', 'Portfolio worker lease is already owned', true);
    }
    const lease = Object.freeze({
      ownerId: input.ownerId,
      fenceToken: text(row.fence_token, 'fence_token'),
      accountFingerprint: input.accountFingerprint,
    });
    await this.#pool.query(
      `UPDATE portfolio_sync_runs
          SET state = 'failed',
              capture_completed_at = GREATEST(clock_timestamp(), capture_started_at),
              failure_code = 'worker_restarted'
        WHERE state = 'pending'
          AND (claim_owner_id <> $1 OR claim_fence < $2::bigint)`,
      [lease.ownerId, lease.fenceToken],
    );
    return lease;
  }

  public async renewLease(
    lease: PortfolioLease,
    now: UtcTimestamp,
    leaseMs: number,
  ): Promise<void> {
    void now;
    const result = await this.#pool.query(
      `UPDATE portfolio_worker_status
          SET heartbeat_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + ($1::text || ' milliseconds')::interval,
              updated_at = clock_timestamp()
        WHERE singleton
          AND owner_id = $2
          AND fence_token = $3::bigint
          AND account_fingerprint = $4
          AND lease_expires_at > clock_timestamp()`,
      [String(leaseMs), lease.ownerId, lease.fenceToken, lease.accountFingerprint],
    );
    if (result.rowCount !== 1) {
      throw new PortfolioWorkerError('claim_lost', 'Portfolio worker lease renewal failed', false);
    }
  }

  public async beginSync(input: {
    readonly syncRunId: string;
    readonly lease: PortfolioLease;
    readonly captureStartedAt: UtcTimestamp;
  }): Promise<PortfolioSyncHandle> {
    await transaction(this.#pool, async (client) => {
      await requireLease(client, input.lease);
      await client.query(
        `UPDATE portfolio_sync_runs
            SET state = 'failed',
                capture_completed_at = GREATEST(clock_timestamp(), capture_started_at),
                failure_code = 'superseded_retry'
          WHERE state = 'pending'
            AND claim_owner_id = $1
            AND claim_fence = $2::bigint
            AND sync_run_id <> $3`,
        [input.lease.ownerId, input.lease.fenceToken, input.syncRunId],
      );
      await client.query(
        `INSERT INTO portfolio_sync_runs (
           sync_run_id, state, source_provider, source_environment, snapshot_schema_version,
           account_fingerprint, configuration_version, configuration_hash,
           configuration_payload, claim_owner_id, claim_fence, capture_started_at
         ) VALUES ($1, 'pending', 'alpaca', 'paper',
           'daily-trader.portfolio.sync-snapshot.v1', $2,
           $3, $4, $5, $6, $7::bigint, $8::timestamptz)`,
        [
          input.syncRunId,
          input.lease.accountFingerprint,
          CONFIGURATION_VERSION,
          this.#config.hash,
          this.#config.payload,
          input.lease.ownerId,
          input.lease.fenceToken,
          input.captureStartedAt,
        ],
      );
      await client.query(
        `UPDATE portfolio_worker_status
            SET lifecycle = CASE WHEN failure_code IS NULL THEN 'running' ELSE 'degraded' END,
                last_sync_started_at = $1::timestamptz,
                heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE singleton`,
        [input.captureStartedAt],
      );
    });
    return Object.freeze(input);
  }

  public async readCurrentSnapshot(): Promise<CurrentPortfolioSnapshot | null> {
    const result = await this.#pool.query<SnapshotRow>(
      `SELECT run.sync_run_id, run.snapshot_hash, run.snapshot_payload,
              reconciliation.prepared_projection_id,
              reconciliation.prepared_projection_payload,
              reconciliation.reconciliation_id,
              reconciliation.reconciliation_payload,
              reconciliation.expected_portfolio_result_id,
              reconciliation.integrity_state,
              projection.canonical_hash AS projection_hash
         FROM portfolio_current_snapshot AS current
         JOIN portfolio_sync_runs AS run USING (sync_run_id)
         LEFT JOIN portfolio_reconciliations AS reconciliation USING (sync_run_id)
         LEFT JOIN portfolio_projections AS projection USING (sync_run_id)
        WHERE current.singleton AND run.state = 'completed'`,
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    try {
      const syncRunId = text(row.sync_run_id, 'sync_run_id');
      const serializedSnapshot = text(row.snapshot_payload, 'snapshot_payload');
      const snapshot = parsePortfolioSyncSnapshot(serializedSnapshot);
      const persisted = await readPersistedPreparedProjection(
        this.#pool,
        syncRunId,
        snapshot.snapshotId,
      );
      const reconciliation = reconcilePortfolioProjection(
        snapshot,
        persisted.prepared,
        persisted.projectionId,
      );
      if (
        fingerprint(row.snapshot_hash, 'snapshot hash') !== snapshot.snapshotId ||
        serializePortfolioSyncSnapshot(snapshot) !== serializedSnapshot ||
        fingerprint(row.projection_hash, 'projection hash') !== persisted.projectionId ||
        text(row.integrity_state, 'reconciliation integrity') !== 'converged' ||
        fingerprint(row.prepared_projection_id, 'prepared projection id') !==
          persisted.prepared.preparedProjectionId ||
        text(row.prepared_projection_payload, 'prepared projection payload') !==
          serializePortfolioPreparedProjection(persisted.prepared) ||
        fingerprint(row.expected_portfolio_result_id, 'expected portfolio result id') !==
          persisted.projectionId ||
        fingerprint(row.reconciliation_id, 'reconciliation id') !==
          reconciliation.reconciliationId ||
        text(row.reconciliation_payload, 'reconciliation payload') !==
          serializePortfolioReconciliation(reconciliation) ||
        reconciliation.status !== 'converged'
      ) {
        throw new PortfolioWorkerError(
          'database_unavailable',
          'Stored portfolio projection integrity did not converge',
          false,
        );
      }
      return Object.freeze({
        syncRunId,
        snapshot,
      });
    } catch (error) {
      if (error instanceof PortfolioWorkerError) throw error;
      throw new PortfolioWorkerError('database_unavailable', 'Stored snapshot is invalid', false);
    }
  }

  public async recordRequestReceipt(
    handle: PortfolioSyncHandle,
    receipt: PortfolioRequestReceipt,
  ): Promise<void> {
    if (receipt.receivedAt < handle.captureStartedAt) {
      throw new PortfolioWorkerError(
        'sync_failed',
        'Portfolio request receipt predates its synchronization cycle',
        false,
      );
    }
    await transaction(this.#pool, async (client) => {
      await requireLease(client, handle.lease);
      const inserted = await client.query(
        `INSERT INTO portfolio_sync_requests (
           sync_run_id, schema_version, capture_attempt, resource, ordinal,
           provider_request_fingerprint, observed_at, response_status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8)
         ON CONFLICT DO NOTHING`,
        [
          handle.syncRunId,
          PORTFOLIO_REQUEST_RECEIPT_SCHEMA_VERSION,
          receipt.captureAttempt,
          receipt.resource,
          receipt.pageOrdinal,
          receipt.requestFingerprint,
          receipt.receivedAt,
          receipt.responseStatus,
        ],
      );
      if (inserted.rowCount === 1) return;
      await requireLease(client, handle.lease);
      const existing = await client.query<ReceiptMatchRow>(
        `SELECT true AS matches
           FROM portfolio_sync_requests
          WHERE sync_run_id = $1
            AND schema_version = $2
            AND capture_attempt = $3
            AND resource = $4
            AND ordinal = $5
            AND provider_request_fingerprint = $6
            AND observed_at = $7::timestamptz
            AND response_status = $8`,
        [
          handle.syncRunId,
          PORTFOLIO_REQUEST_RECEIPT_SCHEMA_VERSION,
          receipt.captureAttempt,
          receipt.resource,
          receipt.pageOrdinal,
          receipt.requestFingerprint,
          receipt.receivedAt,
          receipt.responseStatus,
        ],
      );
      if (existing.rows[0]?.matches !== true) {
        throw new PortfolioWorkerError(
          'sync_failed',
          'Portfolio request receipt conflicts with existing evidence',
          false,
        );
      }
    });
  }

  public async completeSync(input: {
    readonly handle: PortfolioSyncHandle;
    readonly finalCaptureAttempt: number;
    readonly snapshot: PortfolioSyncSnapshot;
    readonly previousSyncRunId: string | null;
    readonly prepared: PortfolioPreparedProjection;
    readonly projectionBasisReconciliation: PortfolioReconciliation;
    readonly reconciliation: PortfolioReconciliation;
    readonly delta: PortfolioSnapshotDelta;
    readonly projection: PortfolioProjection;
  }): Promise<void> {
    const { handle, snapshot } = input;
    if (
      !Number.isSafeInteger(input.finalCaptureAttempt) ||
      input.finalCaptureAttempt < 1 ||
      input.finalCaptureAttempt > 1_000 ||
      snapshot.accountFingerprint !== handle.lease.accountFingerprint ||
      input.prepared.snapshotId !== snapshot.snapshotId ||
      input.prepared.portfolioResultId !== input.projection.projectionId ||
      input.reconciliation.status !== 'converged' ||
      input.reconciliation.snapshotId !== snapshot.snapshotId ||
      input.reconciliation.preparedProjectionId !== input.prepared.preparedProjectionId ||
      input.delta.currentSnapshotId !== snapshot.snapshotId ||
      input.projection.snapshotId !== snapshot.snapshotId ||
      input.projection.reconciliationId !== input.projectionBasisReconciliation.reconciliationId ||
      input.reconciliation.expectedPortfolioResultId !== input.projection.projectionId
    ) {
      throw new PortfolioWorkerError(
        'projection_failed',
        'Portfolio candidate is inconsistent',
        false,
      );
    }
    const completedAt = snapshot.knowledgeInterval.captureCompletedAt;
    await transaction(this.#pool, async (client) => {
      await requireLease(client, handle.lease);
      const requestEvidence = await client.query<RequestReceiptRow>(
        `SELECT resource, ordinal, provider_request_fingerprint, response_status
           FROM portfolio_sync_requests
          WHERE sync_run_id = $1
            AND capture_attempt = $2
            AND observed_at >= $3::timestamptz
            AND observed_at <= $4::timestamptz
          ORDER BY resource, ordinal`,
        [
          handle.syncRunId,
          input.finalCaptureAttempt,
          snapshot.knowledgeInterval.captureStartedAt,
          completedAt,
        ],
      );
      validateCompleteRequestEvidence(requestEvidence.rows, snapshot);
      await this.#insertAccount(client, handle.syncRunId, snapshot);
      await this.#insertPositions(client, handle.syncRunId, snapshot);
      await this.#insertOrders(client, handle.syncRunId, snapshot);
      await this.#insertFills(client, handle.syncRunId, snapshot);
      await this.#insertProjection(client, handle.syncRunId, snapshot, input.projection);

      const persisted = await readPersistedPreparedProjection(
        client,
        handle.syncRunId,
        snapshot.snapshotId,
      );
      const persistedStructuralPrepared = createPortfolioPreparedProjection({
        snapshotId: persisted.prepared.snapshotId,
        accountFingerprint: persisted.prepared.accountFingerprint,
        accountObservationId: persisted.prepared.accountObservationId,
        positions: persisted.prepared.positions,
        orders: persisted.prepared.orders,
        fills: persisted.prepared.fills,
        portfolioResultId: null,
      });
      const persistedBasisReconciliation = reconcilePortfolioProjection(
        snapshot,
        persistedStructuralPrepared,
        null,
      );
      const persistedReconciliation = reconcilePortfolioProjection(
        snapshot,
        persisted.prepared,
        persisted.projectionId,
      );
      if (
        persisted.projectionId !== input.projection.projectionId ||
        persisted.prepared.preparedProjectionId !== input.prepared.preparedProjectionId ||
        persistedBasisReconciliation.status !== 'converged' ||
        persistedBasisReconciliation.reconciliationId !==
          input.projectionBasisReconciliation.reconciliationId ||
        persistedReconciliation.status !== 'converged' ||
        persistedReconciliation.reconciliationId !== input.reconciliation.reconciliationId
      ) {
        throw new PortfolioWorkerError(
          'projection_failed',
          'Persisted portfolio projection did not reconcile',
          false,
        );
      }
      await this.#insertReconciliation(client, handle.syncRunId, {
        ...input,
        prepared: persisted.prepared,
        projectionBasisReconciliation: persistedBasisReconciliation,
        reconciliation: persistedReconciliation,
      });
      await requireLease(client, handle.lease);

      const unsupportedCount = snapshot.positions.filter(
        (position) => position.support.state === 'unsupported',
      ).length;
      const result = await client.query(
        `UPDATE portfolio_sync_runs
            SET state = 'completed',
                account_fingerprint = $1,
                knowledge_start_at = $2::timestamptz,
                knowledge_end_at = $3::timestamptz,
                capture_completed_at = $3::timestamptz,
                activity_window_started_at = $14::timestamptz,
                activity_cutover_at = $15::timestamptz,
                activity_baseline_only = $16,
                final_capture_attempt = $13,
                position_count = $4,
                order_count = $5,
                fill_count = $6,
                unsupported_position_count = $7,
                snapshot_hash = $8,
                snapshot_payload = $9
          WHERE sync_run_id = $10 AND state = 'pending'
            AND claim_owner_id = $11 AND claim_fence = $12::bigint
            AND EXISTS (
              SELECT 1 FROM portfolio_worker_status AS worker
               WHERE worker.singleton
                 AND worker.owner_id = $11
                 AND worker.fence_token = $12::bigint
                 AND worker.account_fingerprint = $1
                 AND worker.lease_expires_at > clock_timestamp()
            )`,
        [
          snapshot.accountFingerprint,
          snapshot.knowledgeInterval.captureStartedAt,
          completedAt,
          snapshot.positions.length,
          snapshot.orders.length,
          snapshot.fills.length,
          unsupportedCount,
          snapshot.snapshotId,
          serializePortfolioSyncSnapshot(snapshot),
          handle.syncRunId,
          handle.lease.ownerId,
          handle.lease.fenceToken,
          input.finalCaptureAttempt,
          snapshot.coverage.activityWindowStartedAt,
          snapshot.coverage.activityCutoverAt,
          snapshot.coverage.activityBaselineOnly,
        ],
      );
      if (result.rowCount !== 1) {
        throw new PortfolioWorkerError('claim_lost', 'Portfolio sync completion was fenced', false);
      }
      await client.query(
        `INSERT INTO portfolio_current_snapshot (singleton, sync_run_id, promoted_at)
         VALUES (true, $1, $2::timestamptz)
         ON CONFLICT (singleton) DO UPDATE
           SET sync_run_id = EXCLUDED.sync_run_id, promoted_at = EXCLUDED.promoted_at`,
        [handle.syncRunId, completedAt],
      );
      await client.query(
        `UPDATE portfolio_worker_status
            SET lifecycle = 'running', failure_code = NULL,
                last_sync_completed_at = $1::timestamptz,
                heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE singleton AND owner_id = $2 AND fence_token = $3::bigint`,
        [completedAt, handle.lease.ownerId, handle.lease.fenceToken],
      );
    });
  }

  public async failSync(
    handle: PortfolioSyncHandle,
    completedAt: UtcTimestamp,
    failureCode: string,
  ): Promise<void> {
    const boundedFailureCode = safeFailureCode(failureCode);
    await transaction(this.#pool, async (client) => {
      await requireLease(client, handle.lease);
      const result = await client.query(
        `UPDATE portfolio_sync_runs
            SET state = 'failed', capture_completed_at = $1::timestamptz,
                failure_code = $2
          WHERE sync_run_id = $3 AND state = 'pending'
            AND claim_owner_id = $4 AND claim_fence = $5::bigint
            AND EXISTS (
              SELECT 1 FROM portfolio_worker_status AS worker
               WHERE worker.singleton
                 AND worker.owner_id = $4
                 AND worker.fence_token = $5::bigint
                 AND worker.account_fingerprint = $6
                 AND worker.lease_expires_at > clock_timestamp()
            )`,
        [
          completedAt,
          boundedFailureCode,
          handle.syncRunId,
          handle.lease.ownerId,
          handle.lease.fenceToken,
          handle.lease.accountFingerprint,
        ],
      );
      if (result.rowCount !== 1) {
        throw new PortfolioWorkerError('claim_lost', 'Failed portfolio sync was fenced', false);
      }
      await client.query(
        `UPDATE portfolio_worker_status
            SET lifecycle = 'degraded', failure_code = $1,
                heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE singleton AND owner_id = $2 AND fence_token = $3::bigint`,
        [boundedFailureCode, handle.lease.ownerId, handle.lease.fenceToken],
      );
    });
  }

  public async releaseLease(input: {
    readonly lease: PortfolioLease;
    readonly now: UtcTimestamp;
    readonly failureCode?: string;
  }): Promise<void> {
    void input.now;
    const boundedFailureCode =
      input.failureCode === undefined ? null : safeFailureCode(input.failureCode);
    await this.#pool.query(
      `UPDATE portfolio_worker_status
          SET owner_id = NULL, account_fingerprint = NULL, lease_expires_at = NULL,
              lifecycle = CASE
                WHEN $1::text IS NOT NULL THEN 'failed'
                WHEN failure_code IS NOT NULL THEN 'degraded'
                ELSE 'stopped'
              END,
              failure_code = COALESCE($1, failure_code),
              heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE singleton AND owner_id = $2 AND fence_token = $3::bigint`,
      [boundedFailureCode, input.lease.ownerId, input.lease.fenceToken],
    );
  }

  public async readStatus(): Promise<PortfolioRepositoryStatus> {
    const result = await this.#pool.query<SqlRow>(
      `SELECT worker.lifecycle, worker.failure_code,
              worker.heartbeat_at::text, worker.last_sync_started_at::text,
              worker.last_sync_completed_at::text,
              current.sync_run_id,
              run.capture_completed_at::text AS current_snapshot_at,
              run.position_count, run.order_count, run.fill_count,
              projection.state AS projection_state,
              reconciliation.integrity_state AS reconciliation_state,
              reconciliation.change_state
         FROM portfolio_worker_status AS worker
         LEFT JOIN portfolio_current_snapshot AS current ON current.singleton
         LEFT JOIN portfolio_sync_runs AS run ON run.sync_run_id = current.sync_run_id
         LEFT JOIN portfolio_projections AS projection ON projection.sync_run_id = current.sync_run_id
         LEFT JOIN portfolio_reconciliations AS reconciliation
           ON reconciliation.sync_run_id = current.sync_run_id
        WHERE worker.singleton`,
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PortfolioWorkerError('database_unavailable', 'Portfolio status unavailable', true);
    }
    const status = Object.freeze({
      lifecycle: text(row.lifecycle, 'lifecycle'),
      failureCode: nullableText(row.failure_code, 'failure_code'),
      heartbeatAt: text(row.heartbeat_at, 'heartbeat_at'),
      lastSyncStartedAt: nullableText(row.last_sync_started_at, 'last_sync_started_at'),
      lastSyncCompletedAt: nullableText(row.last_sync_completed_at, 'last_sync_completed_at'),
      currentSyncRunId: nullableText(row.sync_run_id, 'sync_run_id'),
      currentSnapshotAt: nullableText(row.current_snapshot_at, 'current_snapshot_at'),
      projectionState: nullableText(row.projection_state, 'projection_state'),
      reconciliationState: nullableText(row.reconciliation_state, 'reconciliation_state'),
      changeState: nullableText(row.change_state, 'change_state'),
      positionCount: count(row.position_count, 'position_count'),
      orderCount: count(row.order_count, 'order_count'),
      fillCount: count(row.fill_count, 'fill_count'),
    });
    if (status.currentSyncRunId !== null) {
      const current = await this.readCurrentSnapshot();
      if (current === null || current.syncRunId !== status.currentSyncRunId) {
        throw new PortfolioWorkerError(
          'database_unavailable',
          'Current portfolio snapshot integrity is unavailable',
          false,
        );
      }
    }
    return status;
  }

  async #insertAccount(
    client: SqlClient,
    syncRunId: string,
    snapshot: PortfolioSyncSnapshot,
  ): Promise<void> {
    const value = snapshot.account;
    await client.query(
      `INSERT INTO portfolio_account_observations (
         sync_run_id, schema_version, account_fingerprint, source_request_fingerprint,
         provider_created_at_original, provider_created_at, observed_at, status, currency,
         cash, equity, last_equity, portfolio_value, buying_power,
         non_marginable_buying_power, regt_buying_power, long_market_value,
         short_market_value, initial_margin, maintenance_margin, last_maintenance_margin,
         accrued_fees, pending_transfer_in, pending_transfer_out, multiplier,
         account_blocked, trading_blocked, transfers_blocked, trade_suspended_by_user,
         shorting_enabled, canonical_hash, canonical_payload
       ) VALUES (
         $1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,
         $10::numeric,$11::numeric,$12::numeric,$13::numeric,$14::numeric,
         $15::numeric,$16::numeric,$17::numeric,$18::numeric,$19::numeric,$20::numeric,
         $21::numeric,$22::numeric,$23::numeric,$24::numeric,$25::numeric,
         $26,$27,$28,$29,$30,$31,$32
       )`,
      [
        syncRunId,
        value.schemaVersion,
        value.accountFingerprint,
        value.sourceRequestFingerprint,
        value.createdAt.original,
        value.createdAt.utc,
        value.observedAt,
        value.status,
        value.currency,
        value.cash,
        value.equity,
        value.lastEquity,
        value.portfolioValue,
        value.buyingPower,
        value.nonMarginableBuyingPower,
        value.regtBuyingPower,
        value.longMarketValue,
        value.shortMarketValue,
        value.initialMargin,
        value.maintenanceMargin,
        value.lastMaintenanceMargin,
        value.accruedFees,
        value.pendingTransferIn,
        value.pendingTransferOut,
        value.multiplier,
        value.accountBlocked,
        value.tradingBlocked,
        value.transfersBlocked,
        value.tradeSuspendedByUser,
        value.shortingEnabled,
        value.accountObservationId,
        serializePortfolioAccountObservation(value),
      ],
    );
  }

  async #insertPositions(
    client: SqlClient,
    syncRunId: string,
    snapshot: PortfolioSyncSnapshot,
  ): Promise<void> {
    for (const value of snapshot.positions) {
      await client.query(
        `INSERT INTO portfolio_position_observations (
           sync_run_id, schema_version, provider_asset_id, symbol, instrument_id,
           provider_exchange, asset_class, currency, source_request_fingerprint,
           supported_for_projection, unsupported_reason, asset_marginable, side,
           quantity, quantity_available, average_entry_price, cost_basis, market_value,
           current_price, last_day_price, change_today, unrealized_profit_loss,
           unrealized_profit_loss_percent, unrealized_intraday_profit_loss,
           unrealized_intraday_profit_loss_percent, observed_at, canonical_hash,
           canonical_payload
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
           $14::numeric,$15::numeric,$16::numeric,$17::numeric,$18::numeric,
           $19::numeric,$20::numeric,$21::numeric,$22::numeric,$23::numeric,
           $24::numeric,$25::numeric,$26::timestamptz,$27,$28
         )`,
        [
          syncRunId,
          value.schemaVersion,
          value.assetFingerprint,
          value.symbol,
          value.instrument === null ? null : instrumentKey(value.instrument),
          value.providerExchange,
          value.providerAssetClass,
          value.currency,
          value.sourceRequestFingerprint,
          value.support.state === 'supported',
          value.support.reason,
          value.assetMarginable,
          value.side,
          value.quantity,
          value.quantityAvailable,
          value.averageEntryPrice,
          value.costBasis,
          value.marketValue,
          value.currentPrice,
          value.lastDayPrice,
          value.changeToday,
          value.providerUnrealizedProfitLoss,
          value.providerUnrealizedProfitLossPercent,
          value.unrealizedIntradayProfitLoss,
          value.unrealizedIntradayProfitLossPercent,
          value.observedAt,
          value.positionObservationId,
          serializePortfolioPositionObservation(value),
        ],
      );
    }
  }

  async #insertOrders(
    client: SqlClient,
    syncRunId: string,
    snapshot: PortfolioSyncSnapshot,
  ): Promise<void> {
    for (const value of snapshot.orders) {
      await client.query(
        `INSERT INTO portfolio_order_observations (
           sync_run_id, schema_version, provider_order_id, client_order_id,
           provider_asset_id, symbol, instrument_id, asset_class,
           supported_for_monitoring, unsupported_reason, source_request_fingerprint,
           side, position_intent, order_type, time_in_force, order_class, status,
           quantity, notional, filled_quantity, filled_average_price, limit_price,
           stop_price, trail_price, trail_percent, high_water_mark, commission,
           extended_hours, replaces_order_id, replaced_by_order_id,
           provider_created_at_original, provider_created_at,
           provider_updated_at_original, provider_updated_at,
           provider_submitted_at_original, provider_submitted_at,
           provider_filled_at, provider_canceled_at, provider_failed_at,
           provider_replaced_at, provider_expired_at, observed_at,
           canonical_hash, canonical_payload
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
           $18::numeric,$19::numeric,$20::numeric,$21::numeric,$22::numeric,
           $23::numeric,$24::numeric,$25::numeric,$26::numeric,$27::numeric,
           $28,$29,$30,$31,$32::timestamptz,$33,$34::timestamptz,
           $35,$36::timestamptz,$37::timestamptz,$38::timestamptz,
           $39::timestamptz,$40::timestamptz,$41::timestamptz,$42::timestamptz,
           $43,$44
         )`,
        [
          syncRunId,
          value.schemaVersion,
          value.orderFingerprint,
          value.clientOrderFingerprint,
          value.assetFingerprint,
          value.symbol,
          value.instrument === null ? null : instrumentKey(value.instrument),
          value.providerAssetClass,
          value.support.state === 'supported',
          value.support.reason,
          value.sourceRequestFingerprint,
          value.side,
          value.positionIntent,
          value.orderType,
          value.timeInForce,
          value.orderClass,
          value.providerStatus,
          value.quantity,
          value.notional,
          value.filledQuantity,
          value.filledAveragePrice,
          value.limitPrice,
          value.stopPrice,
          value.trailPrice,
          value.trailPercent,
          value.highWaterMark,
          value.commission,
          value.extendedHours,
          value.replacesFingerprint,
          value.replacedByFingerprint,
          value.createdAt.original,
          value.createdAt.utc,
          nullableTimestampOriginal(value.updatedAt),
          nullableTimestampUtc(value.updatedAt),
          nullableTimestampOriginal(value.submittedAt),
          nullableTimestampUtc(value.submittedAt),
          nullableTimestampUtc(value.filledAt),
          nullableTimestampUtc(value.canceledAt),
          nullableTimestampUtc(value.failedAt),
          nullableTimestampUtc(value.replacedAt),
          nullableTimestampUtc(value.expiredAt),
          value.observedAt,
          value.orderObservationId,
          serializePortfolioOrderObservation(value),
        ],
      );
    }
  }

  async #insertFills(
    client: SqlClient,
    syncRunId: string,
    snapshot: PortfolioSyncSnapshot,
  ): Promise<void> {
    for (const [ordinal, value] of snapshot.fills.entries()) {
      await client.query(
        `INSERT INTO portfolio_fill_observations (
           fill_observation_id, schema_version, account_fingerprint,
           source_request_fingerprint, provider_activity_id, provider_order_id,
           provider_asset_id, symbol, instrument_id, side, activity_type, fill_type,
           quantity, price, cumulative_quantity, leaves_quantity,
           provider_transaction_at_original, provider_transaction_at, observed_at,
           first_observed_at, first_seen_run_id, canonical_hash, canonical_payload
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'FILL',$11,
           $12::numeric,$13::numeric,$14::numeric,$15::numeric,
           $16,$17::timestamptz,$18::timestamptz,$18::timestamptz,$19,$1,$20
         ) ON CONFLICT (fill_observation_id) DO NOTHING`,
        [
          value.fillObservationId,
          value.schemaVersion,
          value.accountFingerprint,
          value.sourceRequestFingerprint,
          value.fillFingerprint,
          value.orderFingerprint,
          value.assetFingerprint,
          value.symbol,
          value.instrument === null ? null : instrumentKey(value.instrument),
          value.side,
          value.type,
          value.quantity,
          value.price,
          value.cumulativeQuantity,
          value.leavesQuantity,
          value.transactionAt.original,
          value.transactionAt.utc,
          value.observedAt,
          syncRunId,
          serializePortfolioFillObservation(value),
        ],
      );
      await client.query(
        `INSERT INTO portfolio_sync_fill_memberships (
           sync_run_id, ordinal, fill_observation_id
         ) VALUES ($1,$2,$3)`,
        [syncRunId, ordinal, value.fillObservationId],
      );
    }
  }

  async #insertReconciliation(
    client: SqlClient,
    syncRunId: string,
    input: {
      readonly previousSyncRunId: string | null;
      readonly prepared: PortfolioPreparedProjection;
      readonly projectionBasisReconciliation: PortfolioReconciliation;
      readonly reconciliation: PortfolioReconciliation;
      readonly delta: PortfolioSnapshotDelta;
      readonly snapshot: PortfolioSyncSnapshot;
    },
  ): Promise<void> {
    const diff = input.delta.diff;
    await client.query(
      `INSERT INTO portfolio_reconciliations (
         sync_run_id, compared_sync_run_id, reconciliation_id,
         projection_basis_reconciliation_id, prepared_projection_id,
         expected_portfolio_result_id, snapshot_delta_id,
         integrity_state, change_state, failure_code,
         account_changed, positions_added, positions_changed, positions_removed,
         orders_added, orders_changed, orders_removed, fills_added, reconciled_at,
         prepared_projection_payload, projection_basis_reconciliation_payload,
         reconciliation_payload, snapshot_delta_payload
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16,$17,
         $18::timestamptz,$19,$20,$21,$22
       )`,
      [
        syncRunId,
        input.previousSyncRunId,
        input.reconciliation.reconciliationId,
        input.projectionBasisReconciliation.reconciliationId,
        input.prepared.preparedProjectionId,
        input.reconciliation.expectedPortfolioResultId,
        input.delta.deltaId,
        input.reconciliation.status,
        input.delta.status,
        diff.accountChanged,
        diff.positions.added.length,
        diff.positions.changed.length,
        diff.positions.removed.length,
        diff.orders.added.length,
        diff.orders.changed.length,
        diff.orders.removed.length,
        diff.fills.added.length,
        input.snapshot.knowledgeInterval.captureCompletedAt,
        serializePortfolioPreparedProjection(input.prepared),
        serializePortfolioReconciliation(input.projectionBasisReconciliation),
        serializePortfolioReconciliation(input.reconciliation),
        serializePortfolioSnapshotDelta(input.delta),
      ],
    );
  }

  async #insertProjection(
    client: SqlClient,
    syncRunId: string,
    snapshot: PortfolioSyncSnapshot,
    projection: PortfolioProjection,
  ): Promise<void> {
    const metrics = projection.state === 'complete' ? projection.metrics : null;
    const incompleteReason =
      projection.state === 'incomplete'
        ? projection.incompleteReasons.map((reason) => reason.code).join(',')
        : null;
    await client.query(
      `INSERT INTO portfolio_projections (
         sync_run_id, schema_version, state, incomplete_reason,
         arithmetic_policy_version, valuation_policy_version, currency,
         cash, equity, day_profit_loss, unrealized_profit_loss, gross_exposure,
         net_exposure, gross_exposure_percent, net_exposure_percent,
         concentration_percent, knowledge_start_at, knowledge_end_at,
         canonical_hash, canonical_payload
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10::numeric,
         $11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,
         $16::numeric,$17::timestamptz,$18::timestamptz,$19,$20
       )`,
      [
        syncRunId,
        projection.schemaVersion,
        projection.state,
        incompleteReason,
        PORTFOLIO_ARITHMETIC_POLICY_VERSION,
        PORTFOLIO_VALUATION_POLICY_VERSION,
        snapshot.account.currency,
        snapshot.account.cash,
        snapshot.account.equity,
        metrics?.dailyProfitLoss ?? null,
        metrics?.totalUnrealizedProfitLoss ?? null,
        metrics?.grossExposure ?? null,
        metrics?.netExposure ?? null,
        metrics?.grossExposurePercent ?? null,
        metrics?.netExposurePercent ?? null,
        metrics?.largestPositionConcentrationPercent ?? null,
        snapshot.knowledgeInterval.captureStartedAt,
        snapshot.knowledgeInterval.captureCompletedAt,
        projection.projectionId,
        serializePortfolioProjection(projection),
      ],
    );
    for (const position of projection.positions) {
      await client.query(
        `INSERT INTO portfolio_position_projections (
           sync_run_id, provider_asset_id, allocation_percent,
           projection_state, incomplete_reason
         ) VALUES ($1,$2,$3::numeric,$4,$5)`,
        [
          syncRunId,
          position.assetFingerprint,
          position.allocationPercent,
          position.state,
          position.state === 'incomplete' ? position.reasons.join(',') : null,
        ],
      );
    }
  }
}
