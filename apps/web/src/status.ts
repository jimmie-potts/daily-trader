import type { ApplicationConfig } from '@daily-trader/config';

export interface FoundationStatus {
  readonly brokerMode: 'paper';
  readonly environment: ApplicationConfig['environment'];
  readonly execution: 'disabled';
  readonly marketData: 'not connected';
}

export function getFoundationStatus(config: ApplicationConfig): FoundationStatus {
  return Object.freeze({
    brokerMode: config.trading.brokerMode,
    environment: config.environment,
    execution: 'disabled',
    marketData: 'not connected',
  });
}
