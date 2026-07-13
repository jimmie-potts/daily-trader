import { readFileSync } from 'node:fs';

import { loadConfig } from '@daily-trader/config';
import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import {
  classifyPortfolioSnapshotDelta,
  createPortfolioRequestReceipt,
  fingerprintPortfolioSourceIdentifier,
  preparePortfolioProjection,
  projectPortfolioSnapshot,
  reconcilePortfolioProjection,
  serializePortfolioPreparedProjection,
  serializePortfolioReconciliation,
  serializePortfolioSyncSnapshot,
  type PortfolioSyncSnapshot,
} from '@daily-trader/portfolio';
import { describe, expect, it } from 'vitest';

import { projectPortfolioWorkerConfig, type PortfolioWorkerConfig } from '../config.js';
import { PortfolioWorkerError } from '../errors.js';
import { AlpacaPaperPortfolioProvider, type AlpacaFetch } from '../providers/alpaca/index.js';
import {
  PortfolioRepository,
  type PortfolioLease,
  type PortfolioSyncHandle,
} from './repository.js';
import type { SqlClient, SqlPool, SqlQueryResult, SqlRow } from './sql.js';

const EXPECTED_ACCOUNT_ID = 'fixture-paper-account-id';
const NOW = createUtcTimestamp('2026-07-13T13:31:02.500Z');
const CLOCK = new FixedClock(NOW);

interface QueryRecord {
  readonly scope: 'client' | 'pool';
  readonly text: string;
  readonly parameters: readonly unknown[];
}

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/alpaca/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
}

function response(payload: unknown, requestId: string): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  });
}

async function normalizedSnapshot(
  overrides: Readonly<{ fills?: unknown; orders?: unknown }> = {},
): Promise<PortfolioSyncSnapshot> {
  const fetch: AlpacaFetch = (input) => {
    const pathname = new URL(input).pathname;
    const resource = pathname.endsWith('/account/activities/FILL')
      ? 'fills'
      : pathname.endsWith('/account')
        ? 'account'
        : pathname.endsWith('/positions')
          ? 'positions'
          : 'orders';
    const payload =
      resource === 'orders'
        ? (overrides.orders ?? fixture(resource))
        : resource === 'fills'
          ? (overrides.fills ?? fixture(resource))
          : fixture(resource);
    return Promise.resolve(response(payload, `repository-${resource}-request`));
  };
  return new AlpacaPaperPortfolioProvider(
    {
      apiKey: 'repository-fixture-key',
      apiSecret: 'repository-fixture-secret',
      expectedAccountId: EXPECTED_ACCOUNT_ID,
    },
    { clock: CLOCK, fetch },
  ).capture({ previousActivityCutoverAt: null });
}

function mlegOrders(): readonly unknown[] {
  return fixture('orders-mleg') as readonly unknown[];
}

function config(): PortfolioWorkerConfig {
  return projectPortfolioWorkerConfig(
    loadConfig({
      APP_ENV: 'test',
      PAPER_BROKER_API_KEY: 'repository-fixture-key',
      PAPER_BROKER_API_SECRET: 'repository-fixture-secret',
      PAPER_BROKER_ACCOUNT_ID: EXPECTED_ACCOUNT_ID,
      PORTFOLIO_MODE: 'paper_read_only',
    }),
  );
}

