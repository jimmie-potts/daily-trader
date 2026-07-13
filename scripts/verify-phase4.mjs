import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import pg from 'pg';

const { Client } = pg;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const defaultDatabaseUrl =
  'postgresql://daily_trader:daily_trader_local@127.0.0.1:5432/daily_trader';
const defaultRedisUrl = 'redis://127.0.0.1:6379';
const orphanLeaseMilliseconds = 5_000;
const leaseExpiryPollMilliseconds = 100;
const leaseExpiryDeadlineMilliseconds = 15_000;

try {
  process.loadEnvFile('.env');
} catch (error) {
  if (!(
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )) {
    process.stderr.write('Phase 4 verification could not load the optional environment file.\n');
    process.exit(1);
  }
}

function requireLoopbackUrl(value, allowedProtocols, setting) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${setting} must be a valid local service URL`);
  }
  if (
    !allowedProtocols.includes(url.protocol) ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '::1')
  ) {
    throw new Error(`${setting} must target a loopback service for Phase 4 verification`);
  }
  return url;
}

function quotedIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) {
    throw new Error('Generated verification database identifier was invalid');
  }
  return `"${value}"`;
}

function runScript(name, environment = {}) {
  const result = spawnSync(npmCommand, ['run', name], {
    cwd: process.cwd(),
    env: { ...sanitizedEnvironment, ...environment },
    stdio: 'inherit',
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`Phase 4 verification step failed: ${name}`);
  }
}

async function withClient(databaseUrl, applicationName, operation) {
  const client = new Client({
    application_name: applicationName,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  try {
    await client.connect();
    return await operation(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function safeFingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isExactDecimalText(value) {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value);
}

function isExactDecimalTextOrNull(value) {
  return value === null || isExactDecimalText(value);
}

function isUtcTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function hasSafePageItem(resource, item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
  if (
    typeof item.symbol !== 'string' ||
    item.symbol.length === 0 ||
    !isUtcTimestamp(item.observedAt)
  ) {
    return false;
  }
  if (resource === 'positions') {
    return (
      typeof item.assetClass === 'string' &&
      typeof item.currency === 'string' &&
      (item.side === 'long' || item.side === 'short') &&
      isExactDecimalText(item.quantity) &&
      [
        item.quantityAvailable,
        item.averageEntryPrice,
        item.currentPrice,
        item.marketValue,
        item.costBasis,
        item.unrealizedProfitLoss,
        item.allocationPercent,
        item.lastDayPrice,
        item.changeToday,
        item.unrealizedProfitLossPercent,
        item.unrealizedIntradayProfitLoss,
        item.unrealizedIntradayProfitLossPercent,
      ].every(isExactDecimalTextOrNull) &&
      (item.projectionSupport === 'supported' || item.projectionSupport === 'unsupported') &&
      item.markSource === 'broker_mark'
    );
  }
  if (resource === 'orders') {
    return (
      typeof item.side === 'string' &&
      typeof item.orderType === 'string' &&
      typeof item.timeInForce === 'string' &&
      typeof item.status === 'string' &&
      (item.providerPositionIntent === null || typeof item.providerPositionIntent === 'string') &&
      [
        item.quantity,
        item.notional,
        item.filledAveragePrice,
        item.limitPrice,
        item.stopPrice,
        item.trailPrice,
        item.trailPercent,
        item.highWaterMark,
        item.commission,
      ].every(isExactDecimalTextOrNull) &&
      isExactDecimalText(item.filledQuantity) &&
      isUtcTimestamp(item.createdAt)
    );
  }
  return (
    (item.side === 'buy' || item.side === 'sell') &&
    (item.fillType === 'fill' || item.fillType === 'partial_fill') &&
    isExactDecimalText(item.quantity) &&
    isExactDecimalText(item.price) &&
    isExactDecimalText(item.cumulativeQuantity) &&
    isExactDecimalText(item.leavesQuantity) &&
    isUtcTimestamp(item.transactionAt)
  );
}

async function createPendingPartialCycle(databaseUrl, environment) {
  const [{ loadConfig }, { createUtcTimestamp }, workerConfigModule, poolModule, repositoryModule] =
    await Promise.all([
      import('../packages/config/dist/index.js'),
      import('../packages/domain/dist/index.js'),
      import('../workers/portfolio/dist/config.js'),
      import('../workers/portfolio/dist/persistence/pg-pool.js'),
      import('../workers/portfolio/dist/persistence/repository.js'),
    ]);
  const config = workerConfigModule.projectPortfolioWorkerConfig(loadConfig(environment));
  const pool = poolModule.createPgPortfolioPool({
    connectionString: databaseUrl,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.portfolio.operational.statementTimeoutMs,
  });
  const repository = new repositoryModule.PortfolioRepository(pool, config);
  const initial = await repository.readCurrentSnapshot();
  if (initial === null) {
    await pool.end();
    throw new Error('The complete fixture snapshot was not promoted');
  }

  const partialRunId = 'portfolio-sync-verification-orphan';
  const orphanOwnerId = 'portfolio-phase4-verifier-orphan';
  const startedAt = createUtcTimestamp('2026-07-13T13:31:03.500Z');
  let lease;
  let pendingCreated = false;
  try {
    lease = await repository.acquireLease({
      ownerId: orphanOwnerId,
      accountFingerprint: initial.snapshot.accountFingerprint,
      now: startedAt,
      leaseMs: orphanLeaseMilliseconds,
    });
    await repository.beginSync({
      syncRunId: partialRunId,
      lease,
      captureStartedAt: startedAt,
    });
    await pool.query(
      `INSERT INTO portfolio_sync_requests (
         sync_run_id, schema_version, capture_attempt, resource, ordinal,
         provider_request_fingerprint, observed_at, response_status
       ) VALUES (
         $1, 'daily-trader.portfolio.request-receipt.v1', 1,
         'account', 0, $2, $3::timestamptz, 200
      )`,
      [partialRunId, safeFingerprint('phase4-sanitized-partial-request'), startedAt],
    );
    pendingCreated = true;
  } finally {
    if (!pendingCreated && lease !== undefined) {
      await repository
        .releaseLease({ lease, now: startedAt, failureCode: 'verification_cleanup' })
        .catch(() => undefined);
    }
    await pool.end();
  }

  const context = Object.freeze({
    accountFingerprint: initial.snapshot.accountFingerprint,
    currentRunId: initial.syncRunId,
    orphanOwnerId,
    partialRunId,
  });
  await verifyPendingPartialCycle(databaseUrl, context, 'before_restart');
  process.stdout.write(
    `${JSON.stringify({
      event: 'phase4.pending_cycle.created',
      currentSnapshotPreserved: true,
      state: 'pending',
      status: 'passed',
    })}\n`,
  );
  return context;
}

async function verifyPendingPartialCycle(databaseUrl, context, pass) {
  await withClient(databaseUrl, 'daily-trader-phase4-verification-pending', async (client) => {
    const result = await client.query(
      `SELECT current.sync_run_id AS current_run_id,
              pending.state AS partial_state,
              pending.failure_code AS partial_failure_code,
              pending.capture_completed_at,
              COUNT(request.sync_run_id)::text AS partial_request_count
         FROM portfolio_current_snapshot AS current
         JOIN portfolio_sync_runs AS pending ON pending.sync_run_id = $1
         LEFT JOIN portfolio_sync_requests AS request ON request.sync_run_id = pending.sync_run_id
        WHERE current.singleton
        GROUP BY current.sync_run_id, pending.state, pending.failure_code,
                 pending.capture_completed_at`,
      [context.partialRunId],
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row?.current_run_id !== context.currentRunId ||
      row?.partial_state !== 'pending' ||
      row?.partial_failure_code !== null ||
      row?.capture_completed_at !== null ||
      row?.partial_request_count !== '1'
    ) {
      throw new Error(`Pending partial portfolio state was invalid ${pass}`);
    }
  });
}

async function waitForOrphanLeaseExpiry(databaseUrl, context) {
  await withClient(databaseUrl, 'daily-trader-phase4-verification-lease-wait', async (client) => {
    const deadline = Date.now() + leaseExpiryDeadlineMilliseconds;
    for (;;) {
      const result = await client.query(
        `SELECT owner_id,
                lease_expires_at IS NOT NULL
                  AND lease_expires_at <= clock_timestamp() AS lease_expired
           FROM portfolio_worker_status
          WHERE singleton`,
      );
      const row = result.rows[0];
      if (row?.owner_id !== context.orphanOwnerId) {
        throw new Error('Orphaned portfolio lease ownership changed before recovery');
      }
      if (row.lease_expired === true) return;
      if (Date.now() >= deadline) {
        throw new Error('Orphaned portfolio lease did not expire within the bounded deadline');
      }
      await new Promise((resolve) => setTimeout(resolve, leaseExpiryPollMilliseconds));
    }
  });
}

async function recoverPendingPartialCycle(databaseUrl, environment, context) {
  await waitForOrphanLeaseExpiry(databaseUrl, context);
  const [{ loadConfig }, { createUtcTimestamp }, workerConfigModule, poolModule, repositoryModule] =
    await Promise.all([
      import('../packages/config/dist/index.js'),
      import('../packages/domain/dist/index.js'),
      import('../workers/portfolio/dist/config.js'),
      import('../workers/portfolio/dist/persistence/pg-pool.js'),
      import('../workers/portfolio/dist/persistence/repository.js'),
    ]);
  const config = workerConfigModule.projectPortfolioWorkerConfig(loadConfig(environment));
  const pool = poolModule.createPgPortfolioPool({
    connectionString: databaseUrl,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.portfolio.operational.statementTimeoutMs,
  });
  const repository = new repositoryModule.PortfolioRepository(pool, config);
  const recoveredAt = createUtcTimestamp('2026-07-13T13:31:05.000Z');
  let recoveryLease;
  try {
    recoveryLease = await repository.acquireLease({
      ownerId: 'portfolio-phase4-verifier-recovery',
      accountFingerprint: context.accountFingerprint,
      now: recoveredAt,
      leaseMs: config.portfolio.operational.claimLeaseMs,
    });
    await repository.releaseLease({ lease: recoveryLease, now: recoveredAt });
    recoveryLease = undefined;
  } finally {
    if (recoveryLease !== undefined) {
      await repository
        .releaseLease({
          lease: recoveryLease,
          now: recoveredAt,
          failureCode: 'verification_cleanup',
        })
        .catch(() => undefined);
    }
    await pool.end();
  }

  let rejectedUnsafePromotion = false;
  await withClient(databaseUrl, 'daily-trader-phase4-verification-guard', async (client) => {
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE portfolio_current_snapshot
            SET sync_run_id = $1, promoted_at = clock_timestamp()
          WHERE singleton`,
        [context.partialRunId],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ROLLBACK');
    } catch {
      rejectedUnsafePromotion = true;
      await client.query('ROLLBACK').catch(() => undefined);
    }
  });
  if (!rejectedUnsafePromotion) {
    throw new Error('A failed partial portfolio cycle could be promoted');
  }

  await withClient(databaseUrl, 'daily-trader-phase4-verification-state', async (client) => {
    const result = await client.query(
      `SELECT current.sync_run_id AS current_run_id,
              failed.state AS failed_state,
              failed.failure_code AS failed_code,
              failed.capture_completed_at IS NOT NULL AS terminalized,
              COUNT(request.sync_run_id)::text AS partial_request_count
         FROM portfolio_current_snapshot AS current
         JOIN portfolio_sync_runs AS failed ON failed.sync_run_id = $1
         LEFT JOIN portfolio_sync_requests AS request ON request.sync_run_id = failed.sync_run_id
        WHERE current.singleton
        GROUP BY current.sync_run_id, failed.state, failed.failure_code,
                 failed.capture_completed_at`,
      [context.partialRunId],
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row?.current_run_id !== context.currentRunId ||
      row?.failed_state !== 'failed' ||
      row?.failed_code !== 'worker_restarted' ||
      row?.terminalized !== true ||
      row?.partial_request_count !== '1'
    ) {
      throw new Error('Failed partial portfolio state was not isolated from current state');
    }
  });

  process.stdout.write(
    `${JSON.stringify({
      event: 'phase4.partial_cycle.guard_verified',
      failureCode: 'worker_restarted',
      evidenceRetained: true,
      currentSnapshotPreserved: true,
      restartRecovery: true,
      status: 'passed',
    })}\n`,
  );
}

