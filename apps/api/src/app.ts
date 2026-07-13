import type { ApplicationConfig } from '@daily-trader/config';
import { getSafeConfigDiagnostics } from '@daily-trader/config';
import { createUtcTimestamp, type Clock } from '@daily-trader/domain';
import { type AppLogger, type AppMeter, withSpan } from '@daily-trader/observability';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import {
  buildPortfolioApiSnapshot,
  parsePortfolioApiPageRequest,
  type PortfolioApiFillsPage,
  type PortfolioApiOrdersPage,
  type PortfolioApiPageRequest,
  type PortfolioApiPositionsPage,
  type PortfolioApiRepositorySnapshot,
} from './portfolio.js';

export interface PortfolioSnapshotReader {
  read(): Promise<PortfolioApiRepositorySnapshot>;
  readPositions(request: PortfolioApiPageRequest): Promise<PortfolioApiPositionsPage>;
  readOrders(request: PortfolioApiPageRequest): Promise<PortfolioApiOrdersPage>;
  readFills(request: PortfolioApiPageRequest): Promise<PortfolioApiFillsPage>;
}

export interface ApiDependencies {
  readonly config: ApplicationConfig;
  readonly logger: AppLogger;
  readonly meter: AppMeter;
  readonly clock?: Clock;
  readonly portfolioReader?: PortfolioSnapshotReader;
}

const systemClock: Clock = Object.freeze({
  now: () => createUtcTimestamp(new Date().toISOString()),
});

type PortfolioResource = 'fills' | 'orders' | 'positions';

function unavailableResponse(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: 'daily-trader.portfolio.error.v1',
    access: 'read_only',
    environment: 'paper',
    executionEnabled: false,
    status: 'unavailable',
  });
}

function invalidRequestResponse(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: 'daily-trader.portfolio.error.v1',
    access: 'read_only',
    environment: 'paper',
    executionEnabled: false,
    status: 'invalid_request',
    code: 'invalid_pagination',
  });
}

export function buildApi(dependencies: ApiDependencies): FastifyInstance {
  const app = Fastify({
    exposeHeadRoutes: false,
    logger: false,
  });

  app.get('/health', (request, reply) => {
    return withSpan('api.health', () => {
      dependencies.meter.recordHealth('healthy');
      dependencies.logger.info('api.health.checked', {
        correlationId: request.id,
      });
      void reply.header('cache-control', 'no-store');

      return {
        brokerMode: dependencies.config.trading.brokerMode,
        configuration: getSafeConfigDiagnostics(dependencies.config),
        executionEnabled: dependencies.config.trading.executionEnabled,
        marketData: 'not_configured',
        service: 'api',
        status: 'healthy',
      };
    });
  });

  app.get('/v1/portfolio', async (request, reply) => {
    void reply.header('cache-control', 'no-store');
    const reader = dependencies.portfolioReader;
    if (reader === undefined) {
      dependencies.logger.warn('api.portfolio.unavailable', {
        code: 'PORTFOLIO_REPOSITORY_UNAVAILABLE',
        correlationId: request.id,
      });
      return reply.code(503).send(unavailableResponse());
    }

    try {
      return await withSpan('api.portfolio.read', async () => {
        const snapshot = buildPortfolioApiSnapshot({
          repository: await reader.read(),
          clock: dependencies.clock ?? systemClock,
          staleAfterMs: dependencies.config.portfolio.operational.staleAfterMs,
        });
        dependencies.logger.info('api.portfolio.read', {
          correlationId: request.id,
          healthState: snapshot.health.state,
          positionCount: snapshot.positions.length,
        });
        return snapshot;
      });
    } catch {
      dependencies.logger.error('api.portfolio.failed', {
        code: 'PORTFOLIO_READ_FAILED',
        correlationId: request.id,
      });
      return reply.code(503).send(unavailableResponse());
    }
  });

  const readPortfolioResource = async (
    resource: PortfolioResource,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> => {
    void reply.header('cache-control', 'no-store');
    const pageRequest = parsePortfolioApiPageRequest(request.query);
    if (pageRequest === null) {
      dependencies.logger.warn('api.portfolio.page.invalid', {
        code: 'PORTFOLIO_PAGINATION_INVALID',
        correlationId: request.id,
        resource,
      });
      return reply.code(400).send(invalidRequestResponse());
    }
    const reader = dependencies.portfolioReader;
    if (reader === undefined) {
      dependencies.logger.warn('api.portfolio.page.unavailable', {
        code: 'PORTFOLIO_REPOSITORY_UNAVAILABLE',
        correlationId: request.id,
        resource,
      });
      return reply.code(503).send(unavailableResponse());
    }

    try {
      return await withSpan(`api.portfolio.${resource}.read`, async () => {
        const page =
          resource === 'positions'
            ? await reader.readPositions(pageRequest)
            : resource === 'orders'
              ? await reader.readOrders(pageRequest)
              : await reader.readFills(pageRequest);
        dependencies.logger.info('api.portfolio.page.read', {
          correlationId: request.id,
          resource,
          returned: page.pagination.returned,
          total: page.pagination.total,
        });
        return page;
      });
    } catch {
      dependencies.logger.error('api.portfolio.page.failed', {
        code: 'PORTFOLIO_PAGE_READ_FAILED',
        correlationId: request.id,
        resource,
      });
      return reply.code(503).send(unavailableResponse());
    }
  };

  app.get('/v1/portfolio/positions', (request, reply) =>
    readPortfolioResource('positions', request, reply),
  );
  app.get('/v1/portfolio/orders', (request, reply) =>
    readPortfolioResource('orders', request, reply),
  );
  app.get('/v1/portfolio/fills', (request, reply) =>
    readPortfolioResource('fills', request, reply),
  );

  return app;
}
