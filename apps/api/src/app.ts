import type { ApplicationConfig } from '@daily-trader/config';
import { getSafeConfigDiagnostics } from '@daily-trader/config';
import { type AppLogger, type AppMeter, withSpan } from '@daily-trader/observability';
import Fastify, { type FastifyInstance } from 'fastify';

export interface ApiDependencies {
  readonly config: ApplicationConfig;
  readonly logger: AppLogger;
  readonly meter: AppMeter;
}

export function buildApi(dependencies: ApiDependencies): FastifyInstance {
  const app = Fastify({
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

  return app;
}
