import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import {
  classifyPortfolioSnapshotDelta,
  preparePortfolioProjection,
  projectPortfolioSnapshot,
  reconcilePortfolioProjection,
  type PortfolioPreparedProjection,
  type PortfolioProjection,
  type PortfolioReconciliation,
  type PortfolioRequestReceipt,
  type PortfolioSyncSnapshot,
} from '@daily-trader/portfolio';

import { projectPortfolioWorkerConfig } from './config.js';
import { createPgPortfolioPool } from './persistence/pg-pool.js';
import { PortfolioRepository } from './persistence/repository.js';
import { AlpacaPaperPortfolioProvider, type AlpacaFetch } from './providers/alpaca/index.js';

const FIXTURE_CLOCK = new FixedClock(createUtcTimestamp('2026-07-13T13:31:02.500Z'));

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/alpaca/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
}

async function captureFixture(): Promise<{
  readonly expectedAccountId: string;
  readonly observedResourceCount: number;
  readonly receipts: readonly PortfolioRequestReceipt[];
  readonly snapshot: PortfolioSyncSnapshot;
}> {
  const [account, positions, orders, fills] = await Promise.all([
    fixture('account'),
    fixture('positions'),
    fixture('orders'),
    fixture('fills'),
  ]);
  if (account === null || typeof account !== 'object' || !('id' in account)) {
    throw new Error('sanitized fixture account is invalid');
  }
  const expectedAccountId = (account as Readonly<Record<string, unknown>>).id;
  if (typeof expectedAccountId !== 'string') {
    throw new Error('sanitized fixture account is invalid');
  }
  const observedResources = new Set<string>();
  const receipts: PortfolioRequestReceipt[] = [];
  let requestOrdinal = 0;
  const fetcher: AlpacaFetch = (input) => {
    const url = new URL(input);
    const payload = url.pathname.endsWith('/account/activities/FILL')
      ? fills
      : url.pathname.endsWith('/account')
        ? account
        : url.pathname.endsWith('/positions')
          ? positions
          : url.pathname.endsWith('/orders')
            ? orders
            : undefined;
    if (payload === undefined) throw new Error('fixture adapter used an unapproved resource');
    observedResources.add(url.pathname);
    requestOrdinal += 1;
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': `sanitized-fixture-request-${String(requestOrdinal)}`,
        },
      }),
    );
  };
  const provider = new AlpacaPaperPortfolioProvider(
    { apiKey: 'sanitized-fixture-key', apiSecret: 'sanitized-fixture-secret', expectedAccountId },
    { clock: FIXTURE_CLOCK, fetch: fetcher },
  );
  const snapshot = await provider.capture({
    previousActivityCutoverAt: null,
    captureAttempt: 1,
    onRequestReceipt: (receipt) => {
      receipts.push(receipt);
      return Promise.resolve();
    },
  });
  return Object.freeze({
    expectedAccountId,
    observedResourceCount: observedResources.size,
    receipts: Object.freeze(receipts),
    snapshot,
  });
}

function candidate(snapshot: PortfolioSyncSnapshot): Readonly<{
  basisReconciliation: PortfolioReconciliation;
  prepared: PortfolioPreparedProjection;
  projection: PortfolioProjection;
  reconciliation: PortfolioReconciliation;
}> {
  const structuralPrepared = preparePortfolioProjection(snapshot, null);
  const basisReconciliation = reconcilePortfolioProjection(snapshot, structuralPrepared, null);
  const projection = projectPortfolioSnapshot(snapshot, basisReconciliation);
  const prepared = preparePortfolioProjection(snapshot, projection.projectionId);
  const reconciliation = reconcilePortfolioProjection(snapshot, prepared, projection.projectionId);
  return Object.freeze({
    basisReconciliation,
    prepared,
    projection,
    reconciliation,
  });
}

async function verifyFixture(): Promise<void> {
  const { observedResourceCount, snapshot } = await captureFixture();
  const { projection, reconciliation } = candidate(snapshot);
  if (reconciliation.status !== 'converged' || observedResourceCount !== 4) {
    throw new Error('sanitized fixture did not produce a complete read-only capture');
  }
  process.stdout.write(
    `${JSON.stringify({
      event: 'portfolio.fixture.verified',
      executionEnabled: false,
      fillCount: snapshot.fills.length,
      method: 'GET',
      orderCount: snapshot.orders.length,
      positionCount: snapshot.positions.length,
      projectionState: projection.state,
      reconciliationState: reconciliation.status,
      resourceCount: observedResourceCount,
      status: 'passed',
    })}\n`,
  );
}

