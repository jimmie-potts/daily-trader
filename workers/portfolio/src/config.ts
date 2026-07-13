import type { ApplicationConfig, PortfolioRuntimeConfiguration } from '@daily-trader/config';

export interface PortfolioWorkerConfig {
  readonly environment: ApplicationConfig['environment'];
  readonly runtime: ApplicationConfig['runtime'];
  readonly database: ApplicationConfig['services']['database'];
  readonly portfolio: PortfolioRuntimeConfiguration;
  readonly trading: ApplicationConfig['trading'];
}

/** Drops market-data, signal, Redis, and live-provider configuration before orchestration. */
export function projectPortfolioWorkerConfig(config: ApplicationConfig): PortfolioWorkerConfig {
  return Object.freeze({
    environment: config.environment,
    runtime: config.runtime,
    database: config.services.database,
    portfolio: config.portfolio,
    trading: config.trading,
  });
}
