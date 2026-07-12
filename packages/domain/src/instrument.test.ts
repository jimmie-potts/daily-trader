import { describe, expect, it } from 'vitest';

import { createCurrencyCode } from './currency.js';
import { createInstrumentId, instrumentKey } from './instrument.js';
import { DomainValidationError } from './validation-error.js';

describe('instrument identity', () => {
  it('constructs a frozen, provider-independent identity', () => {
    const instrument = createInstrumentId('BRK.B', 'XNYS');

    expect(instrument).toEqual({ symbol: 'BRK.B', venue: 'XNYS' });
    expect(instrumentKey(instrument)).toBe('XNYS:BRK.B');
    expect(Object.isFrozen(instrument)).toBe(true);
  });

  it.each([
    ['aapl', 'XNAS'],
    ['AAPL', 'xnas'],
    ['AAPL ', 'XNAS'],
    ['AAPL', 'NASDAQ'],
    ['', 'XNAS'],
  ])('rejects invalid symbol/venue input %s/%s', (symbol, venue) => {
    expect(() => createInstrumentId(symbol, venue)).toThrowError(DomainValidationError);
  });

  it('can be explicitly revalidated after JSON deserialization', () => {
    const original = createInstrumentId('AAPL', 'XNAS');
    const decoded: unknown = JSON.parse(JSON.stringify(original));
    if (typeof decoded !== 'object' || decoded === null) {
      throw new TypeError('expected the serialized instrument to be an object');
    }
    const decodedRecord = decoded as Record<string, unknown>;

    expect(createInstrumentId(decodedRecord.symbol, decodedRecord.venue)).toEqual(original);
  });
});

describe('currency codes', () => {
  it.each(['USD', 'EUR', 'ZZZ'])('accepts uppercase lexical form: %s', (code) => {
    expect(createCurrencyCode(code)).toBe(code);
  });

  it.each(['usd', 'US', 'USDD', ' USD', 'U1D'])('rejects invalid lexical form: %s', (code) => {
    expect(() => createCurrencyCode(code)).toThrowError(DomainValidationError);
  });
});
