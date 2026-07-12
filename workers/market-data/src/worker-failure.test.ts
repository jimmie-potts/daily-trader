import { MarketDataAdapterError } from '@daily-trader/market-data';
import { describe, expect, it } from 'vitest';

import { RedisDeliveryError } from './delivery/redis-stream.js';
import { MarketDataPersistenceError } from './persistence/index.js';
import { safeWorkerFailure } from './worker-failure.js';

describe('safeWorkerFailure', () => {
  it('preserves safe provider classifications without exposing failure messages', () => {
    const failure = safeWorkerFailure(
      new MarketDataAdapterError('authentication', 'AUTH_REJECTED', 'recognizable-provider-secret'),
    );

    expect(failure).toEqual({
      boundary: 'provider',
      classification: 'authentication',
      code: 'AUTH_REJECTED',
      event: 'market_data_worker.failed',
    });
    expect(JSON.stringify(failure)).not.toContain('recognizable-provider-secret');
  });

  it('surfaces Redis and PostgreSQL failure codes at their boundaries', () => {
    expect(safeWorkerFailure(new RedisDeliveryError('retention_gap'))).toEqual({
      boundary: 'redis',
      code: 'retention_gap',
      event: 'market_data_worker.failed',
    });
    expect(safeWorkerFailure(new MarketDataPersistenceError('rollback_failed'))).toEqual({
      boundary: 'postgres',
      code: 'rollback_failed',
      event: 'market_data_worker.failed',
    });
  });

  it('uses bounded generic output for untrusted and malformed errors', () => {
    const generic = safeWorkerFailure(new Error('recognizable-runtime-secret'));
    const malformedProvider = safeWorkerFailure(
      new MarketDataAdapterError(
        'contract',
        'recognizable-provider-secret',
        'recognizable-provider-message',
      ),
    );

    expect(generic).toEqual({
      boundary: 'runtime',
      code: 'MARKET_DATA_WORKER_FAILED',
      event: 'market_data_worker.failed',
    });
    expect(malformedProvider.code).toBe('UNCLASSIFIED_PROVIDER_FAILURE');
    expect(JSON.stringify([generic, malformedProvider])).not.toContain('recognizable');
  });
});
