import { describe, expect, it } from 'vitest';

import {
  PORTFOLIO_DECIMAL_MAX_PRECISION,
  PORTFOLIO_DECIMAL_MAX_SCALE,
  PORTFOLIO_PERCENTAGE_MAX_SCALE,
  absolutePortfolioDecimal,
  addPortfolioDecimals,
  comparePortfolioDecimals,
  createPortfolioDecimal,
  normalizePortfolioDecimalLexeme,
  portfolioPercentage,
  subtractPortfolioDecimals,
  type PortfolioDecimal,
} from './arithmetic.js';
import { PortfolioError, type PortfolioErrorCode } from './errors.js';

function decimal(value: string): PortfolioDecimal {
  return createPortfolioDecimal(value);
}

function expectPortfolioError(operation: () => unknown, code: PortfolioErrorCode): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(PortfolioError);
  expect(thrown).toMatchObject({ code });
}

describe('createPortfolioDecimal', () => {
  it.each([
    '0',
    '12',
    '-12',
    '0.000000000000000001',
    '-0.5',
    '90071992547409931234567890.123456789',
    '9'.repeat(PORTFOLIO_DECIMAL_MAX_PRECISION),
    `${'9'.repeat(30)}.${'9'.repeat(18)}`,
  ])('preserves bounded canonical exact text: %s', (value) => {
    expect(createPortfolioDecimal(value)).toBe(value);
  });

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
    expectPortfolioError(() => createPortfolioDecimal(value), 'decimal_invalid');
  });

  it.each([0, 0.1, Number.MAX_SAFE_INTEGER, null, undefined, true, {}, []])(
    'rejects non-string input without numeric coercion: %s',
    (value) => {
      expectPortfolioError(() => createPortfolioDecimal(value), 'decimal_invalid');
    },
  );

  it('enforces the 48-digit precision boundary', () => {
    expect(createPortfolioDecimal('9'.repeat(48))).toBe('9'.repeat(48));
    expectPortfolioError(() => createPortfolioDecimal('9'.repeat(49)), 'decimal_invalid');
    expectPortfolioError(
      () => createPortfolioDecimal(`${'9'.repeat(31)}.${'9'.repeat(18)}`),
      'decimal_invalid',
    );
  });

  it('enforces the 18-place scale boundary independently of leading fractional zeroes', () => {
    expect(createPortfolioDecimal(`0.${'0'.repeat(17)}1`)).toBe(`0.${'0'.repeat(17)}1`);
    expectPortfolioError(
      () => createPortfolioDecimal(`0.${'0'.repeat(PORTFOLIO_DECIMAL_MAX_SCALE)}1`),
      'decimal_invalid',
    );
  });
});

describe('normalizePortfolioDecimalLexeme', () => {
  it.each([
    ['0', '0'],
    ['-0', '0'],
    ['0.000', '0'],
    ['-0.000', '0'],
    ['210.2500', '210.25'],
    ['-12.34000', '-12.34'],
    ['90071992547409931234567890.123456789000', '90071992547409931234567890.123456789'],
  ])('canonicalizes provider lexeme %s to %s without number conversion', (input, expected) => {
    expect(normalizePortfolioDecimalLexeme(input)).toBe(expected);
  });

  it('applies precision and canonical scale limits after trimming insignificant zeroes', () => {
    expect(normalizePortfolioDecimalLexeme(`0.${'0'.repeat(30)}`)).toBe('0');
    expect(normalizePortfolioDecimalLexeme(`1.${'0'.repeat(30)}`)).toBe('1');
    expectPortfolioError(
      () => normalizePortfolioDecimalLexeme('9'.repeat(PORTFOLIO_DECIMAL_MAX_PRECISION + 1)),
      'decimal_invalid',
    );
    expectPortfolioError(
      () => normalizePortfolioDecimalLexeme(`0.${'0'.repeat(PORTFOLIO_DECIMAL_MAX_SCALE)}1`),
      'decimal_invalid',
    );
  });

  it.each([
    1,
    0.1,
    null,
    undefined,
    '',
    ' 1',
    '1 ',
    '+1',
    '01',
    '.5',
    '1.',
    '1e3',
    '1E3',
    'NaN',
    'Infinity',
    '-Infinity',
  ])('rejects a non-provider decimal lexeme: %s', (value) => {
    expectPortfolioError(() => normalizePortfolioDecimalLexeme(value), 'decimal_invalid');
  });
});

