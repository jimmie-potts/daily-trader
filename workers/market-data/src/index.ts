import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import {
  createLogger,
  getMeter,
  initializeObservability,
  withSpan,
} from '@daily-trader/observability';

import { emitWorkerHealth } from './health.js';
import { runPaperMarketDataRuntime } from './paper-runtime.js';
import { SystemClock } from './system-clock.js';
import { safeWorkerFailure } from './worker-failure.js';

async function main(): Promise<void> {
  loadOptionalEnvironmentFile();
  const config = loadConfig();
  const telemetry = initializeObservability({
    environment: config.environment,
    exporter: config.runtime.telemetryExporter,
    serviceName: 'daily-trader-market-data-worker',
    shutdownTimeoutMs: config.marketData.shutdownTimeoutMs,
  });
  const logger = createLogger({
    environment: config.environment,
    level: config.runtime.logLevel,
    serviceName: 'daily-trader-market-data-worker',
  });
  const meter = getMeter('daily-trader-market-data-worker');
  const dependencies = { config, logger, meter };

  withSpan('market_data_worker.health', () => emitWorkerHealth(dependencies));
  if (process.argv.includes('--once')) {
    await telemetry.shutdown();
    return;
  }

  const controller = new AbortController();
  let telemetryShutdownPromise: Promise<void> | undefined;
  const shutdownTelemetry = (): Promise<void> => {
    telemetryShutdownPromise ??= telemetry.shutdown();
    return telemetryShutdownPromise;
  };
  const stop = (signal: NodeJS.Signals): void => {
    meter.recordHealth('stopping');
    logger.info('market_data_worker.stopping', { signal });
    controller.abort();
    void shutdownTelemetry().catch(() => undefined);
  };
  const stopForInterrupt = (): void => stop('SIGINT');
  const stopForTermination = (): void => stop('SIGTERM');
  process.once('SIGINT', stopForInterrupt);
  process.once('SIGTERM', stopForTermination);

  try {
    if (config.marketData.mode === 'paper') {
      await withSpan('market_data_worker.paper_runtime', () =>
        runPaperMarketDataRuntime(
          { clock: new SystemClock(), config, logger, meter },
          controller.signal,
        ),
      );
      return;
    }

    const timer = setInterval(() => {
      withSpan('market_data_worker.health', () => emitWorkerHealth(dependencies));
    }, config.worker.heartbeatIntervalMs);
    try {
      await new Promise<void>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    } finally {
      clearInterval(timer);
    }
  } finally {
    process.removeListener('SIGINT', stopForInterrupt);
    process.removeListener('SIGTERM', stopForTermination);
    await shutdownTelemetry();
  }
}

void main().catch((error: unknown) => {
  const event =
    error instanceof ConfigurationError
      ? { event: 'market_data_worker.configuration.invalid', issues: error.issues }
      : safeWorkerFailure(error);
  process.stderr.write(`${JSON.stringify(event)}\n`);
  process.exitCode = 1;
});
