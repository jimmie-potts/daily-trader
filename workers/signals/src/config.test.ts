import { loadConfig } from '@daily-trader/config';
import { describe, expect, it } from 'vitest';

import { projectSignalsWorkerConfig } from './config.js';

describe('projectSignalsWorkerConfig', () => {
  it('drops provider, Redis, broker, account, and execution settings immediately', () => {
    const projected = projectSignalsWorkerConfig(
      loadConfig({
        APP_ENV: 'test',
        MARKET_DATA_API_KEY: 'market-key-do-not-copy',
        MARKET_DATA_API_SECRET: 'market-secret-do-not-copy',
        PAPER_BROKER_API_KEY: 'broker-key-do-not-copy',
        PAPER_BROKER_API_SECRET: 'broker-secret-do-not-copy',
        PAPER_BROKER_ACCOUNT_ID: 'account-do-not-copy',
      }),
    );

    expect(Object.keys(projected).sort()).toEqual([
      'database',
      'environment',
      'runtime',
      'signal',
      'worker',
    ]);
    const diagnostic = JSON.stringify(projected);
    expect(diagnostic).not.toContain('do-not-copy');
    expect(diagnostic).not.toContain('redis');
    expect(diagnostic).not.toContain('executionEnabled');
  });
});
