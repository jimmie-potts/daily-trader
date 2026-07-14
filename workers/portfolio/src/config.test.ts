import { ALPACA_PAPER_TRADING_API_URL, loadConfig } from '@daily-trader/config';
import { describe, expect, it } from 'vitest';

import { projectPortfolioWorkerConfig } from './config.js';

describe('portfolio worker configuration projection', () => {
  it('keeps only the read-only paper portfolio and database boundary', () => {
    const projected = projectPortfolioWorkerConfig(
      loadConfig({
        APP_ENV: 'test',
        PORTFOLIO_MODE: 'paper_read_only',
        PAPER_BROKER_BASE_URL: ALPACA_PAPER_TRADING_API_URL,
        PAPER_BROKER_API_KEY: 'paper-key-do-not-copy',
        PAPER_BROKER_API_SECRET: 'paper-secret-do-not-copy',
        PAPER_BROKER_ACCOUNT_ID: 'expected-account-do-not-copy',
        PORTFOLIO_ORDER_PAGE_SIZE: '250',
        PORTFOLIO_FILL_PAGE_SIZE: '50',
        PORTFOLIO_MAX_ORDERS: '30',
        PORTFOLIO_MAX_FILLS_PER_SYNC: '40',
        PORTFOLIO_STATEMENT_TIMEOUT_MS: '5000',
        MARKET_DATA_API_KEY: 'market-key-do-not-copy',
        MARKET_DATA_API_SECRET: 'market-secret-do-not-copy',
      }),
    );

    expect(projected.portfolio).toMatchObject({
      mode: 'paper_read_only',
      provider: 'alpaca',
      baseUrl: ALPACA_PAPER_TRADING_API_URL,
      readResources: ['account', 'positions', 'orders', 'fills'],
      operational: {
        orderPageSize: 250,
        fillPageSize: 50,
        maxOrders: 30,
        maxFillsPerSync: 40,
        statementTimeoutMs: 5_000,
      },
    });
    expect(projected.trading).toEqual({ brokerMode: 'paper', executionEnabled: false });
    expect(projected).not.toHaveProperty('marketData');
    expect(projected).not.toHaveProperty('signal');
    expect(projected).not.toHaveProperty('redis');
    expect(projected).not.toHaveProperty('providers');
    expect(Object.isFrozen(projected)).toBe(true);
  });
});
