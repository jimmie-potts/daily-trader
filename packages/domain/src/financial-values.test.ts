import { describe, expect, it } from 'vitest';

import { createMoney, createPrice, createQuantity } from './financial-values.js';
import { createInstrumentId } from './instrument.js';
import { DomainValidationError } from './validation-error.js';

describe('unit-bearing financial values', () => {
  const instrument = createInstrumentId('AAPL', 'XNAS');

  it('keeps money, price, and quantity units explicit in JSON', () => {
    const values = {
      money: createMoney('12345678901234567890.01', 'USD'),
      price: createPrice('210.25', 'USD', instrument),
      quantity: createQuantity('0.125', instrument),
    };

    const serialized: unknown = JSON.parse(JSON.stringify(values));

    expect(serialized).toEqual({
      money: {
        kind: 'money',
        amount: '12345678901234567890.01',
        currency: 'USD',
      },
      price: {
        kind: 'price',
        amount: '210.25',
        currency: 'USD',
        instrument: { symbol: 'AAPL', venue: 'XNAS' },
      },
      quantity: {
        kind: 'quantity',
        amount: '0.125',
        instrument: { symbol: 'AAPL', venue: 'XNAS' },
      },
    });
  });

  it('rejects invalid nested values instead of coercing them', () => {
    expect(() => createMoney(12.5, 'USD')).toThrowError(DomainValidationError);
    expect(() => createPrice('1.0', 'usd', instrument)).toThrowError(DomainValidationError);
    expect(() => createQuantity('1', { symbol: 'aapl', venue: 'XNAS' } as never)).toThrowError(
      DomainValidationError,
    );
  });

  it('freezes constructed values and their validated instrument units', () => {
    const price = createPrice('210.25', 'USD', instrument);

    expect(Object.isFrozen(price)).toBe(true);
    expect(Object.isFrozen(price.instrument)).toBe(true);
  });
});
