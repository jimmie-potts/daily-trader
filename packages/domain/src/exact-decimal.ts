import { DomainValidationError, requireString } from './validation-error.js';

declare const exactDecimalBrand: unique symbol;

/**
 * Canonical base-10 text whose digits have never passed through a JavaScript
 * floating-point number.
 *
 * This type is a storage and transport representation only. It intentionally
 * exposes no arithmetic or rounding behavior.
 */
export type ExactDecimal = string & {
  readonly [exactDecimalBrand]: 'ExactDecimal';
};

const CANONICAL_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;

/**
 * Validates an already-canonical decimal string without coercion or rounding.
 * Non-canonical equivalents such as `01`, `1.0`, and `-0` are rejected.
 */
export function createExactDecimal(value: unknown): ExactDecimal {
  const candidate = requireString(value, 'exactDecimal');

  if (!CANONICAL_DECIMAL.test(candidate) || candidate === '-0') {
    throw new DomainValidationError(
      'exactDecimal',
      'must be canonical base-10 text without whitespace, exponent notation, leading zeroes, or trailing fractional zeroes',
    );
  }

  return candidate as ExactDecimal;
}
