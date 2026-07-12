import type { ApplicationConfig } from '@daily-trader/config';
import type { AppLogger, AppMeter } from '@daily-trader/observability';

export interface WorkerDependencies {
  readonly config: ApplicationConfig;
  readonly logger: AppLogger;
  readonly meter: AppMeter;
}

/** Emits process health without implying that transport connectivity means fresh data. */
export function emitWorkerHealth(dependencies: WorkerDependencies): void {
  dependencies.meter.recordHealth('healthy');
  dependencies.logger.info('market_data_worker.health', {
    brokerMode: dependencies.config.trading.brokerMode,
    executionEnabled: dependencies.config.trading.executionEnabled,
    marketDataMode: dependencies.config.marketData.mode,
    marketDataConnection:
      dependencies.config.marketData.mode === 'disabled' ? 'disabled' : 'not_started',
    provider: dependencies.config.marketData.provider,
    feed: dependencies.config.marketData.feed,
  });
}
