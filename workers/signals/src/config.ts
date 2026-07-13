import type {
  AppEnvironment,
  ApplicationConfig,
  SignalMode,
  SignalOperationalConfiguration,
} from '@daily-trader/config';
import type { SignalConfiguration } from '@daily-trader/signals';

export interface SignalsWorkerConfig {
  readonly environment: AppEnvironment;
  readonly runtime: ApplicationConfig['runtime'];
  readonly worker: ApplicationConfig['worker'];
  readonly signal: Readonly<{
    mode: SignalMode;
    configuration: SignalConfiguration;
    operational: SignalOperationalConfiguration;
  }>;
  readonly database: Readonly<{
    url: string;
    connectionTimeoutMs: number;
  }>;
}

/** Drops provider, Redis, broker, account, and execution configuration at startup. */
export function projectSignalsWorkerConfig(config: ApplicationConfig): SignalsWorkerConfig {
  return Object.freeze({
    environment: config.environment,
    runtime: config.runtime,
    worker: config.worker,
    signal: Object.freeze({
      mode: config.signal.mode,
      configuration: config.signal.configuration,
      operational: config.signal.operational,
    }),
    database: Object.freeze({
      url: config.services.database.url,
      connectionTimeoutMs: config.services.database.connectionTimeoutMs,
    }),
  });
}
