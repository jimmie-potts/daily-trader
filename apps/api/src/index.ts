import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import { createLogger, getMeter, initializeObservability } from '@daily-trader/observability';

import { buildApi } from './app.js';

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
  const application = buildApi({ config, logger, meter });

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    meter.recordHealth('stopping');
    logger.info('api.stopping', { signal });
    await application.close();
    await telemetry.shutdown();
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
