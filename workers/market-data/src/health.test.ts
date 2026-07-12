import { loadConfig } from '@daily-trader/config';
import { createLogger, getMeter } from '@daily-trader/observability';
import { describe, expect, it } from 'vitest';

import { emitWorkerHealth } from './health.js';

describe('market-data worker foundation health', () => {
  it('reports safe state without pretending a provider is connected', () => {
    const chunks: string[] = [];
    emitWorkerHealth({
      config: loadConfig({ APP_ENV: 'test' }),
      logger: createLogger({
        environment: 'test',
        serviceName: 'market-data-worker-test',
        sink: { write: (chunk) => chunks.push(chunk) },
      }),
      meter: getMeter('market-data-worker-test'),
    });

    const event = JSON.parse(chunks.join('')) as Record<string, unknown>;
    expect(event).toMatchObject({
      brokerMode: 'paper',
      event: 'market_data_worker.health',
      executionEnabled: false,
      marketDataConnection: 'not_configured',
    });
  });
});