async function verifyApi(databaseUrl, environment, pass) {
  const [configModule, domainModule, observabilityModule, apiModule, databaseModule] =
    await Promise.all([
      import('../packages/config/dist/index.js'),
      import('../packages/domain/dist/index.js'),
      import('../packages/observability/dist/index.js'),
      import('../apps/api/dist/app.js'),
      import('../apps/api/dist/portfolio-postgres.js'),
    ]);
  const config = configModule.loadConfig(environment);
  const portfolioDatabase = databaseModule.createPortfolioApiDatabase({
    connectionString: databaseUrl,
    connectionTimeoutMs: config.services.database.connectionTimeoutMs,
    statementTimeoutMs: config.portfolio.operational.statementTimeoutMs,
  });
  const application = apiModule.buildApi({
    config,
    clock: new domainModule.FixedClock(domainModule.createUtcTimestamp('2026-07-13T13:31:05.000Z')),
    logger: observabilityModule.createLogger({
      environment: 'test',
      serviceName: 'phase4-verification-api',
      sink: { write: () => undefined },
    }),
    meter: observabilityModule.getMeter('phase4-verification-api'),
    portfolioReader: portfolioDatabase.reader,
  });
  let presentationChecksum;
  try {
    const response = await application.inject({ method: 'GET', url: '/v1/portfolio' });
    const serialized = response.body;
    const body = response.json();
    const forbidden = [
      environment.PAPER_BROKER_API_KEY,
      environment.PAPER_BROKER_API_SECRET,
      environment.PAPER_BROKER_ACCOUNT_ID,
      'SANITIZED-PAPER-ACCOUNT',
      'accountFingerprint',
      'account_fingerprint',
      'clientOrderId',
      'client_order_id',
      'fillObservationId',
      'fill_observation_id',
      'fixture-asset-',
      'fixture-client-',
      'fixture-fill-',
      'fixture-order-',
      '"orderIntent"',
      'orderObservationId',
      'order_observation_id',
      'positionObservationId',
      'position_observation_id',
      'providerActivityId',
      'provider_activity_id',
      'providerAssetId',
      'provider_asset_id',
      'providerOrderId',
      'provider_order_id',
      'sanitized-fixture-request',
      '"submit"',
      'syncRunId',
      'sync_run_id',
    ].filter((value) => typeof value === 'string' && value.length > 0);
    if (
      response.statusCode !== 200 ||
      response.headers['cache-control'] !== 'no-store' ||
      body?.schemaVersion !== 'daily-trader.portfolio.api.v1' ||
      body?.access !== 'read_only' ||
      body?.environment !== 'paper' ||
      body?.executionEnabled !== false ||
      body?.valuationAuthority !== 'alpaca_paper_broker_mark' ||
      body?.health?.state !== 'degraded' ||
      body?.health?.reconciliation !== 'converged' ||
      body?.health?.projection !== 'incomplete' ||
      body?.account === null ||
      typeof body?.account !== 'object' ||
      ![body.account.cash, body.account.equity, body.account.buyingPower].every(
        isExactDecimalTextOrNull,
      ) ||
      body?.metrics !== null ||
      !Array.isArray(body?.positions) ||
      body.positions.length === 0 ||
      !body.positions.some((position) => position?.projectionSupport === 'unsupported') ||
      typeof body?.observedOrders?.count !== 'number' ||
      body.observedOrders.count === 0 ||
      typeof body?.observedFills?.count !== 'number' ||
      body.observedFills.count === 0 ||
      forbidden.some((value) => serialized.includes(value))
    ) {
      throw new Error('The read-only portfolio API verification failed');
    }

    const activityCreatedAfter = body.observedFills.createdAfterExclusive;
    const activityCreatedBefore = body.observedFills.createdBeforeExclusive;
    const latestTransactionAt = body.observedFills.latestTransactionAt;
    const knowledgeStartAt = body.health.knowledgeStartAt;
    const knowledgeEndAt = body.health.knowledgeEndAt;
    if (
      body.observedFills.selectionBasis !== 'provider_created_at' ||
      !isUtcTimestamp(activityCreatedAfter) ||
      !isUtcTimestamp(activityCreatedBefore) ||
      !isUtcTimestamp(latestTransactionAt) ||
      !isUtcTimestamp(knowledgeStartAt) ||
      !isUtcTimestamp(knowledgeEndAt) ||
      body.observedFills.initialBaseline !== true ||
      Date.parse(activityCreatedAfter) >= Date.parse(activityCreatedBefore) ||
      Date.parse(activityCreatedBefore) < Date.parse(knowledgeStartAt) ||
      Date.parse(activityCreatedBefore) > Date.parse(knowledgeEndAt)
    ) {
      throw new Error(
        'The portfolio fill coverage was not an explicit bounded provider-created baseline',
      );
    }

    const pageSpecifications = [
      {
        resource: 'positions',
        schemaVersion: 'daily-trader.portfolio.positions-page.v1',
        expectedTotal: body.positions.length,
      },
      {
        resource: 'orders',
        schemaVersion: 'daily-trader.portfolio.orders-page.v1',
        expectedTotal: body.observedOrders.count,
      },
      {
        resource: 'fills',
        schemaVersion: 'daily-trader.portfolio.fills-page.v1',
        expectedTotal: body.observedFills.count,
      },
    ];
    const serializedPresentation = [serialized];
    const resourceCounts = {};
    for (const specification of pageSpecifications) {
      let offset = 0;
      let observedTotal = 0;
      let pageCount = 0;
      for (;;) {
        const pageResponse = await application.inject({
          method: 'GET',
          url: `/v1/portfolio/${specification.resource}?limit=1&offset=${String(offset)}`,
        });
        const pageSerialized = pageResponse.body;
        const page = pageResponse.json();
        pageCount += 1;
        if (
          pageCount > 100 ||
          pageResponse.statusCode !== 200 ||
          pageResponse.headers['cache-control'] !== 'no-store' ||
          page?.schemaVersion !== specification.schemaVersion ||
          page?.access !== 'read_only' ||
          page?.environment !== 'paper' ||
          page?.executionEnabled !== false ||
          page?.state !== 'available' ||
          page?.snapshotAsOf !== body.health.snapshotAsOf ||
          page?.pagination?.limit !== 1 ||
          page?.pagination?.offset !== offset ||
          page?.pagination?.returned !== page?.items?.length ||
          page?.pagination?.total !== specification.expectedTotal ||
          !Array.isArray(page?.items) ||
          page.items.length !== 1 ||
          !page.items.every((item) => hasSafePageItem(specification.resource, item)) ||
          forbidden.some((value) => pageSerialized.includes(value))
        ) {
          throw new Error(`The ${specification.resource} portfolio page verification failed`);
        }
        serializedPresentation.push(pageSerialized);
        observedTotal += page.items.length;
        const nextOffset = page.pagination.nextOffset;
        if (nextOffset === null) break;
        if (!Number.isSafeInteger(nextOffset) || nextOffset !== offset + page.items.length) {
          throw new Error(`The ${specification.resource} portfolio pagination was unstable`);
        }
        offset = nextOffset;
      }
      if (observedTotal !== specification.expectedTotal || observedTotal === 0) {
        throw new Error(`The ${specification.resource} portfolio page count was incomplete`);
      }
      resourceCounts[specification.resource] = observedTotal;

      const rejectedMutation = await application.inject({
        method: 'POST',
        url: `/v1/portfolio/${specification.resource}`,
      });
      if (rejectedMutation.statusCode !== 404) {
        throw new Error(`The ${specification.resource} portfolio endpoint accepted a mutation`);
      }
    }

    const invalidPagination = await application.inject({
      method: 'GET',
      url: '/v1/portfolio/positions?limit=0',
    });
    const invalidPaginationBody = invalidPagination.json();
    if (
      invalidPagination.statusCode !== 400 ||
      invalidPagination.headers['cache-control'] !== 'no-store' ||
      invalidPaginationBody?.schemaVersion !== 'daily-trader.portfolio.error.v1' ||
      invalidPaginationBody?.access !== 'read_only' ||
      invalidPaginationBody?.environment !== 'paper' ||
      invalidPaginationBody?.executionEnabled !== false ||
      invalidPaginationBody?.status !== 'invalid_request' ||
      invalidPaginationBody?.code !== 'invalid_pagination'
    ) {
      throw new Error('The portfolio API accepted unsafe pagination');
    }
    presentationChecksum = safeFingerprint(serializedPresentation.join('\n'));

    process.stdout.write(
      `${JSON.stringify({
        event: 'phase4.api.resources_verified',
        fillCoverage: 'bounded_provider_created_at_open_interval',
        pass,
        resourceCounts,
        status: 'passed',
      })}\n`,
    );
  } finally {
    await application.close();
    await portfolioDatabase.close();
  }

  process.stdout.write(
    `${JSON.stringify({
      event: 'phase4.api.verified',
      access: 'read_only',
      environment: 'paper',
      executionEnabled: false,
      pass,
      status: 'passed',
    })}\n`,
  );
  return presentationChecksum;
}

