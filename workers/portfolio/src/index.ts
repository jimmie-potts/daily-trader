import { randomUUID } from 'node:crypto';

import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import { createLogger, getMeter, initializeObservability } from '@daily-trader/observability';

import { projectPortfolioWorkerConfig } from './config.js';
import { PortfolioWorkerError } from './errors.js';
import { createPgPortfolioPool } from './persistence/pg-pool.js';
import { PortfolioRepository } from './persistence/repository.js';
import { AlpacaPaperPortfolioProvider, type AlpacaFetch } from './providers/alpaca/index.js';
import { runDisabledPortfolioRuntime, runPortfolioRuntime } from './runtime.js';
import { createBoundedPortfolioShutdown } from './shutdown.js';
import { SystemClock } from './system-clock.js';

const nativeFetch: AlpacaFetch = async (input, init) =>
  fetch(input, {
    headers: init.headers,
    method: init.method,
    redirect: init.redirect,
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });

async function closePoolWithin(
  pool: ReturnType<typeof createPgPortfolioPool>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const completed = await Promise.race([
    pool.end().then(
      () => true,
      () => false,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (!completed) await pool.destroy();
}

async function main(): Promise<void> {
  loadOptionalEnvironmentFile();
  const config = projectPortfolioWorkerConfig(loadConfig());
  const telemetry = initializeObservability({
    environment: config.environment,
    exporter: config.runtime.telemetryExporter,
    serviceName: 'daily-trader-portfolio-worker',
    shutdownTimeoutMs: config.portfolio.operational.shutdownTimeoutMs,
  });
  const logger = createLogger({
    environment: config.environment,
    level: config.runtime.logLevel,
    serviceName: 'daily-trader-portfolio-worker',
  });
  const meter = getMeter('daily-trader-portfolio-worker');
  logger.info('portfolio_worker.configuration.ready', {
    executionEnabled: config.trading.executionEnabled,
    expectedAccountConfigured: config.portfolio.expectedAccountId !== undefined,
    mode: config.portfolio.mode,
    provider: config.portfolio.provider,
  });

  if (process.argv.includes('--once')) {
    await telemetry.shutdown();
    return;
  }

  const controller = new AbortController();
  const stopDisabled = (): void => controller.abort();
  process.once('SIGINT', stopDisabled);
  process.once('SIGTERM', stopDisabled);
  if (config.portfolio.mode === 'disabled') {
    try {
      await runDisabledPortfolioRuntime({ logger, meter, signal: controller.signal });
    } finally {
      process.removeListener('SIGINT', stopDisabled);
      process.removeListener('SIGTERM', stopDisabled);
      await telemetry.shutdown();
    }
    return;
  }

  const { apiKey, apiSecret, expectedAccountId } = config.portfolio;
  if (apiKey === undefined || apiSecret === undefined || expectedAccountId === undefined) {
    throw new PortfolioWorkerError('sync_failed', 'Portfolio credentials are unavailable', false);
  }
  const pool = createPgPortfolioPool({
    connectionString: config.database.url,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.portfolio.operational.statementTimeoutMs,
  });
  const shutdown = createBoundedPortfolioShutdown({
    controller,
    pool,
    timeoutMs: config.portfolio.operational.shutdownTimeoutMs,
  });
  process.removeListener('SIGINT', stopDisabled);
  process.removeListener('SIGTERM', stopDisabled);
  process.once('SIGINT', shutdown.stop);
  process.once('SIGTERM', shutdown.stop);
  const clock = new SystemClock();
  const provider = new AlpacaPaperPortfolioProvider(
    {
      apiKey,
      apiSecret,
      expectedAccountId,
      maxResponseBytes: config.portfolio.operational.maxResponseBytes,
      orderPageSize: config.portfolio.operational.orderPageSize,
      fillPageSize: config.portfolio.operational.fillPageSize,
      maxOrderPages: config.portfolio.operational.maxPages,
      maxFillPages: config.portfolio.operational.maxPages,
      maxPositions: config.portfolio.operational.maxPositions,
      maxOrders: config.portfolio.operational.maxOrders,
      maxFills: config.portfolio.operational.maxFillsPerSync,
    },
    { clock, fetch: nativeFetch },
  );
  const repository = new PortfolioRepository(pool, config);
  try {
    await runPortfolioRuntime(
      {
        config,
        provider,
        repository,
        clock,
        logger,
        meter,
        ownerId: `portfolio-worker-${randomUUID()}`,
        createSyncRunId: () => `portfolio-sync-${randomUUID()}`,
      },
      controller.signal,
    );
  } finally {
    process.removeListener('SIGINT', shutdown.stop);
    process.removeListener('SIGTERM', shutdown.stop);
    await closePoolWithin(pool, shutdown.remainingMs());
    shutdown.cancel();
    await telemetry.shutdown();
  }
}

void main().catch((error: unknown) => {
  const event =
    error instanceof ConfigurationError
      ? { event: 'portfolio_worker.configuration.invalid', issues: error.issues }
      : {
          event: 'portfolio_worker.failed',
          code: error instanceof PortfolioWorkerError ? error.code : 'unexpected',
        };
  process.stderr.write(`${JSON.stringify(event)}\n`);
  process.exitCode = 1;
});
