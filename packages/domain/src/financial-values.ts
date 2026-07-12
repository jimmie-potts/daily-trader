import { createCurrencyCode, type CurrencyCode } from './currency.js';
import { createExactDecimal, type ExactDecimal } from './exact-decimal.js';
import { createInstrumentId, type InstrumentId } from './instrument.js';
import { DomainValidationError } from './validation-error.js';

/** An exact amount denominated in a currency. */
export interface Money {
  readonly kind: 'money';
  readonly amount: ExactDecimal;
  readonly currency: CurrencyCode;
}

/** An exact currency amount per unit of an identified instrument. */
export interface Price {
  readonly kind: 'price';
  readonly amount: ExactDecimal;
  readonly currency: CurrencyCode;
  readonly instrument: InstrumentId;
}

/** An exact number of units of an identified instrument. */
export interface Quantity {
  readonly kind: 'quantity';
  readonly amount: ExactDecimal;
  readonly instrument: InstrumentId;
}

/**
 * Creates money without rounding. Negative and zero amounts remain valid
 * because constraints depend on the later business context.
 */
export function createMoney(amount: unknown, currency: unknown): Money {
  return Object.freeze({
    kind: 'money',
    amount: createExactDecimal(amount),
    currency: createCurrencyCode(currency),
  });
}

/**
 * Creates a price without rounding or positivity assumptions. The instrument
 * makes the `currency per unit` denominator explicit.
 */
export function createPrice(amount: unknown, currency: unknown, instrument: InstrumentId): Price {
  return Object.freeze({
    kind: 'price',
    amount: createExactDecimal(amount),
    currency: createCurrencyCode(currency),
    instrument: validatedInstrument(instrument),
  });
}

/** Creates an instrument quantity without rounding or sign assumptions. */
export function createQuantity(amount: unknown, instrument: InstrumentId): Quantity {
  return Object.freeze({
    kind: 'quantity',
    amount: createExactDecimal(amount),
    instrument: validatedInstrument(instrument),
  });
}

function validatedInstrument(instrument: unknown): InstrumentId {
  if (typeof instrument !== 'object' || instrument === null) {
    throw new DomainValidationError(
      'instrument',
      'must be an object containing a symbol and venue',
    );
  }

  const candidate = instrument as Record<string, unknown>;
  return createInstrumentId(candidate.symbol, candidate.venue);
}
