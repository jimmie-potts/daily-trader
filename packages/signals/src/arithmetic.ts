import { createExactDecimal, type ExactDecimal } from '@daily-trader/domain';
import Big from 'big.js';

import { SignalError } from './errors.js';

declare const signalDecimalBrand: unique symbol;

export const SIGNAL_ARITHMETIC_POLICY_VERSION = 'daily-trader.signals.arithmetic.bigjs.v1' as const;
export const SIGNAL_DECIMAL_MAX_PRECISION = 48;
export const SIGNAL_DECIMAL_MAX_SCALE = 18;

/** Canonical decimal text accepted by the bounded Phase 3 arithmetic policy. */
export type SignalDecimal = ExactDecimal & {
  readonly [signalDecimalBrand]: 'SignalDecimal';
};

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

/**
 * Accepts canonical decimal strings only. Values are never coerced from a
 * JavaScript number and no accepted value is rounded.
 */
export function createSignalDecimal(value: unknown): SignalDecimal {
  let exact: ExactDecimal;
  try {
    exact = createExactDecimal(value);
  } catch {
    throw new SignalError('decimal_invalid');
  }
  const { precision, scale } = decimalShape(exact);
  if (precision > SIGNAL_DECIMAL_MAX_PRECISION || scale > SIGNAL_DECIMAL_MAX_SCALE) {
    throw new SignalError('decimal_invalid');
  }
  return exact as SignalDecimal;
}

function big(value: SignalDecimal): Big {
  return new Big(value);
}

function canonicalResult(value: Big): SignalDecimal {
  const fixed = value.toFixed();
  const canonical = fixed === '-0' ? '0' : fixed;
  try {
    return createSignalDecimal(canonical);
  } catch {
    throw new SignalError('arithmetic_overflow');
  }
}

export function compareSignalDecimals(left: SignalDecimal, right: SignalDecimal): -1 | 0 | 1 {
  const comparison = big(left).cmp(big(right));
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0;
}

export function addSignalDecimals(values: readonly SignalDecimal[]): SignalDecimal {
  if (values.length === 0) {
    throw new SignalError('invariant_violation');
  }
  let total = new Big('0');
  for (const value of values) {
    total = total.plus(big(value));
  }
  return canonicalResult(total);
}

export function multiplySignalDecimals(left: SignalDecimal, right: SignalDecimal): SignalDecimal {
  return canonicalResult(big(left).times(big(right)));
}

export function multiplySignalDecimalByCount(value: SignalDecimal, count: number): SignalDecimal {
  if (!Number.isSafeInteger(count) || count < 1 || count > 390) {
    throw new SignalError('invariant_violation');
  }
  return canonicalResult(big(value).times(String(count)));
}
