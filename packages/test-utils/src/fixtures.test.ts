import { describe, expect, it } from 'vitest';

import {
  decimalFixture,
  deterministicId,
  fixedClockFixture,
  instrumentFixture,
  moneyFixture,
  priceFixture,
  quantityFixture,
  timestampFixture,
} from './fixtures.js';

describe('deterministic domain fixtures', () => {
  it('constructs readable exact values with production validation', () => {
    const instrument = instrumentFixture('AAPL', 'XNAS');

    expect(decimalFixture('210.25')).toBe('210.25');
    expect(moneyFixture('1000', 'USD')).toMatchObject({
      amount: '1000',
      currency: 'USD',
    });
    expect(priceFixture('210.25', 'USD', instrument)).toMatchObject({
      amount: '210.25',
      instrument,
    });
    expect(quantityFixture('5', instrument)).toMatchObject({
      amount: '5',
      instrument,
    });
  });

  it('uses explicit time and creates no ambient clock state', () => {
    const instant = '2026-07-11T14:30:00.000Z';

    expect(timestampFixture(instant)).toBe(instant);
    expect(fixedClockFixture(instant).now()).toBe(instant);
    expect(fixedClockFixture(instant).now()).toBe(instant);
  });
});

describe('deterministicId', () => {
  it('depends only on explicit arguments', () => {
    expect(deterministicId('signal', 7)).toBe('signal-0007');
    expect(deterministicId('signal', 7)).toBe('signal-0007');
    expect(deterministicId('signal', 8)).toBe('signal-0008');
  });

  const invalidCases: ReadonlyArray<readonly [string, number]> = [
    ['Signal', 1],
    ['signal_', 1],
    ['signal', -1],
    ['signal', 1.5],
    ['signal', Number.MAX_SAFE_INTEGER + 1],
  ];

  it.each(invalidCases)('rejects invalid input %s/%s', (namespace, sequence) => {
    expect(() => deterministicId(namespace, sequence)).toThrowError(TypeError);
  });
});
