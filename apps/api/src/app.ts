import { performance } from 'node:perf_hooks';

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
  read(signal: AbortSignal): Promise<PortfolioApiRepositorySnapshot>;
  readPositions(
    request: PortfolioApiPageRequest,
    signal: AbortSignal,
  ): Promise<PortfolioApiPositionsPage>;
  readOrders(
    request: PortfolioApiPageRequest,
    signal: AbortSignal,
  ): Promise<PortfolioApiOrdersPage>;
  readFills(request: PortfolioApiPageRequest, signal: AbortSignal): Promise<PortfolioApiFillsPage>;
}

export interface ApiDurationClock {
  now(): number;
}

export interface ApiDependencies {
  readonly config: ApplicationConfig;
  readonly logger: AppLogger;
  readonly meter: AppMeter;
  readonly clock?: Clock;
  readonly durationClock?: ApiDurationClock;
  readonly portfolioReader?: PortfolioSnapshotReader;
}

const systemClock: Clock = Object.freeze({
  now: () => createUtcTimestamp(new Date().toISOString()),
});

const systemDurationClock: ApiDurationClock = Object.freeze({
  now: () => performance.now(),
});

type PortfolioResource = 'fills' | 'orders' | 'positions';
type PortfolioRouteResource = PortfolioResource | 'summary';
type PortfolioRouteOutcome =
  'cancelled' | 'failed' | 'invalid_request' | 'succeeded' | 'unavailable';

interface RequestCancellation {
  readonly signal: AbortSignal;
  dispose(): void;
}

function requestCancellation(request: FastifyRequest, reply: FastifyReply): RequestCancellation {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const close = (): void => {
    if (!reply.raw.writableEnded) abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', close);
  if (request.raw.aborted || (reply.raw.destroyed && !reply.raw.writableEnded)) abort();
  return Object.freeze({
    signal: controller.signal,
    dispose: (): void => {
      request.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', close);
    },
  });
}

function portfolioRequestCompletion(
  dependencies: ApiDependencies,
  resource: PortfolioRouteResource,
): (outcome: PortfolioRouteOutcome) => void {
  const clock = dependencies.durationClock ?? systemDurationClock;
  const startedAt = clock.now();
  return (outcome): void => {
    const durationMilliseconds = Math.max(0, clock.now() - startedAt);
    const attributes = { outcome, resource } as const;
    dependencies.meter.addCounter(
      'daily_trader.api.portfolio_requests',
      1,
      attributes,
      'Read-only portfolio API requests by bounded route and outcome.',
    );
    dependencies.meter.recordHistogram(
      'daily_trader.api.portfolio_request_duration',
      durationMilliseconds,
      'ms',
      attributes,
      'Read-only portfolio API request duration by bounded route and outcome.',
    );
  };
}

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
    const cancellation = requestCancellation(request, reply);
    const completeRequest = portfolioRequestCompletion(dependencies, 'summary');
    let outcome: PortfolioRouteOutcome = 'failed';
    void reply.header('cache-control', 'no-store');
    try {
      const reader = dependencies.portfolioReader;
      if (reader === undefined) {
        outcome = 'unavailable';
        dependencies.logger.warn('api.portfolio.unavailable', {
          code: 'PORTFOLIO_REPOSITORY_UNAVAILABLE',
          correlationId: request.id,
        });
        return reply.code(503).send(unavailableResponse());
      }

      try {
        return await withSpan('api.portfolio.read', async () => {
          const snapshot = buildPortfolioApiSnapshot({
            repository: await reader.read(cancellation.signal),
            clock: dependencies.clock ?? systemClock,
            staleAfterMs: dependencies.config.portfolio.operational.staleAfterMs,
          });
          dependencies.logger.info('api.portfolio.read', {
            correlationId: request.id,
            healthState: snapshot.health.state,
            positionCount: snapshot.positions.length,
          });
          outcome = 'succeeded';
          return snapshot;
        });
      } catch {
        if (cancellation.signal.aborted) {
          outcome = 'cancelled';
          dependencies.logger.info('api.portfolio.cancelled', {
            correlationId: request.id,
          });
          return reply.raw.destroyed ? undefined : reply.code(503).send(unavailableResponse());
        }
        outcome = 'failed';
        dependencies.logger.error('api.portfolio.failed', {
          code: 'PORTFOLIO_READ_FAILED',
          correlationId: request.id,
        });
        return reply.code(503).send(unavailableResponse());
      }
    } finally {
      cancellation.dispose();
      completeRequest(outcome);
    }
  });

  const readPortfolioResource = async (
    resource: PortfolioResource,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> => {
    const cancellation = requestCancellation(request, reply);
    const completeRequest = portfolioRequestCompletion(dependencies, resource);
    let outcome: PortfolioRouteOutcome = 'failed';
    void reply.header('cache-control', 'no-store');
    try {
      const pageRequest = parsePortfolioApiPageRequest(request.query);
      if (pageRequest === null) {
        outcome = 'invalid_request';
        dependencies.logger.warn('api.portfolio.page.invalid', {
          code: 'PORTFOLIO_PAGINATION_INVALID',
          correlationId: request.id,
          resource,
        });
        return reply.code(400).send(invalidRequestResponse());
      }
      const reader = dependencies.portfolioReader;
      if (reader === undefined) {
        outcome = 'unavailable';
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
              ? await reader.readPositions(pageRequest, cancellation.signal)
              : resource === 'orders'
                ? await reader.readOrders(pageRequest, cancellation.signal)
                : await reader.readFills(pageRequest, cancellation.signal);
          dependencies.logger.info('api.portfolio.page.read', {
            correlationId: request.id,
            resource,
            returned: page.pagination.returned,
            total: page.pagination.total,
          });
          outcome = 'succeeded';
          return page;
        });
      } catch {
        if (cancellation.signal.aborted) {
          outcome = 'cancelled';
          dependencies.logger.info('api.portfolio.page.cancelled', {
            correlationId: request.id,
            resource,
          });
          return reply.raw.destroyed ? undefined : reply.code(503).send(unavailableResponse());
        }
        outcome = 'failed';
        dependencies.logger.error('api.portfolio.page.failed', {
          code: 'PORTFOLIO_PAGE_READ_FAILED',
          correlationId: request.id,
          resource,
        });
        return reply.code(503).send(unavailableResponse());
      }
    } finally {
      cancellation.dispose();
      completeRequest(outcome);
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
