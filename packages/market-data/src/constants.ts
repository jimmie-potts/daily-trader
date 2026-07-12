import { createInstrumentId, type InstrumentId } from '@daily-trader/domain';

import { MarketDataValidationError, requireString } from './validation.js';

export const MARKET_DATA_SCHEMA_VERSION = 'daily-trader.market-data.one-minute-bar.v1' as const;
export const ONE_MINUTE_INTERVAL = '1m' as const;
export const MARKET_DATA_PROVIDER = 'alpaca' as const;
export const MARKET_DATA_FEED = 'iex' as const;
export const MARKET_DATA_SOURCE_IDENTIFIER = 'alpaca:iex:bars' as const;
export const MARKET_DATA_ENTITLEMENT = 'real_time' as const;
export const MARKET_DATA_DELAY_MILLISECONDS = 0 as const;
export const MARKET_DATA_CURRENCY = 'USD' as const;
export const MARKET_DATA_PRICE_UNIT = 'USD/share' as const;
export const MARKET_DATA_VOLUME_UNIT = 'share' as const;
export const FRESHNESS_THRESHOLD_MS = 120_000 as const;

export type SupportedMarketDataSymbol = 'AAPL' | 'SPY';

export const PHASE_2_INSTRUMENTS: Readonly<Record<SupportedMarketDataSymbol, InstrumentId>> =
  Object.freeze({
    AAPL: createInstrumentId('AAPL', 'XNAS'),
    SPY: createInstrumentId('SPY', 'ARCX'),
  });

export const PHASE_2_SYMBOLS: readonly SupportedMarketDataSymbol[] = Object.freeze(['AAPL', 'SPY']);

export function instrumentForSymbol(value: unknown): InstrumentId {
  const symbol = requireString(value, 'instrument.symbol');
  if (symbol !== 'AAPL' && symbol !== 'SPY') {
    throw new MarketDataValidationError('instrument.symbol', 'must be AAPL or SPY');
  }
  return PHASE_2_INSTRUMENTS[symbol];
}

export function validatePhase2Instrument(symbol: unknown, venue: unknown): InstrumentId {
  const instrument = instrumentForSymbol(symbol);
  const venueText = requireString(venue, 'instrument.venue');
  if (venueText !== instrument.venue) {
    throw new MarketDataValidationError(
      'instrument.venue',
      `must be ${instrument.venue} for ${instrument.symbol}`,
    );
  }
  return instrument;
}
