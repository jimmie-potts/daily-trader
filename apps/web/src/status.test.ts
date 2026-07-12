import { loadConfig } from '@daily-trader/config';
import { describe, expect, it } from 'vitest';

import { getFoundationStatus } from './status.js';

describe('foundation status presentation', () => {
  it('derives the displayed environment and safety state from validated configuration', () => {
    const status = getFoundationStatus(
      loadConfig({
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://db.example.invalid/daily_trader',
        REDIS_URL: 'rediss://cache.example.invalid',
      }),
    );

    expect(status).toEqual({
      brokerMode: 'paper',
      environment: 'staging',
      execution: 'disabled',
      marketData: 'not connected',
    });
  });
});
