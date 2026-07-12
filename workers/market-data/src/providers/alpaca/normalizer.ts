import { createUtcTimestamp, type Clock } from '@daily-trader/domain';
import {
  createOneMinuteBarEvent,
  instrumentForSymbol,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';

import type { ReceivedAlpacaBar } from './types.js';

/** Converts one validated provider bar into the application-owned exact event. */
export function normalizeAlpacaBar(bar: ReceivedAlpacaBar, clock: Clock): OneMinuteBarEvent {
  const instrument = instrumentForSymbol(bar.symbol);
  return createOneMinuteBarEvent({
    symbol: instrument.symbol,
    venue: instrument.venue,
    providerTimestamp: bar.providerTimestamp,
    receivedAt: createUtcTimestamp(bar.receivedAt),
    processedAt: createUtcTimestamp(clock.now()),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  });
}
