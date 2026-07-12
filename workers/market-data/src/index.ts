import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import {
  createLogger,
  getMeter,
  initializeObservability,
  withSpan,
} from '@daily-trader/observability';

import { emitWorkerHealth } from './health.js';

async function main(): Promise<void> {
  loadOptionalEnvironmentFile();
  const config = loadConfig();
  const telemetry = initializeObservability({
    environment: config.environment,
    exporter: config.runtime.telemetryExporter,
    serviceName: 'daily-trader-market-data-worker',
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

  const timer = setInterval(() => {
    withSpan('market_data_worker.health', () => emitWorkerHealth(dependencies));
  }, config.worker.heartbeatIntervalMs);

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    clearInterval(timer);
    meter.recordHealth('stopping');
    logger.info('market_data_worker.stopping', { signal });
    await telemetry.shutdown();
  };
  process.once('SIGINT', () => {
    void stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    void stop('SIGTERM');
  });
}

void main().catch((error: unknown) => {
  const event =
    error instanceof ConfigurationError
      ? { event: 'market_data_worker.configuration.invalid', issues: error.issues }
      : { code: 'MARKET_DATA_WORKER_START_FAILED', event: 'market_data_worker.start.failed' };
  process.stderr.write(`${JSON.stringify(event)}\n`);
  process.exitCode = 1;
});
