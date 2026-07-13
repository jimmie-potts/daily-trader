import { describe, expect, it } from 'vitest';

import { PortfolioError } from './errors.js';
import { normalizePortfolioProviderTimestamp } from './provider-timestamp.js';

describe('normalizePortfolioProviderTimestamp', () => {
  it('preserves the provider text while truncating nanoseconds to UTC milliseconds', () => {
    const original = '2026-07-13T09:30:00.123456789-04:00';

    expect(normalizePortfolioProviderTimestamp(original)).toEqual({
      original,
      utc: '2026-07-13T13:30:00.123Z',
    });
  });

  it.each([
    ['2026-01-02T09:30:00-05:00', '2026-01-02T14:30:00.000Z'],
    ['2026-07-13T13:30:00Z', '2026-07-13T13:30:00.000Z'],
    ['2026-07-13T14:00:00.1+00:30', '2026-07-13T13:30:00.100Z'],
    ['2026-07-13T14:00:00.12+00:30', '2026-07-13T13:30:00.120Z'],
    ['2026-07-13T14:00:00.123999999+00:30', '2026-07-13T13:30:00.123Z'],
    ['2026-07-13T00:15:00-01:00', '2026-07-13T01:15:00.000Z'],
    ['2026-01-01T00:30:00+14:00', '2025-12-31T10:30:00.000Z'],
    ['2026-12-31T23:30:00-14:00', '2027-01-01T13:30:00.000Z'],
    ['2028-02-29T12:00:00.999999999Z', '2028-02-29T12:00:00.999Z'],
  ])('normalizes %s to %s', (input, expected) => {
    const normalized = normalizePortfolioProviderTimestamp(input);

    expect(normalized.original).toBe(input);
    expect(normalized.utc).toBe(expected);
  });

  it.each([
    0,
    null,
    undefined,
    {},
    '2026-07-13 09:30:00Z',
    '2026-07-13T09:30:00',
    '2026-07-13T09:30Z',
    '20260713T093000Z',
    '2026-07-13T09:30:00z',
    '2026-07-13t09:30:00Z',
    '2026-07-13T09:30:00+0400',
    '2026-07-13T09:30:00.1234567890Z',
    '2026-07-13T09:30:00.Z',
    ' 2026-07-13T09:30:00Z',
    '2026-07-13T09:30:00Z ',
  ])('rejects non-RFC3339 provider timestamp %s', (input) => {
    expect(() => normalizePortfolioProviderTimestamp(input)).toThrowError(PortfolioError);
  });

  it.each([
    '0000-01-01T00:00:00Z',
    '2026-00-01T09:30:00Z',
    '2026-13-01T09:30:00Z',
    '2026-01-00T09:30:00Z',
    '2026-01-32T09:30:00Z',
    '2026-02-29T09:30:00Z',
    '2026-02-30T09:30:00Z',
    '2026-04-31T09:30:00Z',
    '2028-02-30T09:30:00Z',
  ])('rejects invalid calendar timestamp %s', (input) => {
    expect(() => normalizePortfolioProviderTimestamp(input)).toThrowError(PortfolioError);
  });

  it.each([
    '2026-07-13T24:00:00Z',
    '2026-07-13T09:60:00Z',
    '2026-07-13T09:30:60Z',
    '2026-07-13T99:99:99Z',
  ])('rejects invalid clock timestamp %s', (input) => {
    expect(() => normalizePortfolioProviderTimestamp(input)).toThrowError(PortfolioError);
  });

  it.each([
    '2026-07-13T09:30:00+14:01',
    '2026-07-13T09:30:00-14:01',
    '2026-07-13T09:30:00+15:00',
    '2026-07-13T09:30:00-15:00',
    '2026-07-13T09:30:00+01:60',
    '2026-07-13T09:30:00-00:60',
  ])('rejects invalid UTC offset in %s', (input) => {
    expect(() => normalizePortfolioProviderTimestamp(input)).toThrowError(PortfolioError);
  });
});