async function persistFixture(): Promise<void> {
  loadOptionalEnvironmentFile();
  const config = projectPortfolioWorkerConfig(loadConfig());
  const captured = await captureFixture();
  if (
    config.portfolio.mode !== 'paper_read_only' ||
    config.portfolio.expectedAccountId !== captured.expectedAccountId
  ) {
    throw new Error('fixture persistence requires its expected paper account configuration');
  }
  const pool = createPgPortfolioPool({
    connectionString: config.database.url,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.portfolio.operational.statementTimeoutMs,
  });
  const repository = new PortfolioRepository(pool, config);
  const ownerId = `portfolio-fixture-${randomUUID()}`;
  const syncRunId = `portfolio-sync-${randomUUID()}`;
  const startedAt = captured.snapshot.knowledgeInterval.captureStartedAt;
  let handle: Awaited<ReturnType<PortfolioRepository['beginSync']>> | undefined;
  let lease: Awaited<ReturnType<PortfolioRepository['acquireLease']>> | undefined;
  try {
    lease = await repository.acquireLease({
      ownerId,
      accountFingerprint: captured.snapshot.accountFingerprint,
      now: startedAt,
      leaseMs: config.portfolio.operational.claimLeaseMs,
    });
    handle = await repository.beginSync({ syncRunId, lease, captureStartedAt: startedAt });
    for (const receipt of captured.receipts) {
      await repository.recordRequestReceipt(handle, receipt);
    }
    const previous = await repository.readCurrentSnapshot();
    const preparedCandidate = candidate(captured.snapshot);
    const delta = classifyPortfolioSnapshotDelta(previous?.snapshot ?? null, captured.snapshot);
    await repository.completeSync({
      handle,
      finalCaptureAttempt: 1,
      snapshot: captured.snapshot,
      previousSyncRunId: previous?.syncRunId ?? null,
      prepared: preparedCandidate.prepared,
      projectionBasisReconciliation: preparedCandidate.basisReconciliation,
      reconciliation: preparedCandidate.reconciliation,
      delta,
      projection: preparedCandidate.projection,
    });
    const state = await repository.readStatus();
    process.stdout.write(
      `${JSON.stringify({
        event: 'portfolio.fixture.persisted',
        changeState: state.changeState,
        executionEnabled: false,
        fillCount: state.fillCount,
        orderCount: state.orderCount,
        positionCount: state.positionCount,
        projectionState: state.projectionState,
        reconciliationState: state.reconciliationState,
        status: 'passed',
      })}\n`,
    );
  } catch (error) {
    if (handle !== undefined) {
      await repository
        .failSync(handle, captured.snapshot.knowledgeInterval.captureCompletedAt, 'fixture_failed')
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (lease !== undefined) {
      await repository
        .releaseLease({
          lease,
          now: captured.snapshot.knowledgeInterval.captureCompletedAt,
        })
        .catch(() => undefined);
    }
    await pool.end();
  }
}

async function status(): Promise<void> {
  loadOptionalEnvironmentFile();
  const config = projectPortfolioWorkerConfig(loadConfig());
  const pool = createPgPortfolioPool({
    connectionString: config.database.url,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.portfolio.operational.statementTimeoutMs,
  });
  try {
    const value = await new PortfolioRepository(pool, config).readStatus();
    process.stdout.write(
      `${JSON.stringify({
        access: 'read_only',
        changeState: value.changeState,
        currentSnapshotAt: value.currentSnapshotAt,
        environment: 'paper',
        executionEnabled: false,
        failureCode: value.failureCode,
        fillCount: value.fillCount,
        heartbeatAt: value.heartbeatAt,
        lastSyncCompletedAt: value.lastSyncCompletedAt,
        lastSyncStartedAt: value.lastSyncStartedAt,
        leaseExpiresAt: value.leaseExpiresAt,
        leaseState: value.leaseState,
        lifecycle: value.lifecycle,
        orderCount: value.orderCount,
        positionCount: value.positionCount,
        projectionState: value.projectionState,
        reconciliationState: value.reconciliationState,
      })}\n`,
    );
  } finally {
    await pool.end();
  }
}

const command = process.argv[2];
try {
  if (command === 'fixture:verify') await verifyFixture();
  else if (command === 'fixture:persist') await persistFixture();
  else if (command === 'status') await status();
  else throw new Error('usage: portfolio-cli <fixture:verify|fixture:persist|status>');
} catch {
  process.stderr.write(
    `${JSON.stringify({ event: 'portfolio_cli.failed', code: 'COMMAND_FAILED' })}\n`,
  );
  process.exitCode = 1;
}
