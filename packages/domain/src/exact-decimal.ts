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

function absoluteParts(value: ExactDecimal): readonly [integer: string, fraction: string] {
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const separator = unsigned.indexOf('.');
  return separator === -1
    ? [unsigned, '']
    : [unsigned.slice(0, separator), unsigned.slice(separator + 1)];
}

function compareMagnitude(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  const [leftInteger, leftFraction] = absoluteParts(left);
  const [rightInteger, rightFraction] = absoluteParts(right);

  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length < rightInteger.length ? -1 : 1;
  }
  if (leftInteger !== rightInteger) {
    return leftInteger < rightInteger ? -1 : 1;
  }

  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const comparableLeft = leftFraction.padEnd(fractionLength, '0');
  const comparableRight = rightFraction.padEnd(fractionLength, '0');
  if (comparableLeft === comparableRight) {
    return 0;
  }
  return comparableLeft < comparableRight ? -1 : 1;
}

/**
 * Compares already-validated decimal values by sign and decimal digits only.
 * This deliberately provides no arithmetic, precision, or rounding behavior.
 */
export function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  const leftIsNegative = left.startsWith('-');
  const rightIsNegative = right.startsWith('-');

  if (leftIsNegative !== rightIsNegative) {
    return leftIsNegative ? -1 : 1;
  }

  const magnitude = compareMagnitude(left, right);
  return leftIsNegative ? (magnitude === 0 ? 0 : magnitude === 1 ? -1 : 1) : magnitude;
}

/** True only for exact values greater than zero. */
export function isPositiveExactDecimal(value: ExactDecimal): boolean {
  return value !== '0' && !value.startsWith('-');
}