function compact(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function queryResult<Row extends SqlRow>(
  rows: readonly SqlRow[] = [],
  rowCount: number | null = rows.length,
): SqlQueryResult<Row> {
  return { rows: rows as readonly Row[], rowCount };
}

class DeterministicSqlPool implements SqlPool {
  public readonly calls: QueryRecord[] = [];
  public completionAllowed = true;
  public leaseAcquirable = true;
  public leaseCheckResults: boolean[] = [];
  public leaseValid = true;
  public renewalAllowed = true;
  public receiptInsertAllowed = true;
  public receiptMatches = true;
  public tamperPersistedPosition = false;
  public tamperPersistedPositionSupport = false;
  public tamperPersistedOrderSchema = false;
  public tamperSnapshotSchemaVersion = false;
  public readonly receiptRows: SqlRow[] = [];
  public readonly accountRows: SqlRow[] = [];
  public readonly positionRows: SqlRow[] = [];
  public readonly orderRows: SqlRow[] = [];
  public readonly fillRows: SqlRow[] = [];
  public readonly projectionRows: SqlRow[] = [];
  public currentSnapshot: Readonly<{
    readonly syncRunId: string;
    readonly snapshot: PortfolioSyncSnapshot;
  }> | null = null;
  public statusRow: SqlRow | null = null;

  public connect(): Promise<SqlClient> {
    return Promise.resolve(new DeterministicSqlClient(this));
  }

  public query<Row extends SqlRow = SqlRow>(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    return Promise.resolve(this.respond<Row>('pool', text, parameters));
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    return Promise.resolve();
  }

  public respond<Row extends SqlRow>(
    scope: QueryRecord['scope'],
    text: string,
    parameters: readonly unknown[],
  ): SqlQueryResult<Row> {
    const sql = compact(text);
    this.calls.push({ scope, text: sql, parameters });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return queryResult<Row>([], null);
    }
    if (sql.startsWith('SELECT 1 FROM portfolio_worker_status')) {
      const leaseValid = this.leaseCheckResults.shift() ?? this.leaseValid;
      return leaseValid ? queryResult<Row>([{ held: 1 }], 1) : queryResult<Row>([], 0);
    }
    if (sql.includes('RETURNING fence_token::text')) {
      return this.leaseAcquirable
        ? queryResult<Row>([{ fence_token: '7' }], 1)
        : queryResult<Row>([], 0);
    }
    if (
      sql.startsWith('UPDATE portfolio_worker_status SET heartbeat_at') &&
      sql.includes('lease_expires_at')
    ) {
      return queryResult<Row>([], this.renewalAllowed ? 1 : 0);
    }
    if (sql.startsWith("UPDATE portfolio_sync_runs SET state = 'completed'")) {
      return queryResult<Row>([], this.completionAllowed ? 1 : 0);
    }
    if (sql.startsWith('INSERT INTO portfolio_sync_requests')) {
      if (this.receiptInsertAllowed) {
        this.receiptRows.push({
          capture_attempt: parameters[2],
          resource: parameters[3],
          ordinal: parameters[4],
          provider_request_fingerprint: parameters[5],
          response_status: parameters[7],
        });
      }
      return queryResult<Row>([], this.receiptInsertAllowed ? 1 : 0);
    }
    if (sql.startsWith('SELECT true AS matches FROM portfolio_sync_requests')) {
      return this.receiptMatches
        ? queryResult<Row>([{ matches: true }], 1)
        : queryResult<Row>([], 0);
    }
    if (sql.startsWith('SELECT resource, ordinal, provider_request_fingerprint')) {
      return queryResult<Row>(
        this.receiptRows.filter(({ capture_attempt }) => capture_attempt === parameters[1]),
      );
    }
    if (sql.startsWith('INSERT INTO portfolio_account_observations')) {
      this.accountRows.push({
        account_fingerprint: parameters[2],
        canonical_hash: parameters[30],
      });
      return queryResult<Row>([], 1);
    }
    if (sql.startsWith('INSERT INTO portfolio_position_observations')) {
      this.positionRows.push({
        provider_asset_id: parameters[2],
        canonical_hash: this.tamperPersistedPosition ? 'f'.repeat(64) : parameters[26],
        supported_for_projection: this.tamperPersistedPositionSupport ? false : parameters[9],
        unsupported_reason: this.tamperPersistedPositionSupport
          ? 'unsupported_order_structure'
          : parameters[10],
      });
      return queryResult<Row>([], 1);
    }
    if (sql.startsWith('INSERT INTO portfolio_order_observations')) {
      this.orderRows.push({
        provider_order_id: parameters[2],
        schema_version: this.tamperPersistedOrderSchema
          ? 'daily-trader.portfolio.order-observation.v1'
          : parameters[1],
        canonical_hash: parameters[42],
        supported_for_monitoring: parameters[8],
        unsupported_reason: parameters[9],
      });
      return queryResult<Row>([], 1);
    }
    if (sql.startsWith('INSERT INTO portfolio_fill_observations')) {
      this.fillRows.push({
        provider_activity_id: parameters[4],
        canonical_hash: parameters[0],
      });
      return queryResult<Row>([], 1);
    }
    if (sql.startsWith('INSERT INTO portfolio_projections')) {
      this.projectionRows.push({ canonical_hash: parameters[18] });
      return queryResult<Row>([], 1);
    }
    const snapshot = this.currentSnapshot?.snapshot;
    if (sql.startsWith('SELECT account_fingerprint, canonical_hash')) {
      return queryResult<Row>(
        this.accountRows.length > 0
          ? this.accountRows
          : snapshot === undefined
            ? []
            : [
                {
                  account_fingerprint: snapshot.accountFingerprint,
                  canonical_hash: snapshot.account.accountObservationId,
                },
              ],
      );
    }
    if (sql.startsWith('SELECT provider_asset_id, canonical_hash')) {
      return queryResult<Row>(
        this.positionRows.length > 0
          ? this.positionRows
          : (snapshot?.positions.map((position) => ({
              provider_asset_id: position.assetFingerprint,
              canonical_hash: position.positionObservationId,
              supported_for_projection: position.support.state === 'supported',
              unsupported_reason: position.support.reason,
            })) ?? []),
      );
    }
    if (sql.startsWith('SELECT provider_order_id, canonical_hash, schema_version')) {
      return queryResult<Row>(
        this.orderRows.length > 0
          ? this.orderRows
          : (snapshot?.orders.map((order) => ({
              provider_order_id: order.orderFingerprint,
              schema_version: this.tamperPersistedOrderSchema
                ? 'daily-trader.portfolio.order-observation.v1'
                : order.schemaVersion,
              canonical_hash: order.orderObservationId,
              supported_for_monitoring: order.support.state === 'supported',
              unsupported_reason: order.support.reason,
            })) ?? []),
      );
    }
    if (sql.startsWith('SELECT fill.provider_activity_id, fill.canonical_hash')) {
      return queryResult<Row>(
        this.fillRows.length > 0
          ? this.fillRows
          : (snapshot?.fills.map((fill) => ({
              provider_activity_id: fill.fillFingerprint,
              canonical_hash: fill.fillObservationId,
            })) ?? []),
      );
    }
    if (sql.startsWith('SELECT canonical_hash FROM portfolio_projections')) {
      if (this.projectionRows.length > 0) return queryResult<Row>(this.projectionRows);
      if (snapshot === undefined) return queryResult<Row>([]);
      const basis = reconcilePortfolioProjection(
        snapshot,
        preparePortfolioProjection(snapshot, null),
        null,
      );
      return queryResult<Row>([
        { canonical_hash: projectPortfolioSnapshot(snapshot, basis).projectionId },
      ]);
    }
    if (sql.startsWith('SELECT run.sync_run_id, run.snapshot_schema_version')) {
      return this.currentSnapshot === null
        ? queryResult<Row>([], 0)
        : (() => {
            const current = this.currentSnapshot.snapshot;
            const basis = reconcilePortfolioProjection(
              current,
              preparePortfolioProjection(current, null),
              null,
            );
            const projection = projectPortfolioSnapshot(current, basis);
            const prepared = preparePortfolioProjection(current, projection.projectionId);
            const reconciliation = reconcilePortfolioProjection(
              current,
              prepared,
              projection.projectionId,
            );
            return queryResult<Row>(
              [
                {
                  sync_run_id: this.currentSnapshot.syncRunId,
                  snapshot_schema_version: this.tamperSnapshotSchemaVersion
                    ? 'daily-trader.portfolio.sync-snapshot.v1'
                    : current.schemaVersion,
                  snapshot_hash: current.snapshotId,
                  snapshot_payload: serializePortfolioSyncSnapshot(current),
                  prepared_projection_id: prepared.preparedProjectionId,
                  prepared_projection_payload: serializePortfolioPreparedProjection(prepared),
                  reconciliation_id: reconciliation.reconciliationId,
                  reconciliation_payload: serializePortfolioReconciliation(reconciliation),
                  expected_portfolio_result_id: projection.projectionId,
                  integrity_state: 'converged',
                  projection_hash: projection.projectionId,
                },
              ],
              1,
            );
          })();
    }
    if (sql.startsWith('SELECT worker.lifecycle')) {
      return this.statusRow === null
        ? queryResult<Row>([], 0)
        : queryResult<Row>([this.statusRow], 1);
    }
    return queryResult<Row>([], 1);
  }
}

