import type { RedisEntryHandler, RedisMarketDataEntry } from '../delivery/redis-stream.js';
import type { MarketDataRepository, PersistMarketDataResult } from './repository.js';

export interface MarketDataEntryPersistence {
  persistEntry(entry: {
    readonly sessionId: string;
    readonly eventId: string;
    readonly orderingKey: string;
    readonly schemaVersion: string;
    readonly eventJson: string;
  }): Promise<PersistMarketDataResult>;
}

/**
 * Adapts a decoded Redis entry to durable persistence. Redis acknowledgement
 * remains the consumer's responsibility and occurs only after this resolves.
 */
export function createRedisPersistenceHandler(
  repository: Pick<MarketDataRepository, 'persistEntry'> | MarketDataEntryPersistence,
): RedisEntryHandler {
  return async (entry: RedisMarketDataEntry): Promise<void> => {
    await repository.persistEntry({
      sessionId: entry.sessionId,
      eventId: entry.eventId,
      orderingKey: entry.orderingKey,
      schemaVersion: entry.schemaVersion,
      eventJson: entry.eventJson,
    });
  };
}
