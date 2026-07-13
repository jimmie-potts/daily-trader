import { loadConfig } from '@daily-trader/config';
import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import { createLogger, getMeter } from '@daily-trader/observability';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApi, type PortfolioSnapshotReader } from './app.js';
import type {
  PortfolioApiFillsPage,
  PortfolioApiOrdersPage,
  PortfolioApiPositionsPage,
  PortfolioApiRepositorySnapshot,
} from './portfolio.js';

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

describe('GET /v1/portfolio', () => {
  const rejectedMethods = ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
  const noSnapshot: PortfolioApiRepositorySnapshot = {
    current: {
      sync_run_id: null,
      capture_completed_at: null,
      knowledge_start_at: null,
      knowledge_end_at: null,
      activity_window_started_at: null,
      activity_cutover_at: null,
      activity_baseline_only: null,
      account_fingerprint: null,
      position_count: null,
      order_count: null,
      fill_count: null,
      currency: null,
      cash: null,
      equity: null,
      buying_power: null,
      day_profit_loss: null,
      unrealized_profit_loss: null,
      gross_exposure: null,
      net_exposure: null,
      gross_exposure_percent: null,
      net_exposure_percent: null,
      concentration_percent: null,
      projection_state: null,
      incomplete_reason: null,
      reconciliation_state: null,
      change_state: null,
      worker_lifecycle: 'disabled',
      worker_heartbeat_at: '2026-07-13T17:20:00.000Z',
      worker_lease_expires_at: null,
      worker_lease_current: false,
      worker_failure_code: null,
      last_sync_started_at: null,
      last_sync_completed_at: null,
    },
    positions: [],
    orderStatuses: [],
    fills: { fill_count: '0', last_fill_at: null },
  };

  const emptyPositionsPage: PortfolioApiPositionsPage = {
    schemaVersion: 'daily-trader.portfolio.positions-page.v1',
    access: 'read_only',
    environment: 'paper',
    executionEnabled: false,
    state: 'no_snapshot',
    snapshotAsOf: null,
    pagination: { limit: 25, offset: 0, returned: 0, total: 0, nextOffset: null },
    items: [],
  };
  const emptyOrdersPage: PortfolioApiOrdersPage = {
    schemaVersion: 'daily-trader.portfolio.orders-page.v2',
    access: 'read_only',
    environment: 'paper',
    executionEnabled: false,
    state: 'no_snapshot',
    snapshotAsOf: null,
    pagination: { limit: 25, offset: 0, returned: 0, total: 0, nextOffset: null },
    items: [],
  };
  const emptyFillsPage: PortfolioApiFillsPage = {
    schemaVersion: 'daily-trader.portfolio.fills-page.v1',
    access: 'read_only',
    environment: 'paper',
    executionEnabled: false,
    state: 'no_snapshot',
    snapshotAsOf: null,
    pagination: { limit: 25, offset: 0, returned: 0, total: 0, nextOffset: null },
    items: [],
  };

  function portfolioReader(
    overrides: Partial<PortfolioSnapshotReader> = {},
  ): PortfolioSnapshotReader {
    return {
      read: () => Promise.resolve(noSnapshot),
      readPositions: () => Promise.resolve(emptyPositionsPage),
      readOrders: () => Promise.resolve(emptyOrdersPage),
      readFills: () => Promise.resolve(emptyFillsPage),
      ...overrides,
    };
  }

  it('serves a no-store, read-only paper snapshot without execution controls', async () => {
    const logs: string[] = [];
    const application = buildApi({
      config: loadConfig({ APP_ENV: 'test' }),
      logger: createLogger({
        environment: 'test',
        serviceName: 'api-test',
        sink: { write: (chunk) => logs.push(chunk) },
      }),
      meter: getMeter('api-test'),
      clock: new FixedClock(createUtcTimestamp('2026-07-13T17:20:30.000Z')),
      portfolioReader: portfolioReader(),
    });
    applications.push(application);

    const response = await application.inject({ method: 'GET', url: '/v1/portfolio' });

    expect(logs.join('')).toContain('api.portfolio.read');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      access: 'read_only',
      environment: 'paper',
      executionEnabled: false,
      health: { state: 'no_snapshot' },
      observedFills: {
        count: 0,
        selectionBasis: 'provider_created_at',
        createdAfterExclusive: null,
        createdBeforeExclusive: null,
        latestTransactionAt: null,
        initialBaseline: null,
      },
    });
    expect(response.body).not.toContain('orderIntent');
    expect(response.body).not.toContain('submit');
  });

  it('fails closed with a sanitized unavailable response', async () => {
    const logs: string[] = [];
    const application = buildApi({
      config: loadConfig({ APP_ENV: 'test' }),
      logger: createLogger({
        environment: 'test',
        serviceName: 'api-test',
        sink: { write: (chunk) => logs.push(chunk) },
      }),
      meter: getMeter('api-test'),
      portfolioReader: portfolioReader({
        read: async () => Promise.reject(new Error('secret database detail')),
      }),
    });
    applications.push(application);

    const response = await application.inject({ method: 'GET', url: '/v1/portfolio' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      schemaVersion: 'daily-trader.portfolio.error.v1',
      access: 'read_only',
      environment: 'paper',
      executionEnabled: false,
      status: 'unavailable',
    });
    expect(logs.join('')).toContain('api.portfolio.failed');
    expect(logs.join('')).not.toContain('secret database detail');
  });

  it.each(rejectedMethods)('%s cannot mutate the portfolio route', async (method) => {
    const application = buildApi({
      config: loadConfig({ APP_ENV: 'test' }),
      logger: createLogger({ environment: 'test', serviceName: 'api-test' }),
      meter: getMeter('api-test'),
      portfolioReader: portfolioReader(),
    });
    applications.push(application);

    const response = await application.inject({ method, url: '/v1/portfolio' });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ['positions', 'daily-trader.portfolio.positions-page.v1'],
    ['orders', 'daily-trader.portfolio.orders-page.v2'],
    ['fills', 'daily-trader.portfolio.fills-page.v1'],
  ] as const)(
    'serves bounded GET-only %s pages without caching',
    async (resource, schemaVersion) => {
      const application = buildApi({
        config: loadConfig({ APP_ENV: 'test' }),
        logger: createLogger({ environment: 'test', serviceName: 'api-test' }),
        meter: getMeter('api-test'),
        portfolioReader: portfolioReader(),
      });
      applications.push(application);

      const response = await application.inject({
        method: 'GET',
        url: `/v1/portfolio/${resource}?limit=25&offset=0`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({
        schemaVersion,
        access: 'read_only',
        environment: 'paper',
        executionEnabled: false,
        pagination: { limit: 25, offset: 0, returned: 0, total: 0, nextOffset: null },
        items: [],
      });
    },
  );

  it('applies safe pagination defaults and forwards explicit bounded values', async () => {
    const requests: { limit: number; offset: number }[] = [];
    const application = buildApi({
      config: loadConfig({ APP_ENV: 'test' }),
      logger: createLogger({ environment: 'test', serviceName: 'api-test' }),
      meter: getMeter('api-test'),
      portfolioReader: portfolioReader({
        readPositions: (request) => {
          requests.push(request);
          return Promise.resolve({
            ...emptyPositionsPage,
            pagination: {
              ...emptyPositionsPage.pagination,
              limit: request.limit,
              offset: request.offset,
            },
          });
        },
      }),
    });
    applications.push(application);

    expect(
      (await application.inject({ method: 'GET', url: '/v1/portfolio/positions' })).statusCode,
    ).toBe(200);
    expect(
      (
        await application.inject({
          method: 'GET',
          url: '/v1/portfolio/positions?limit=100&offset=50000',
        })
      ).statusCode,
    ).toBe(200);
    expect(requests).toEqual([
      { limit: 25, offset: 0 },
      { limit: 100, offset: 50_000 },
    ]);
  });

  it.each([
    'limit=0',
    'limit=101',
    'limit=1.5',
    'limit=01',
    'offset=-1',
    'offset=50001',
    'offset=1e2',
    'cursor=opaque',
    'limit=1&limit=2',
  ])('rejects unsafe pagination query %s without reading the database', async (query) => {
    let reads = 0;
    const application = buildApi({
      config: loadConfig({ APP_ENV: 'test' }),
      logger: createLogger({ environment: 'test', serviceName: 'api-test' }),
      meter: getMeter('api-test'),
      portfolioReader: portfolioReader({
        readPositions: () => {
          reads += 1;
          return Promise.resolve(emptyPositionsPage);
        },
      }),
    });
    applications.push(application);

    const response = await application.inject({
      method: 'GET',
      url: `/v1/portfolio/positions?${query}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      schemaVersion: 'daily-trader.portfolio.error.v1',
      access: 'read_only',
      environment: 'paper',
      executionEnabled: false,
      status: 'invalid_request',
      code: 'invalid_pagination',
    });
    expect(reads).toBe(0);
  });

  it('fails a resource read closed without returning database details', async () => {
    const logs: string[] = [];
    const application = buildApi({
      config: loadConfig({ APP_ENV: 'test' }),
      logger: createLogger({
        environment: 'test',
        serviceName: 'api-test',
        sink: { write: (chunk) => logs.push(chunk) },
      }),
      meter: getMeter('api-test'),
      portfolioReader: portfolioReader({
        readFills: async () => Promise.reject(new Error('secret database detail')),
      }),
    });
    applications.push(application);

    const response = await application.inject({ method: 'GET', url: '/v1/portfolio/fills' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'unavailable' });
    expect(logs.join('')).not.toContain('secret database detail');
  });

  it.each(['positions', 'orders', 'fills'] as const)(
    'rejects non-GET methods and unknown versions for %s',
    async (resource) => {
      const application = buildApi({
        config: loadConfig({ APP_ENV: 'test' }),
        logger: createLogger({ environment: 'test', serviceName: 'api-test' }),
        meter: getMeter('api-test'),
        portfolioReader: portfolioReader(),
      });
      applications.push(application);

      for (const method of rejectedMethods) {
        expect(
          (await application.inject({ method, url: `/v1/portfolio/${resource}` })).statusCode,
        ).toBe(404);
      }
      expect(
        (await application.inject({ method: 'GET', url: `/v2/portfolio/${resource}` })).statusCode,
      ).toBe(404);
    },
  );
});