class DeterministicSqlClient implements SqlClient {
  readonly #pool: DeterministicSqlPool;

  public constructor(pool: DeterministicSqlPool) {
    this.#pool = pool;
  }

  public query<Row extends SqlRow = SqlRow>(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    return Promise.resolve(this.#pool.respond<Row>('client', text, parameters));
  }

  public release(): void {}
}

function lease(snapshot: PortfolioSyncSnapshot): PortfolioLease {
  return Object.freeze({
    ownerId: 'portfolio-repository-test',
    fenceToken: '7',
    accountFingerprint: snapshot.accountFingerprint,
  });
}

function completionInput(
  handle: PortfolioSyncHandle,
  snapshot: PortfolioSyncSnapshot,
): Parameters<PortfolioRepository['completeSync']>[0] {
  const projectionBasisPrepared = preparePortfolioProjection(snapshot, null);
  const projectionBasisReconciliation = reconcilePortfolioProjection(
    snapshot,
    projectionBasisPrepared,
    null,
  );
  const projection = projectPortfolioSnapshot(snapshot, projectionBasisReconciliation);
  const prepared = preparePortfolioProjection(snapshot, projection.projectionId);
  const reconciliation = reconcilePortfolioProjection(snapshot, prepared, projection.projectionId);
  return {
    handle,
    finalCaptureAttempt: 1,
    snapshot,
    previousSyncRunId: null,
    prepared,
    projectionBasisReconciliation,
    reconciliation,
    delta: classifyPortfolioSnapshotDelta(null, snapshot),
    projection,
  };
}

async function recordSnapshotReceipts(
  repository: PortfolioRepository,
  handle: PortfolioSyncHandle,
  snapshot: PortfolioSyncSnapshot,
): Promise<void> {
  const requestFingerprints = [
    snapshot.account.sourceRequestFingerprint,
    snapshot.positions[0]?.sourceRequestFingerprint,
    snapshot.orders[0]?.sourceRequestFingerprint,
    snapshot.fills[0]?.sourceRequestFingerprint,
  ];
  if (requestFingerprints.some((value) => value === undefined)) {
    throw new TypeError('repository fixture must contain every portfolio resource');
  }
  for (const [index, resource] of ['account', 'positions', 'orders', 'fills'].entries()) {
    await repository.recordRequestReceipt(
      handle,
      createPortfolioRequestReceipt({
        requestFingerprint: requestFingerprints[index],
        resource,
        captureAttempt: 1,
        pageOrdinal: 0,
        receivedAt: NOW,
        responseStatus: 200,
      }),
    );
  }
}

async function begin(
  repository: PortfolioRepository,
  snapshot: PortfolioSyncSnapshot,
  syncRunId = 'portfolio-sync-repository-test',
): Promise<PortfolioSyncHandle> {
  return repository.beginSync({
    syncRunId,
    lease: lease(snapshot),
    captureStartedAt: snapshot.knowledgeInterval.captureStartedAt,
  });
}

describe('PortfolioRepository lease fencing', () => {
  it('acquires a monotonically fenced lease and rejects a failed renewal', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());

    const acquired = await repository.acquireLease({
      ownerId: 'portfolio-repository-test',
      accountFingerprint: snapshot.accountFingerprint,
      now: NOW,
      leaseMs: 60_000,
    });
    expect(acquired).toEqual({
      ownerId: 'portfolio-repository-test',
      accountFingerprint: snapshot.accountFingerprint,
      fenceToken: '7',
    });
    const acquireCall = pool.calls.find(({ text }) => text.includes('RETURNING fence_token::text'));
    expect(acquireCall?.text).toContain('lease_expires_at <= clock_timestamp()');
    expect(acquireCall?.parameters).not.toContain(NOW);

    await expect(repository.renewLease(acquired, NOW, 60_000)).resolves.toBeUndefined();
    const renewalCall = pool.calls.find(({ text }) =>
      text.startsWith('UPDATE portfolio_worker_status SET heartbeat_at'),
    );
    expect(renewalCall?.text).toContain('lease_expires_at > clock_timestamp()');
    expect(renewalCall?.parameters).not.toContain(NOW);
    expect(acquireCall?.text).toContain(
      "CASE WHEN failure_code IS NULL THEN 'starting' ELSE 'degraded' END",
    );
    pool.renewalAllowed = false;
    await expect(repository.renewLease(acquired, NOW, 60_000)).rejects.toEqual(
      new PortfolioWorkerError('claim_lost', 'Portfolio worker lease renewal failed', false),
    );
    await repository.releaseLease({ lease: acquired, now: NOW });
    const releaseCall = pool.calls.find(({ text }) =>
      text.includes('failure_code = COALESCE($1, failure_code)'),
    );
    expect(releaseCall?.parameters).toEqual([null, acquired.ownerId, acquired.fenceToken]);

    const collisionPool = new DeterministicSqlPool();
    collisionPool.leaseAcquirable = false;
    await expect(
      new PortfolioRepository(collisionPool, config()).acquireLease({
        ownerId: 'portfolio-repository-collision',
        accountFingerprint: snapshot.accountFingerprint,
        now: NOW,
        leaseMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: 'claim_lost', retryable: true });
  });

  it('does not let a historical event timestamp validate an expired database lease', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    pool.leaseValid = false;
    const repository = new PortfolioRepository(pool, config());

    await expect(begin(repository, snapshot)).rejects.toMatchObject({ code: 'claim_lost' });

    expect(pool.calls.map(({ text }) => text)).toEqual([
      'BEGIN',
      expect.stringContaining('SELECT 1 FROM portfolio_worker_status'),
      'ROLLBACK',
    ]);
    expect(pool.calls.some(({ text }) => text.includes('INSERT INTO portfolio_sync_runs'))).toBe(
      false,
    );
    const leaseCheck = pool.calls.find(({ text }) =>
      text.startsWith('SELECT 1 FROM portfolio_worker_status'),
    );
    expect(leaseCheck?.text).toContain('lease_expires_at > clock_timestamp()');
    expect(leaseCheck?.parameters).toHaveLength(3);
    expect(leaseCheck?.parameters).not.toContain(snapshot.knowledgeInterval.captureStartedAt);
  });