const configuredEnvironment = process.env.APP_ENV ?? 'local';
if (configuredEnvironment !== 'local' && configuredEnvironment !== 'test') {
  process.stderr.write('Phase 4 verification is restricted to local or test environments.\n');
  process.exit(1);
}

let baseDatabaseUrl;
let verificationRedisUrl;
try {
  baseDatabaseUrl = requireLoopbackUrl(
    process.env.DATABASE_URL ?? defaultDatabaseUrl,
    ['postgres:', 'postgresql:'],
    'DATABASE_URL',
  );
  verificationRedisUrl = requireLoopbackUrl(
    process.env.REDIS_URL ?? defaultRedisUrl,
    ['redis:', 'rediss:'],
    'REDIS_URL',
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid local service URL'}\n`);
  process.exit(1);
}

const sanitizedEnvironment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('MARKET_DATA_') &&
        !key.startsWith('SIGNAL_') &&
        !key.startsWith('PORTFOLIO_') &&
        !key.startsWith('PAPER_BROKER_') &&
        !key.startsWith('LIVE_BROKER_'),
    ),
  ),
  MARKET_DATA_MODE: 'disabled',
  MARKET_DATA_API_KEY: '',
  MARKET_DATA_API_SECRET: '',
  SIGNAL_MODE: 'disabled',
  PORTFOLIO_MODE: 'disabled',
  BROKER_MODE: 'paper',
  EXECUTION_ENABLED: 'false',
};
const token = `${String(process.pid)}_${String(Date.now())}`;
const databaseName = `daily_trader_p4_verify_${token}`;
const verificationDatabaseUrl = new URL(baseDatabaseUrl);
verificationDatabaseUrl.pathname = `/${databaseName}`;
verificationRedisUrl = new URL(verificationRedisUrl);
verificationRedisUrl.pathname = '/13';

