import { describe, expect, it } from 'vitest';

import {
  compareExactDecimals,
  createExactDecimal,
  isPositiveExactDecimal,
} from './exact-decimal.js';
import { DomainValidationError } from './validation-error.js';

describe('createExactDecimal', () => {
  it.each(['0', '12', '-12', '0.00000001', '-0.5', '90071992547409931234567890.123456789'])(
    'preserves canonical exact text: %s',
    (value) => {
      expect(createExactDecimal(value)).toBe(value);
    },
  );

  it.each([
    '',
    ' 1',
    '1 ',
    '+1',
    '01',
    '-0',
    '1.',
    '.5',
    '1.0',
    '1.2300',
    '1e3',
    'NaN',
    'Infinity',
  ])('rejects invalid or non-canonical text: %s', (value) => {
    expect(() => createExactDecimal(value)).toThrowError(DomainValidationError);
  });

  it('rejects JavaScript numbers at the runtime boundary', () => {
    expect(() => createExactDecimal(0.1)).toThrowError(DomainValidationError);
  });

  it('serializes as the original JSON string without precision loss', () => {
    const value = createExactDecimal('90071992547409931234567890.123456789');

    expect(JSON.stringify(value)).toBe('"90071992547409931234567890.123456789"');
  });
});

describe('exact decimal comparison', () => {
  it.each([
    ['0', '0', 0],
    ['2', '10', -1],
    ['10', '2', 1],
    ['1.2', '1.19', 1],
    ['1.0000000000000000001', '1', 1],
    ['-2', '-10', 1],
    ['-10.5', '-10.05', -1],
    ['-0.0001', '0', -1],
  ] as const)('compares %s to %s without numeric conversion', (left, right, expected) => {
    expect(compareExactDecimals(createExactDecimal(left), createExactDecimal(right))).toBe(
      expected,
    );
  });

  it('classifies strict positivity', () => {
    expect(isPositiveExactDecimal(createExactDecimal('0.0001'))).toBe(true);
    expect(isPositiveExactDecimal(createExactDecimal('0'))).toBe(false);
    expect(isPositiveExactDecimal(createExactDecimal('-0.0001'))).toBe(false);
  });
});
