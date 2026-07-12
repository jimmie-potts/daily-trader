import { describe, expect, it } from 'vitest';

import { createUtcTimestamp, FixedClock } from './time.js';
import { DomainValidationError } from './validation-error.js';

describe('UTC timestamps', () => {
  it('retains a canonical UTC instant at millisecond precision', () => {
    const timestamp = createUtcTimestamp('2026-07-11T14:30:00.123Z');

    expect(timestamp).toBe('2026-07-11T14:30:00.123Z');
    expect(JSON.stringify(timestamp)).toBe('"2026-07-11T14:30:00.123Z"');
  });

  it.each([
    '2026-07-11T14:30:00Z',
    '2026-07-11T14:30:00.123+00:00',
    '2026-07-11 14:30:00.123Z',
    '2026-02-30T14:30:00.123Z',
    '2026-07-11T14:30:00.1234Z',
  ])('rejects ambiguous or non-canonical time: %s', (value) => {
    expect(() => createUtcTimestamp(value)).toThrowError(DomainValidationError);
  });
});

describe('FixedClock', () => {
  it('returns the injected instant deterministically', () => {
    const instant = createUtcTimestamp('2026-07-11T14:30:00.000Z');
    const clock = new FixedClock(instant);

    expect(clock.now()).toBe(instant);
    expect(clock.now()).toBe(instant);
  });
});
