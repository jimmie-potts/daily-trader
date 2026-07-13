import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import { createLogger, getMeter, initializeObservability } from '@daily-trader/observability';

import { buildApi } from './app.js';
import { createPortfolioApiDatabase } from './portfolio-postgres.js';

async function main(): Promise<void> {
  loadOptionalEnvironmentFile();
  const config = loadConfig();
  const telemetry = initializeObservability({
    environment: config.environment,
    exporter: config.runtime.telemetryExporter,
    serviceName: 'daily-trader-api',
  });
  const logger = createLogger({
    environment: config.environment,
    level: config.runtime.logLevel,
    serviceName: 'daily-trader-api',
  });
  const meter = getMeter('daily-trader-api');
  const portfolioDatabase = createPortfolioApiDatabase({
    connectionString: config.services.database.url,
    connectionTimeoutMs: config.services.database.connectionTimeoutMs,
    statementTimeoutMs: config.portfolio.operational.statementTimeoutMs,
  });
  const application = buildApi({
    config,
    logger,
    meter,
    portfolioReader: portfolioDatabase.reader,
  });
  let stopping: Promise<void> | undefined;

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    stopping ??= (async () => {
      meter.recordHealth('stopping');
      logger.info('api.stopping', { signal });
      await application.close();
      await portfolioDatabase.close();
      await telemetry.shutdown();
    })();
    await stopping;
  };

  process.once('SIGINT', () => {
    void stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    void stop('SIGTERM');
  });

  meter.recordHealth('starting');
  await application.listen({ host: config.api.host, port: config.api.port });
  meter.recordHealth('healthy');
  logger.info('api.started', {
    brokerMode: config.trading.brokerMode,
    executionEnabled: config.trading.executionEnabled,
    host: config.api.host,
    port: config.api.port,
  });
}

void main().catch((error: unknown) => {
  const event =
    error instanceof ConfigurationError
      ? { event: 'api.configuration.invalid', issues: error.issues }
      : { code: 'API_START_FAILED', event: 'api.start.failed' };
  process.stderr.write(`${JSON.stringify(event)}\n`);
  process.exitCode = 1;
});
