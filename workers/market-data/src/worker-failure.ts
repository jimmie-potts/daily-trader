import { MarketDataAdapterError } from '@daily-trader/market-data';

import { RedisDeliveryError } from './delivery/redis-stream.js';
import { MarketDataPersistenceError } from './persistence/index.js';

const SAFE_CODE = /^(?:[A-Z][A-Z0-9_]{0,63}|[a-z][a-z0-9_]{0,63})$/u;

export interface SafeWorkerFailure {
  readonly event: 'market_data_worker.failed';
  readonly boundary: 'postgres' | 'provider' | 'redis' | 'runtime';
  readonly code: string;
  readonly classification?: string;
}

function safeCode(value: string, fallback: string): string {
  return SAFE_CODE.test(value) ? value : fallback;
}

/** Maps failures to bounded application-owned fields without exposing messages or payloads. */
export function safeWorkerFailure(error: unknown): SafeWorkerFailure {
  if (error instanceof MarketDataAdapterError) {
    return Object.freeze({
      boundary: 'provider',
      classification: error.classification,
      code: safeCode(error.code, 'UNCLASSIFIED_PROVIDER_FAILURE'),
      event: 'market_data_worker.failed',
    });
  }
  if (error instanceof RedisDeliveryError) {
    return Object.freeze({
      boundary: 'redis',
      code: safeCode(error.code, 'unclassified_delivery_failure'),
      event: 'market_data_worker.failed',
    });
  }
  if (error instanceof MarketDataPersistenceError) {
    return Object.freeze({
      boundary: 'postgres',
      code: safeCode(error.code, 'unclassified_persistence_failure'),
      event: 'market_data_worker.failed',
    });
  }
  return Object.freeze({
    boundary: 'runtime',
    code: 'MARKET_DATA_WORKER_FAILED',
    event: 'market_data_worker.failed',
  });
}