const childEnvironment = {
  APP_ENV: 'test',
  DATABASE_URL: verificationDatabaseUrl.toString(),
  REDIS_URL: verificationRedisUrl.toString(),
  MARKET_DATA_MODE: 'disabled',
  MARKET_DATA_API_KEY: '',
  MARKET_DATA_API_SECRET: '',
  SIGNAL_MODE: 'disabled',
  PORTFOLIO_MODE: 'paper_read_only',
  PAPER_BROKER_BASE_URL: 'https://paper-api.alpaca.markets/v2',
  PAPER_BROKER_API_KEY: 'sanitized-fixture-key',
  PAPER_BROKER_API_SECRET: 'sanitized-fixture-secret',
  PAPER_BROKER_ACCOUNT_ID: 'fixture-paper-account-id',
  LIVE_BROKER_BASE_URL: '',
  LIVE_BROKER_API_KEY: '',
  LIVE_BROKER_API_SECRET: '',
  LIVE_BROKER_ACCOUNT_ID: '',
  BROKER_MODE: 'paper',
  EXECUTION_ENABLED: 'false',
  TELEMETRY_EXPORTER: 'none',
};

let servicesAttempted = false;
let servicesRunning = false;
let databaseCreateAttempted = false;
let failed = false;
let activeStep = 'startup';
let initialApiSnapshotChecksum;

