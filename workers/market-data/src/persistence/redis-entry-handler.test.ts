import {
  MARKET_DATA_SCHEMA_VERSION,
  createOneMinuteBarEvent,
  serializeOneMinuteBarEvent,
} from '@daily-trader/market-data';
import { describe, expect, it, vi } from 'vitest';

import { parseRedisMarketDataEntry } from '../delivery/redis-stream.js';
import { createRedisPersistenceHandler } from './redis-entry-handler.js';

describe('createRedisPersistenceHandler', () => {
  it('forwards the canonical entry to persistence without acknowledging Redis itself', async () => {
    const event = createOneMinuteBarEvent({
      symbol: 'AAPL',
      venue: 'XNAS',
      providerTimestamp: '2026-07-13T13:30:00Z',
      receivedAt: '2026-07-13T13:31:00.100Z',
      processedAt: '2026-07-13T13:31:00.200Z',
      open: '100',
      high: '102',
      low: '99',
      close: '101',
      volume: '1000',
    });
    const eventJson = serializeOneMinuteBarEvent(event);
    const redisEntry = parseRedisMarketDataEntry([
      '101-0',
      [
        'schema_version',
        MARKET_DATA_SCHEMA_VERSION,
        'session_id',
        'fixture-2026-07-13',
        'event_id',
        event.eventId,
        'ordering_key',
        event.orderingKey,
        'event_json',
        eventJson,
      ],
    ]);
    const persistEntry = vi.fn().mockResolvedValue({});

    await createRedisPersistenceHandler({ persistEntry })(redisEntry);

    expect(persistEntry).toHaveBeenCalledOnce();
    expect(persistEntry).toHaveBeenCalledWith({
      sessionId: 'fixture-2026-07-13',
      eventId: event.eventId,
      orderingKey: event.orderingKey,
      schemaVersion: MARKET_DATA_SCHEMA_VERSION,
      eventJson,
    });
  });
});
