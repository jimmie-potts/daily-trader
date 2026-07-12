import { loadConfig } from '@daily-trader/config';
import { createLogger, getMeter } from '@daily-trader/observability';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApi } from './app.js';

const applications: ReturnType<typeof buildApi>[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (application) => application.close()));
});

describe('GET /health', () => {
  it('makes the paper-only, execution-disabled state explicit', async () => {
    const logs: string[] = [];
    const application = buildApi({
      config: loadConfig({ APP_ENV: 'test' }),
      logger: createLogger({
        environment: 'test',
        serviceName: 'api-test',
        sink: { write: (chunk) => logs.push(chunk) },
      }),
      meter: getMeter('api-test'),
    });
    applications.push(application);

    const response = await application.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      brokerMode: 'paper',
      executionEnabled: false,
      marketData: 'not_configured',
      service: 'api',
      status: 'healthy',
    });
    expect(logs.join('')).toContain('api.health.checked');
  });
});
