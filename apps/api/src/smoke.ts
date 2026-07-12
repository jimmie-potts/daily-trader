import { loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import { createLogger, getMeter } from '@daily-trader/observability';

import { buildApi } from './app.js';

loadOptionalEnvironmentFile();
const config = loadConfig();
const application = buildApi({
  config,
  logger: createLogger({ environment: config.environment, serviceName: 'daily-trader-api-smoke' }),
  meter: getMeter('daily-trader-api-smoke'),
});

try {
  const response = await application.inject({ method: 'GET', url: '/health' });
  if (response.statusCode !== 200) {
    throw new Error(`health check returned ${response.statusCode}`);
  }
  const health: unknown = JSON.parse(response.body);
  process.stdout.write(`${JSON.stringify({ event: 'api.smoke.passed', health })}\n`);
} finally {
  await application.close();
}
