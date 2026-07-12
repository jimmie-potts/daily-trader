import { createExactDecimal, type ExactDecimal } from '@daily-trader/domain';

import { MarketDataValidationError, requireString } from './validation.js';

const PLAIN_DECIMAL_LEXEME = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

/** Canonicalizes an already captured JSON numeric lexeme without numeric coercion. */
export function canonicalizeDecimalLexeme(value: unknown, field = 'numericLexeme'): ExactDecimal {
  const lexeme = requireString(value, field);
  if (!PLAIN_DECIMAL_LEXEME.test(lexeme)) {
    throw new MarketDataValidationError(
      field,
      'must be plain base-10 text without whitespace, exponent notation, or leading zeroes',
    );
  }

  const negative = lexeme.startsWith('-');
  const unsigned = negative ? lexeme.slice(1) : lexeme;
  const [integer, fraction] = unsigned.split('.');
  if (integer === undefined) {
    throw new MarketDataValidationError(field, 'must contain an integer component');
  }
  const trimmedFraction = fraction?.replace(/0+$/u, '') ?? '';
  const magnitude = trimmedFraction.length === 0 ? integer : `${integer}.${trimmedFraction}`;
  const canonical = magnitude === '0' ? '0' : negative ? `-${magnitude}` : magnitude;

  return createExactDecimal(canonical);
}