  it('terminalizes an older pending cycle before beginning another under the same fence', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());

    await begin(repository, snapshot, 'portfolio-sync-orphaned');
    await begin(repository, snapshot, 'portfolio-sync-recovery');

    const superseded = pool.calls.filter(({ text }) =>
      text.includes("failure_code = 'superseded_retry'"),
    );
    expect(superseded).toHaveLength(2);
    expect(superseded[1]?.parameters).toEqual([
      'portfolio-repository-test',
      '7',
      'portfolio-sync-recovery',
    ]);
    const secondInsert = pool.calls.findLastIndex(({ text }) =>
      text.includes('INSERT INTO portfolio_sync_runs'),
    );
    const secondSupersede = pool.calls.findLastIndex(({ text }) =>
      text.includes("failure_code = 'superseded_retry'"),
    );
    expect(secondSupersede).toBeLessThan(secondInsert);
  });
});

describe('PortfolioRepository complete-cycle promotion', () => {
  it('persists request receipts idempotently and rejects conflicting logical slots', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot);
    const receipt = createPortfolioRequestReceipt({
      requestFingerprint: fingerprintPortfolioSourceIdentifier(
        'request',
        'repository-receipt-provider-id',
      ),
      resource: 'orders',
      captureAttempt: 2,
      pageOrdinal: 1,
      receivedAt: NOW,
      responseStatus: 200,
    });

    await expect(repository.recordRequestReceipt(handle, receipt)).resolves.toBeUndefined();
    const receiptInsert = pool.calls.find(({ text }) =>
      text.startsWith('INSERT INTO portfolio_sync_requests'),
    );
    expect(receiptInsert?.parameters).toEqual([
      handle.syncRunId,
      'daily-trader.portfolio.request-receipt.v1',
      2,
      'orders',
      1,
      receipt.requestFingerprint,
      NOW,
      200,
    ]);
    expect(JSON.stringify(receiptInsert?.parameters)).not.toContain(
      'repository-receipt-provider-id',
    );

    pool.receiptInsertAllowed = false;
    await expect(repository.recordRequestReceipt(handle, receipt)).resolves.toBeUndefined();
    pool.receiptMatches = false;
    await expect(repository.recordRequestReceipt(handle, receipt)).rejects.toMatchObject({
      code: 'sync_failed',
      retryable: false,
    });
  });

  it('writes exact observations and promotes the pointer only after terminal completion', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot);
    await recordSnapshotReceipts(repository, handle, snapshot);

    await repository.completeSync(completionInput(handle, snapshot));

    expect(pool.calls.filter(({ text }) => text === 'BEGIN')).toHaveLength(6);
    expect(pool.calls.filter(({ text }) => text === 'COMMIT')).toHaveLength(6);
    expect(pool.calls.some(({ text }) => text === 'ROLLBACK')).toBe(false);
    const terminalIndex = pool.calls.findIndex(({ text }) =>
      text.startsWith("UPDATE portfolio_sync_runs SET state = 'completed'"),
    );
    const pointerIndex = pool.calls.findIndex(({ text }) =>
      text.startsWith('INSERT INTO portfolio_current_snapshot'),
    );
    const finalCommitIndex = pool.calls.findLastIndex(({ text }) => text === 'COMMIT');
    expect(terminalIndex).toBeGreaterThan(-1);
    expect(pointerIndex).toBeGreaterThan(terminalIndex);
    expect(finalCommitIndex).toBeGreaterThan(pointerIndex);
    const terminalUpdate = pool.calls[terminalIndex];
    expect(terminalUpdate?.text).toContain(
      "snapshot_schema_version = 'daily-trader.portfolio.sync-snapshot.v2'",
    );
    expect(terminalUpdate?.parameters.slice(13)).toEqual([
      snapshot.coverage.activityWindowStartedAt,
      snapshot.coverage.activityCutoverAt,
      snapshot.coverage.activityBaselineOnly,
    ]);

    const configurationInsert = pool.calls.find(({ text }) =>
      text.includes('INSERT INTO portfolio_sync_runs'),
    );
    expect(configurationInsert).toBeDefined();
    expect(configurationInsert?.text).toContain("'daily-trader.portfolio.sync-snapshot.v2'");
    expect(JSON.stringify(configurationInsert?.parameters)).not.toMatch(
      /repository-fixture-(?:key|secret)|fixture-paper-account-id/u,
    );
    const accountInsert = pool.calls.find(({ text }) =>
      text.includes('INSERT INTO portfolio_account_observations'),
    );
    expect(
      accountInsert?.parameters
        .slice(9, 25)
        .every((value) => value === null || typeof value === 'string'),
    ).toBe(true);
    const positionInstruments = pool.calls
      .filter(({ text }) => text.includes('INSERT INTO portfolio_position_observations'))
      .map(({ parameters }) => parameters[4]);
    expect(positionInstruments).toEqual(expect.arrayContaining(['XNAS:AAPL', 'XNAS:TSLA', null]));
    const orderInstruments = pool.calls
      .filter(({ text }) => text.includes('INSERT INTO portfolio_order_observations'))
      .map(({ parameters }) => parameters[6]);
    expect(orderInstruments).toEqual(expect.arrayContaining(['XNAS:AAPL', null]));
    const fillInstruments = pool.calls
      .filter(({ text }) => text.includes('INSERT INTO portfolio_fill_observations'))
      .map(({ parameters }) => parameters[8]);
    expect(fillInstruments).toEqual(['XNAS:AAPL']);
    expect(
      [...positionInstruments, ...orderInstruments, ...fillInstruments].every(
        (value) => value === null || typeof value === 'string',
      ),
    ).toBe(true);
    const projectionInsert = pool.calls.find(({ text }) =>
      text.includes('INSERT INTO portfolio_projections'),
    );
    expect(projectionInsert?.parameters[2]).toBe('incomplete');
    expect(projectionInsert?.parameters[9]).toBeNull();
  });

  it('persists nullable mleg parent facts and concrete child identity without inference', async () => {
    const snapshot = await normalizedSnapshot({ orders: mlegOrders() });
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot, 'portfolio-sync-mleg');
    await recordSnapshotReceipts(repository, handle, snapshot);

    await repository.completeSync(completionInput(handle, snapshot));

    const orderInserts = pool.calls.filter(({ text }) =>
      text.includes('INSERT INTO portfolio_order_observations'),
    );
    expect(orderInserts).toHaveLength(4);
    expect(
      orderInserts.every(
        ({ parameters }) => parameters[1] === 'daily-trader.portfolio.order-observation.v2',
      ),
    ).toBe(true);
    const parent = orderInserts.find(({ parameters }) => parameters[5] === null);
    const child = orderInserts.find(({ parameters }) => parameters.includes('AAPL260116C00200001'));
    expect(parent?.parameters.slice(4, 14)).toEqual([
      null,
      null,
      null,
      null,
      false,
      'unsupported_order_structure',
      expect.any(String),
      null,
      null,
      'limit',
    ]);
    expect(child?.parameters.slice(4, 14)).toEqual([
      expect.any(String),
      'AAPL260116C00200001',
      null,
      'us_option',
      false,
      'unsupported_order_structure',
      expect.any(String),
      'buy',
      'buy_to_open',
      null,
    ]);
  });

  it('writes candidates without a worker-row lock and rolls back lease loss before promotion', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot, 'portfolio-sync-lease-boundary');
    await recordSnapshotReceipts(repository, handle, snapshot);
    pool.calls.length = 0;
    pool.leaseCheckResults.push(true, false);

    await expect(repository.completeSync(completionInput(handle, snapshot))).rejects.toEqual(
      new PortfolioWorkerError('claim_lost', 'Portfolio worker lease was lost', false),
    );

    const leaseChecks = pool.calls
      .map(({ text }, index) => ({ index, text }))
      .filter(({ text }) => text.startsWith('SELECT 1 FROM portfolio_worker_status'));
    const reconciliationInsertIndex = pool.calls.findIndex(({ text }) =>
      text.startsWith('INSERT INTO portfolio_reconciliations'),
    );
    expect(leaseChecks).toHaveLength(2);
    expect(leaseChecks[0]?.text).not.toContain('FOR UPDATE');
    expect(reconciliationInsertIndex).toBeGreaterThan(leaseChecks[0]?.index ?? -1);
    expect(leaseChecks[1]?.index).toBeGreaterThan(reconciliationInsertIndex);
    expect(leaseChecks[1]?.text).toContain('FOR UPDATE');
    expect(pool.calls.filter(({ text }) => text === 'BEGIN')).toHaveLength(1);
    expect(pool.calls.some(({ text }) => text === 'ROLLBACK')).toBe(true);
    expect(pool.calls.some(({ text }) => text === 'COMMIT')).toBe(false);
    expect(
      pool.calls.some(({ text }) =>
        text.startsWith("UPDATE portfolio_sync_runs SET state = 'completed'"),
      ),
    ).toBe(false);
    expect(
      pool.calls.some(({ text }) => text.startsWith('INSERT INTO portfolio_current_snapshot')),
    ).toBe(false);
  });

  it('rejects a legacy snapshot before writing into a new v2 synchronization run', async () => {
    const current = await normalizedSnapshot();
    const snapshot: PortfolioSyncSnapshot = Object.freeze({
      ...current,
      schemaVersion: 'daily-trader.portfolio.sync-snapshot.v1',
    });
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());
    const handle = Object.freeze({
      syncRunId: 'portfolio-sync-legacy-candidate',
      lease: lease(snapshot),
      captureStartedAt: snapshot.knowledgeInterval.captureStartedAt,
    });

    await expect(repository.completeSync(completionInput(handle, snapshot))).rejects.toMatchObject({
      code: 'projection_failed',
      retryable: false,
    });
    expect(pool.calls).toEqual([]);
  });

  it('rejects a final attempt with partial receipt membership before writing candidate rows', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot, 'portfolio-sync-partial-receipts');
    await repository.recordRequestReceipt(
      handle,
      createPortfolioRequestReceipt({
        requestFingerprint: snapshot.account.sourceRequestFingerprint,
        resource: 'account',
        captureAttempt: 1,
        pageOrdinal: 0,
        receivedAt: NOW,
        responseStatus: 200,
      }),
    );

    await expect(repository.completeSync(completionInput(handle, snapshot))).rejects.toMatchObject({
      code: 'sync_failed',
      retryable: false,
    });

    expect(pool.calls.some(({ text }) => text === 'ROLLBACK')).toBe(true);
    expect(
      pool.calls.some(({ text }) => text.includes('INSERT INTO portfolio_account_observations')),
    ).toBe(false);
    expect(
      pool.calls.some(({ text }) => text.startsWith('INSERT INTO portfolio_current_snapshot')),
    ).toBe(false);
  });

  it('reconciles from persisted rows and rejects a changed local observation revision', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    pool.tamperPersistedPosition = true;
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot, 'portfolio-sync-persisted-drift');
    await recordSnapshotReceipts(repository, handle, snapshot);

    await expect(repository.completeSync(completionInput(handle, snapshot))).rejects.toMatchObject({
      code: 'projection_failed',
      retryable: false,
    });

    expect(pool.calls.some(({ text }) => text === 'ROLLBACK')).toBe(true);
    expect(
      pool.calls.some(({ text }) =>
        text.startsWith("UPDATE portfolio_sync_runs SET state = 'completed'"),
      ),
    ).toBe(false);
    expect(
      pool.calls.some(({ text }) => text.startsWith('INSERT INTO portfolio_current_snapshot')),
    ).toBe(false);
  });

  it('rejects the order-only unsupported structure reason on persisted positions', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    pool.tamperPersistedPositionSupport = true;
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot, 'portfolio-sync-position-support-drift');
    await recordSnapshotReceipts(repository, handle, snapshot);

    await expect(repository.completeSync(completionInput(handle, snapshot))).rejects.toMatchObject({
      code: 'database_unavailable',
      retryable: false,
    });
    expect(pool.calls.some(({ text }) => text === 'ROLLBACK')).toBe(true);
  });

  it('rejects persisted order rows whose schema metadata does not match the v2 snapshot', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    pool.tamperPersistedOrderSchema = true;
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot, 'portfolio-sync-order-schema-drift');
    await recordSnapshotReceipts(repository, handle, snapshot);

    await expect(repository.completeSync(completionInput(handle, snapshot))).rejects.toMatchObject({
      code: 'database_unavailable',
      retryable: false,
    });
    expect(pool.calls.some(({ text }) => text === 'ROLLBACK')).toBe(true);
  });

  it('rolls back all candidate rows and never changes the pointer when completion is fenced', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    const repository = new PortfolioRepository(pool, config());
    const handle = await begin(repository, snapshot);
    await recordSnapshotReceipts(repository, handle, snapshot);
    pool.completionAllowed = false;

    await expect(repository.completeSync(completionInput(handle, snapshot))).rejects.toEqual(
      new PortfolioWorkerError('claim_lost', 'Portfolio sync completion was fenced', false),
    );

    expect(pool.calls.some(({ text }) => text === 'ROLLBACK')).toBe(true);
    expect(
      pool.calls.some(({ text }) => text.startsWith('INSERT INTO portfolio_current_snapshot')),
    ).toBe(false);
    expect(pool.calls.filter(({ text }) => text === 'COMMIT')).toHaveLength(5);
  });

  it('retains the prior current snapshot after recording a failed candidate cycle', async () => {
    const snapshot = await normalizedSnapshot();
    const pool = new DeterministicSqlPool();
    pool.currentSnapshot = Object.freeze({ syncRunId: 'portfolio-sync-prior', snapshot });
    const repository = new PortfolioRepository(pool, config());
    const before = await repository.readCurrentSnapshot();
    const handle = await begin(repository, snapshot, 'portfolio-sync-failed-candidate');

    await repository.failSync(handle, NOW, 'provider_transport');
    const after = await repository.readCurrentSnapshot();

    expect(before).toEqual(after);
    expect(after?.syncRunId).toBe('portfolio-sync-prior');
    expect(
      pool.calls.some(({ text }) => text.startsWith('INSERT INTO portfolio_current_snapshot')),
    ).toBe(false);
    expect(
      pool.calls.some(({ text }) =>
        text.startsWith("UPDATE portfolio_sync_runs SET state = 'failed'"),
      ),
    ).toBe(true);
  });

  it('rejects current snapshot metadata whose declared schema differs from canonical bytes', async () => {
    const pool = new DeterministicSqlPool();
    pool.currentSnapshot = Object.freeze({
      syncRunId: 'portfolio-sync-schema-drift',
      snapshot: await normalizedSnapshot(),
    });
    pool.tamperSnapshotSchemaVersion = true;

    await expect(
      new PortfolioRepository(pool, config()).readCurrentSnapshot(),
    ).rejects.toMatchObject({
      code: 'database_unavailable',
      retryable: false,
    });
  });
});

