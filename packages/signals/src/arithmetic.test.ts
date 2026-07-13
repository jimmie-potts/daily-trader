import { describe, expect, it } from 'vitest';

import {
  SIGNAL_DECIMAL_MAX_PRECISION,
  SIGNAL_DECIMAL_MAX_SCALE,
  addSignalDecimals,
  compareSignalDecimals,
  createSignalDecimal,
  multiplySignalDecimalByCount,
  multiplySignalDecimals,
} from './arithmetic.js';
import { SignalError } from './errors.js';

describe('bounded signal decimal arithmetic', () => {
  it('accepts canonical strings and rejects numbers or noncanonical text', () => {
    expect(createSignalDecimal('123.456')).toBe('123.456');
    for (const invalid of [123.456, '1.0', '01', '-0', '1e3', ' 1', '', null]) {
      expect(() => createSignalDecimal(invalid)).toThrowError(new SignalError('decimal_invalid'));
    }
  });

  it('enforces precision and scale bounds without rounding', () => {
    expect(SIGNAL_DECIMAL_MAX_PRECISION).toBe(48);
    expect(SIGNAL_DECIMAL_MAX_SCALE).toBe(18);
    expect(createSignalDecimal('9'.repeat(48))).toBe('9'.repeat(48));
    expect(createSignalDecimal(`0.${'0'.repeat(17)}1`)).toBe(`0.${'0'.repeat(17)}1`);
    expect(() => createSignalDecimal('9'.repeat(49))).toThrowError(
      new SignalError('decimal_invalid'),
    );
    expect(() => createSignalDecimal(`0.${'0'.repeat(18)}1`)).toThrowError(
      new SignalError('decimal_invalid'),
    );
  });

  it('adds, multiplies, and compares fractional strings exactly', () => {
    const oneTenth = createSignalDecimal('0.1');
    const twoTenths = createSignalDecimal('0.2');
    expect(addSignalDecimals([oneTenth, twoTenths])).toBe('0.3');
    expect(multiplySignalDecimals(createSignalDecimal('1.25'), createSignalDecimal('2.4'))).toBe(
      '3',
    );
    expect(multiplySignalDecimalByCount(createSignalDecimal('0.1'), 3)).toBe('0.3');
    expect(
      compareSignalDecimals(
        createSignalDecimal('9007199254740993'),
        createSignalDecimal('9007199254740992'),
      ),
    ).toBe(1);
  });

  it('rejects overflowing exact results rather than rounding them', () => {
    expect(() =>
      addSignalDecimals([createSignalDecimal('9'.repeat(48)), createSignalDecimal('1')]),
    ).toThrowError(new SignalError('arithmetic_overflow'));
    expect(() =>
      multiplySignalDecimals(
        createSignalDecimal('9'.repeat(30)),
        createSignalDecimal('9'.repeat(30)),
      ),
    ).toThrowError(new SignalError('arithmetic_overflow'));
  });

  it('requires a bounded nonempty operation', () => {
    expect(() => addSignalDecimals([])).toThrowError(new SignalError('invariant_violation'));
    expect(() => multiplySignalDecimalByCount(createSignalDecimal('1'), 0)).toThrowError(
      new SignalError('invariant_violation'),
    );
    expect(() => multiplySignalDecimalByCount(createSignalDecimal('1'), 391)).toThrowError(
      new SignalError('invariant_violation'),
    );
  });
});
