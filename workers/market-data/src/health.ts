import type { ApplicationConfig } from '@daily-trader/config';
import type { AppLogger, AppMeter } from '@daily-trader/observability';

export interface WorkerDependencies {
  readonly config: ApplicationConfig;
  readonly logger: AppLogger;
  readonly meter: AppMeter;
}

/** Emits process health only. Market-provider connectivity begins in Phase 2. */
export function emitWorkerHealth(dependencies: WorkerDependencies): void {
  dependencies.meter.recordHealth('healthy');
  dependencies.logger.info('market_data_worker.health', {
    brokerMode: dependencies.config.trading.brokerMode,
    executionEnabled: dependencies.config.trading.executionEnabled,
    marketDataConnection: 'not_configured',
  });
}