try {
  activeStep = 'ci';
  runScript('ci');
  activeStep = 'dependency_audit';
  runScript('audit:dependencies');
  activeStep = 'fixture_verification';
  runScript('portfolio:fixture:verify', childEnvironment);

  activeStep = 'service_start';
  servicesAttempted = true;
  runScript('services:up');
  servicesRunning = true;
  runScript('services:check');

  activeStep = 'database_create';
  databaseCreateAttempted = true;
  await withClient(
    baseDatabaseUrl.toString(),
    'daily-trader-phase4-verification-admin',
    async (client) => {
      await client.query(`CREATE DATABASE ${quotedIdentifier(databaseName)} TEMPLATE template0`);
    },
  );

  activeStep = 'migration';
  runScript('db:migrate', childEnvironment);
  runScript('db:migrate', childEnvironment);
  runScript('services:check', childEnvironment);

  activeStep = 'persistence';
  runScript('portfolio:fixture:persist', childEnvironment);
  activeStep = 'status';
  runScript('portfolio:status', childEnvironment);
  activeStep = 'api';
  initialApiSnapshotChecksum = await verifyApi(
    verificationDatabaseUrl.toString(),
    childEnvironment,
    'initial',
  );
  activeStep = 'pending_cycle_create';
  const pendingCycleContext = await createPendingPartialCycle(
    verificationDatabaseUrl.toString(),
    childEnvironment,
  );

  activeStep = 'service_restart_with_pending_cycle';
  servicesRunning = false;
  runScript('services:stop');
  runScript('services:up');
  servicesRunning = true;
  runScript('services:check', childEnvironment);

  activeStep = 'restart_pending_cycle';
  await verifyPendingPartialCycle(
    verificationDatabaseUrl.toString(),
    pendingCycleContext,
    'after_restart',
  );
  activeStep = 'restart_orphan_recovery';
  await recoverPendingPartialCycle(
    verificationDatabaseUrl.toString(),
    childEnvironment,
    pendingCycleContext,
  );

  activeStep = 'restart_status';
  runScript('portfolio:status', childEnvironment);
  activeStep = 'restart_api';
  const restartedApiSnapshotChecksum = await verifyApi(
    verificationDatabaseUrl.toString(),
    childEnvironment,
    'restart',
  );
  if (
    initialApiSnapshotChecksum === undefined ||
    restartedApiSnapshotChecksum !== initialApiSnapshotChecksum
  ) {
    throw new Error('Restarted Phase 4 presentation state changed unexpectedly');
  }

  process.stdout.write(
    `${JSON.stringify({
      event: 'phase4.technical_verification.complete',
      providerSmoke: 'not_run',
      status: 'passed',
    })}\n`,
  );
} catch {
  failed = true;
  process.stderr.write(
    `${JSON.stringify({ event: 'phase4.verification.failed', step: activeStep })}\n`,
  );
} finally {
  if (databaseCreateAttempted) {
    if (!servicesRunning) {
      try {
        runScript('services:up');
        servicesRunning = true;
      } catch {
        failed = true;
      }
    }
    if (servicesRunning) {
      try {
        await withClient(
          baseDatabaseUrl.toString(),
          'daily-trader-phase4-verification-cleanup',
          async (client) => {
            await client.query(
              `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`,
            );
          },
        );
      } catch {
        failed = true;
        process.stderr.write('Phase 4 verification database cleanup failed.\n');
      }
    }
  }

  if (servicesAttempted) {
    try {
      servicesRunning = false;
      runScript('services:stop');
    } catch {
      failed = true;
      process.stderr.write('Phase 4 service cleanup failed.\n');
    }
  }
}

process.exitCode = failed ? 1 : 0;
