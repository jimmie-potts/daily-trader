import { DomainValidationError, requireString } from './validation-error.js';

declare const instrumentSymbolBrand: unique symbol;
declare const venueCodeBrand: unique symbol;

/** A canonical, provider-independent instrument symbol. */
export type InstrumentSymbol = string & {
  readonly [instrumentSymbolBrand]: 'InstrumentSymbol';
};

/** A four-character uppercase venue code, suitable for ISO 10383 MICs. */
export type VenueCode = string & {
  readonly [venueCodeBrand]: 'VenueCode';
};

/**
 * Application-owned instrument identity. The venue prevents the symbol alone
 * from being treated as globally unique.
 */
export interface InstrumentId {
  readonly symbol: InstrumentSymbol;
  readonly venue: VenueCode;
}

const SYMBOL = /^(?=.{1,20}$)[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/u;
const VENUE = /^[A-Z0-9]{4}$/u;

export function createInstrumentId(symbol: unknown, venue: unknown): InstrumentId {
  const symbolCandidate = requireString(symbol, 'instrument.symbol');
  const venueCandidate = requireString(venue, 'instrument.venue');

  if (!SYMBOL.test(symbolCandidate)) {
    throw new DomainValidationError(
      'instrument.symbol',
      'must be 1-20 uppercase letters or digits with single dot or hyphen separators',
    );
  }

  if (!VENUE.test(venueCandidate)) {
    throw new DomainValidationError(
      'instrument.venue',
      'must contain exactly four uppercase ASCII letters or digits',
    );
  }

  return Object.freeze({
    symbol: symbolCandidate as InstrumentSymbol,
    venue: venueCandidate as VenueCode,
  });
}

/** Stable text for logs, map keys, and serialized references. */
export function instrumentKey(instrument: InstrumentId): string {
  return `${instrument.venue}:${instrument.symbol}`;
}
