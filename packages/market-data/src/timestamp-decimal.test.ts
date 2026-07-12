import { describe, expect, it } from 'vitest';

import { canonicalizeDecimalLexeme } from './decimal-lexeme.js';
import { normalizeProviderTimestamp } from './timestamp.js';
import { MarketDataValidationError } from './validation.js';

describe('canonicalizeDecimalLexeme', () => {
  it.each([
    ['0', '0'],
    ['-0', '0'],
    ['0.000', '0'],
    ['210.2500', '210.25'],
    ['-12.34000', '-12.34'],
    ['90071992547409931234567890.123456789000', '90071992547409931234567890.123456789'],
  ])('canonicalizes %s without numeric conversion', (input, expected) => {
    expect(canonicalizeDecimalLexeme(input)).toBe(expected);
  });

  it.each([
    1,
    0.1,
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
  ])('rejects a non-plain string lexeme: %s', (input) => {
    expect(() => canonicalizeDecimalLexeme(input)).toThrowError(MarketDataValidationError);
  });
});

describe('normalizeProviderTimestamp', () => {
  it('preserves original nanosecond precision and normalizes to UTC milliseconds', () => {
    expect(normalizeProviderTimestamp('2026-07-13T09:30:00.123456789-04:00')).toEqual({
      original: '2026-07-13T09:30:00.123456789-04:00',
      utc: '2026-07-13T13:30:00.123Z',
    });
  });

  it.each([
    ['2026-01-02T09:30:00-05:00', '2026-01-02T14:30:00.000Z'],
    ['2026-07-13T13:30:00Z', '2026-07-13T13:30:00.000Z'],
    ['2026-07-13T14:00:00.1+00:30', '2026-07-13T13:30:00.100Z'],
    ['2026-07-13T00:15:00-01:00', '2026-07-13T01:15:00.000Z'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeProviderTimestamp(input).utc).toBe(expected);
  });

  it.each([
    '2026-02-30T09:30:00Z',
    '2026-07-13 09:30:00Z',
    '2026-07-13T09:30:00',
    '2026-07-13T24:00:00Z',
    '2026-07-13T09:60:00Z',
    '2026-07-13T09:30:60Z',
    '2026-07-13T09:30:00.1234567890Z',
    '2026-07-13T09:30:00+14:01',
    '2026-07-13T09:30:00+15:00',
    '2026-07-13t09:30:00z',
  ])('rejects invalid provider timestamp %s', (input) => {
    expect(() => normalizeProviderTimestamp(input)).toThrowError(MarketDataValidationError);
  });
});