describe('portfolio arithmetic', () => {
  it('adds exact values and treats an empty sum as exact zero', () => {
    expect(addPortfolioDecimals([])).toBe('0');
    expect(
      addPortfolioDecimals([
        decimal('90071992547409931234567890.123456789'),
        decimal('0.876543211'),
        decimal('-1'),
      ]),
    ).toBe('90071992547409931234567890');
  });

  it('subtracts exact values without passing through JavaScript numbers', () => {
    expect(
      subtractPortfolioDecimals(
        decimal('90071992547409931234567890.123456789'),
        decimal('90071992547409931234567889.123456788'),
      ),
    ).toBe('1.000000001');
    expect(subtractPortfolioDecimals(decimal('-2.5'), decimal('1.25'))).toBe('-3.75');
  });

  it.each([
    ['-12.3405', '12.3405'],
    ['0', '0'],
    ['12.3405', '12.3405'],
  ])('returns the exact absolute value of %s', (value, expected) => {
    expect(absolutePortfolioDecimal(decimal(value))).toBe(expected);
  });

  it.each([
    ['0', '0', 0],
    ['2', '10', -1],
    ['10', '2', 1],
    ['1.2', '1.19', 1],
    ['-2', '-10', 1],
    ['-10.5', '-10.05', -1],
    ['-0.000000000000000001', '0', -1],
  ] as const)('compares %s to %s as %s', (left, right, expected) => {
    expect(comparePortfolioDecimals(decimal(left), decimal(right))).toBe(expected);
  });

  it('reports overflow when an arithmetic result exceeds the precision policy', () => {
    const maximum = decimal('9'.repeat(PORTFOLIO_DECIMAL_MAX_PRECISION));

    expectPortfolioError(
      () => addPortfolioDecimals([maximum, decimal('1')]),
      'arithmetic_overflow',
    );
    expectPortfolioError(
      () => subtractPortfolioDecimals(decimal(`-${'9'.repeat(48)}`), decimal('1')),
      'arithmetic_overflow',
    );
  });
});

describe('portfolioPercentage', () => {
  it('uses half-even rounding at exact six-place ties', () => {
    expect(portfolioPercentage(decimal('1'), decimal('200000000'))).toBe('0');
    expect(portfolioPercentage(decimal('3'), decimal('200000000'))).toBe('0.000002');
  });

  it.each([
    ['0.999999', '0'],
    ['1', '0'],
    ['1.000001', '0.000001'],
    ['2.999999', '0.000001'],
    ['3', '0.000002'],
    ['3.000001', '0.000002'],
  ])('rounds the tie boundary numerator %s to %s', (numerator, expected) => {
    expect(portfolioPercentage(decimal(numerator), decimal('200000000'))).toBe(expected);
  });

  it('returns at most six fractional places and removes insignificant zeroes', () => {
    const recurring = portfolioPercentage(decimal('1'), decimal('3'));

    expect(recurring).toBe('33.333333');
    expect(recurring.split('.')[1]).toHaveLength(PORTFOLIO_PERCENTAGE_MAX_SCALE);
    expect(portfolioPercentage(decimal('1'), decimal('8'))).toBe('12.5');
    expect(portfolioPercentage(decimal('-1'), decimal('8'))).toBe('-12.5');
  });

  it.each(['0', '-0.000000000000000001', '-100'])('rejects denominator %s', (denominator) => {
    expectPortfolioError(
      () => portfolioPercentage(decimal('1'), decimal(denominator)),
      'division_by_zero',
    );
  });

  it('reports overflow when a percentage result exceeds the precision policy', () => {
    expectPortfolioError(
      () => portfolioPercentage(decimal('9'.repeat(PORTFOLIO_DECIMAL_MAX_PRECISION)), decimal('1')),
      'arithmetic_overflow',
    );
  });
});
