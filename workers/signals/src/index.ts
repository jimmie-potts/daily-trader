import { randomUUID } from 'node:crypto';

import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import { createLogger, getMeter, initializeObservability } from '@daily-trader/observability';

import { projectSignalsWorkerConfig } from './config.js';
import { SignalsWorkerError } from './errors.js';
import { createPgSignalsPool } from './persistence/pg-pool.js';
import { SignalsRepository } from './persistence/repository.js';
import { runDisabledSignalsRuntime, runSignalsRuntime } from './runtime.js';
import { createBoundedPoolShutdown } from './shutdown.js';
import { SystemClock } from './system-clock.js';

async function closePoolWithin(
  pool: ReturnType<typeof createPgSignalsPool>,
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
  const config = projectSignalsWorkerConfig(loadConfig());
  const telemetry = initializeObservability({
    environment: config.environment,
    exporter: config.runtime.telemetryExporter,
    serviceName: 'daily-trader-signals-worker',
    shutdownTimeoutMs: config.signal.operational.shutdownTimeoutMs,
  });
  const logger = createLogger({
    environment: config.environment,
    level: config.runtime.logLevel,
    serviceName: 'daily-trader-signals-worker',
  });
  const meter = getMeter('daily-trader-signals-worker');
  logger.info('signals_worker.configuration.ready', {
    mode: config.signal.mode,
    definition: config.signal.configuration.signalDefinitionVersion,
    symbols: config.signal.configuration.scope.map((item) => item.symbol).join(','),
    lookback_bars: config.signal.configuration.lookbackBars,
    volume_multiplier: config.signal.configuration.volumeMultiplier,
  });
  if (process.argv.includes('--once')) {
    await telemetry.shutdown();
    return;
  }

  const pool = createPgSignalsPool({
    connectionString: config.database.url,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.signal.operational.statementTimeoutMs,
  });
  const repository = new SignalsRepository(pool, `signal-worker-${randomUUID()}`);
  if (config.signal.mode === 'disabled') {
    const controller = new AbortController();
    const shutdown = createBoundedPoolShutdown({
      controller,
      pool,
      timeoutMs: config.signal.operational.shutdownTimeoutMs,
    });
    process.once('SIGINT', shutdown.stop);
    process.once('SIGTERM', shutdown.stop);
    try {
      await runDisabledSignalsRuntime(
        {
          config,
          repository,
          clock: new SystemClock(),
          logger,
          meter,
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
    return;
  }

  const controller = new AbortController();
  const shutdown = createBoundedPoolShutdown({
    controller,
    pool,
    timeoutMs: config.signal.operational.shutdownTimeoutMs,
  });
  process.once('SIGINT', shutdown.stop);
  process.once('SIGTERM', shutdown.stop);
  try {
    await runSignalsRuntime(
      {
        config,
        repository,
        clock: new SystemClock(),
        logger,
        meter,
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
      ? { event: 'signals_worker.configuration.invalid', issues: error.issues }
      : {
          event: 'signals_worker.failed',
          code: error instanceof SignalsWorkerError ? error.code : 'unexpected',
        };
  process.stderr.write(`${JSON.stringify(event)}\n`);
  process.exitCode = 1;
});
