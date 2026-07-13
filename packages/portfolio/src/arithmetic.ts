import { createExactDecimal, type ExactDecimal } from '@daily-trader/domain';
import Big from 'big.js';

import { PortfolioError } from './errors.js';

declare const portfolioDecimalBrand: unique symbol;

export const PORTFOLIO_ARITHMETIC_POLICY_VERSION =
  'daily-trader.portfolio.arithmetic.bigjs.v1' as const;
export const PORTFOLIO_DECIMAL_MAX_PRECISION = 48;
export const PORTFOLIO_DECIMAL_MAX_SCALE = 18;
export const PORTFOLIO_PERCENTAGE_MAX_SCALE = 6;

export type PortfolioDecimal = ExactDecimal & {
  readonly [portfolioDecimalBrand]: 'PortfolioDecimal';
};

const PROVIDER_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

const Decimal = Big();
Decimal.DP = PORTFOLIO_PERCENTAGE_MAX_SCALE;
Decimal.RM = Decimal.roundHalfEven;

function decimalShape(value: ExactDecimal): { readonly precision: number; readonly scale: number } {
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer = '', fraction = ''] = unsigned.split('.');
  const significantInteger = integer.replace(/^0+/u, '');
  const precision =
    significantInteger.length > 0
      ? significantInteger.length + fraction.length
      : fraction.replace(/^0+/u, '').length;
  return Object.freeze({ precision: Math.max(precision, 1), scale: fraction.length });
}

/** Accepts bounded canonical decimal strings only; primitive numbers are rejected. */
export function createPortfolioDecimal(value: unknown): PortfolioDecimal {
  let exact: ExactDecimal;
  try {
    exact = createExactDecimal(value);
  } catch {
    throw new PortfolioError('decimal_invalid');
  }
  const shape = decimalShape(exact);
  if (
    shape.precision > PORTFOLIO_DECIMAL_MAX_PRECISION ||
    shape.scale > PORTFOLIO_DECIMAL_MAX_SCALE
  ) {
    throw new PortfolioError('decimal_invalid');
  }
  return exact as PortfolioDecimal;
}

/**
 * Canonicalizes an exact provider string without passing its digits through a
 * JavaScript number. Exponents, whitespace, leading zeroes, and signs on
 * positive values remain invalid.
 */
export function normalizePortfolioDecimalLexeme(value: unknown): PortfolioDecimal {
  if (typeof value !== 'string' || !PROVIDER_DECIMAL.test(value)) {
    throw new PortfolioError('decimal_invalid');
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer = '', fraction = ''] = unsigned.split('.');
  const trimmedFraction = fraction.replace(/0+$/u, '');
  const magnitude = trimmedFraction.length === 0 ? integer : `${integer}.${trimmedFraction}`;
  return createPortfolioDecimal(negative && magnitude !== '0' ? `-${magnitude}` : magnitude);
}

function decimal(value: PortfolioDecimal): Big {
  return new Decimal(value);
}

function canonicalResult(value: Big): PortfolioDecimal {
  const fixed = value.toFixed();
  const canonical = fixed === '-0' ? '0' : fixed;
  try {
    return createPortfolioDecimal(canonical);
  } catch {
    throw new PortfolioError('arithmetic_overflow');
  }
}

export function comparePortfolioDecimals(
  left: PortfolioDecimal,
  right: PortfolioDecimal,
): -1 | 0 | 1 {
  const comparison = decimal(left).cmp(decimal(right));
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0;
}

/** An empty financial sum is the exact additive identity. */
export function addPortfolioDecimals(values: readonly PortfolioDecimal[]): PortfolioDecimal {
  let total = new Decimal('0');
  for (const value of values) total = total.plus(decimal(value));
  return canonicalResult(total);
}

export function subtractPortfolioDecimals(
  left: PortfolioDecimal,
  right: PortfolioDecimal,
): PortfolioDecimal {
  return canonicalResult(decimal(left).minus(decimal(right)));
}

export function absolutePortfolioDecimal(value: PortfolioDecimal): PortfolioDecimal {
  return canonicalResult(decimal(value).abs());
}

/**
 * Returns `numerator / positiveDenominator * 100`, rounded once using half-even
 * to at most six fractional digits.
 */
export function portfolioPercentage(
  numerator: PortfolioDecimal,
  positiveDenominator: PortfolioDecimal,
): PortfolioDecimal {
  if (decimal(positiveDenominator).lte(0)) throw new PortfolioError('division_by_zero');
  return canonicalResult(decimal(numerator).times('100').div(decimal(positiveDenominator)));
}
