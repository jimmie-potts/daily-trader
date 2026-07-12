import {
  createExactDecimal,
  createInstrumentId,
  createMoney,
  createPrice,
  createQuantity,
  createUtcTimestamp,
  FixedClock,
  type ExactDecimal,
  type InstrumentId,
  type Money,
  type Price,
  type Quantity,
  type UtcTimestamp,
} from '@daily-trader/domain';

/** Readable exact-decimal fixture that uses production validation. */
export function decimalFixture(value: string): ExactDecimal {
  return createExactDecimal(value);
}

/** Explicit timestamp fixture; there is deliberately no implicit "now". */
export function timestampFixture(value: string): UtcTimestamp {
  return createUtcTimestamp(value);
}

/** A fresh immutable clock for the supplied fixture timestamp. */
export function fixedClockFixture(value: string): FixedClock {
  return new FixedClock(timestampFixture(value));
}

/** Readable instrument fixture that uses production validation. */
export function instrumentFixture(symbol: string, venue: string): InstrumentId {
  return createInstrumentId(symbol, venue);
}

export function moneyFixture(amount: string, currency: string): Money {
  return createMoney(amount, currency);
}

export function priceFixture(amount: string, currency: string, instrument: InstrumentId): Price {
  return createPrice(amount, currency, instrument);
}

export function quantityFixture(amount: string, instrument: InstrumentId): Quantity {
  return createQuantity(amount, instrument);
}

/**
 * Pure deterministic identifier helper. Callers supply the sequence explicitly
 * so test order and process-global counters cannot affect the result.
 */
export function deterministicId(namespace: string, sequence: number): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(namespace)) {
    throw new TypeError(
      'namespace must start with a lowercase letter and contain only lowercase letters, digits, or hyphens',
    );
  }

  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new TypeError('sequence must be a non-negative safe integer');
  }

  return `${namespace}-${sequence.toString().padStart(4, '0')}`;
}