describe('PortfolioRepository status', () => {
  it('returns bounded operational fields without leaking unexpected broker data', async () => {
    const pool = new DeterministicSqlPool();
    pool.currentSnapshot = Object.freeze({
      syncRunId: 'portfolio-sync-current',
      snapshot: await normalizedSnapshot(),
    });
    pool.statusRow = {
      lifecycle: 'degraded',
      failure_code: 'provider_transport',
      heartbeat_at: '2026-07-13 13:31:02.5+00',
      last_sync_started_at: '2026-07-13 13:31:00+00',
      last_sync_completed_at: '2026-07-13 13:30:00+00',
      sync_run_id: 'portfolio-sync-current',
      current_snapshot_at: '2026-07-13 13:30:01+00',
      projection_state: 'complete',
      reconciliation_state: 'converged',
      change_state: 'unchanged',
      position_count: '2',
      order_count: '1',
      fill_count: '1',
      account_id: 'raw-account-must-not-escape',
      api_secret: 'secret-must-not-escape',
    };

    const status = await new PortfolioRepository(pool, config()).readStatus();

    expect(status).toEqual({
      lifecycle: 'degraded',
      failureCode: 'provider_transport',
      heartbeatAt: '2026-07-13 13:31:02.5+00',
      lastSyncStartedAt: '2026-07-13 13:31:00+00',
      lastSyncCompletedAt: '2026-07-13 13:30:00+00',
      currentSyncRunId: 'portfolio-sync-current',
      currentSnapshotAt: '2026-07-13 13:30:01+00',
      projectionState: 'complete',
      reconciliationState: 'converged',
      changeState: 'unchanged',
      positionCount: 2,
      orderCount: 1,
      fillCount: 1,
    });
    expect(JSON.stringify(status)).not.toMatch(/raw-account|api_secret|secret-must/u);
  });
});
