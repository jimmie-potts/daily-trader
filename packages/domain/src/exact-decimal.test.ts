import { describe, expect, it } from 'vitest';

import { createExactDecimal } from './exact-decimal.js';
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
