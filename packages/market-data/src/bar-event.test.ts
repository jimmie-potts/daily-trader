import { describe, expect, it } from 'vitest';

import {
  createOneMinuteBarEvent,
  deserializeOneMinuteBarEvent,
  serializeOneMinuteBarEvent,
  type OneMinuteBarEventInput,
} from './bar-event.js';
import {
  MARKET_DATA_ENTITLEMENT,
  MARKET_DATA_FEED,
  MARKET_DATA_PROVIDER,
  MARKET_DATA_SCHEMA_VERSION,
} from './constants.js';
import { MarketDataValidationError } from './validation.js';

function validInput(overrides: Partial<OneMinuteBarEventInput> = {}): OneMinuteBarEventInput {
  return {
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: '2026-07-13T13:30:00.000000000Z',
    receivedAt: '2026-07-13T13:31:00.100Z',
    processedAt: '2026-07-13T13:31:00.200Z',
    open: '210.1000',
    high: '211.00',
    low: '209.50',
    close: '210.25',
    volume: '12345678901234567890.000',
    ...overrides,
  };
}

describe('createOneMinuteBarEvent', () => {
  it('constructs a deeply immutable application-owned event with fixed units and source', () => {
    const event = createOneMinuteBarEvent(validInput());

    expect(event).toMatchObject({
      schemaVersion: MARKET_DATA_SCHEMA_VERSION,
      kind: 'one_minute_bar',
      instrument: { symbol: 'AAPL', venue: 'XNAS' },
      interval: '1m',
      currency: 'USD',
      priceUnit: 'USD/share',
      volumeUnit: 'share',
      source: {
        provider: MARKET_DATA_PROVIDER,
        feed: MARKET_DATA_FEED,
        identifier: 'alpaca:iex:bars',
        entitlement: MARKET_DATA_ENTITLEMENT,
        delayMilliseconds: 0,
      },
      providerTimestamp: '2026-07-13T13:30:00.000000000Z',
      barStart: '2026-07-13T13:30:00.000Z',
      barEnd: '2026-07-13T13:31:00.000Z',
      open: '210.1',
      high: '211',
      low: '209.5',
      close: '210.25',
      volume: '12345678901234567890',
    });
    expect(event.eventId).toMatch(/^[a-f0-9]{64}$/u);
    expect(event.orderingKey).toBe('XNAS:AAPL|1m|2026-07-13T13:30:00.000Z');
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.instrument)).toBe(true);
    expect(Object.isFrozen(event.source)).toBe(true);
  });

  it('excludes receive and process times from deterministic identity', () => {
    const first = createOneMinuteBarEvent(validInput());
    const later = createOneMinuteBarEvent(
      validInput({
        receivedAt: '2026-07-13T13:31:10.000Z',
        processedAt: '2026-07-13T13:31:11.000Z',
      }),
    );

    expect(later.eventId).toBe(first.eventId);
    expect(later.orderingKey).toBe(first.orderingKey);
    expect(serializeOneMinuteBarEvent(later)).not.toBe(serializeOneMinuteBarEvent(first));
  });

  it('changes event identity but not ordering key for corrected content', () => {
    const first = createOneMinuteBarEvent(validInput());
    const correction = createOneMinuteBarEvent(validInput({ close: '210.30' }));

    expect(correction.eventId).not.toBe(first.eventId);
    expect(correction.orderingKey).toBe(first.orderingKey);
  });

  it.each([
    [{ symbol: 'MSFT' }, 'instrument.symbol'],
    [{ venue: 'ARCX' }, 'instrument.venue'],
    [{ providerTimestamp: '2026-07-13T13:30:00.001Z' }, 'providerTimestamp'],
    [{ processedAt: '2026-07-13T13:31:00.000Z' }, 'processedAt'],
    [{ open: '0' }, 'open'],
    [{ high: '-1' }, 'high'],
    [{ volume: '-0.1' }, 'volume'],
    [{ low: '212', high: '211' }, 'low'],
    [{ open: '208' }, 'open'],
    [{ close: '212' }, 'close'],
    [{ close: 210.25 }, 'close'],
    [{ volume: 100 }, 'volume'],
  ] as const)('rejects invalid bar input %o', (overrides, expectedField) => {
    expect(() => createOneMinuteBarEvent(validInput(overrides))).toThrowError(expectedField);
  });
});

describe('canonical event serialization', () => {
  it('round trips byte-for-byte in fixed field order', () => {
    const event = createOneMinuteBarEvent(validInput());
    const serialized = serializeOneMinuteBarEvent(event);

    expect(deserializeOneMinuteBarEvent(serialized)).toEqual(event);
    expect(serializeOneMinuteBarEvent(deserializeOneMinuteBarEvent(serialized))).toBe(serialized);
    expect(serialized.indexOf('"schemaVersion"')).toBeLessThan(serialized.indexOf('"eventId"'));
    expect(serialized.indexOf('"eventId"')).toBeLessThan(serialized.indexOf('"instrument"'));
  });

  it.each([
    (value: Record<string, unknown>) => ({ ...value, eventId: '0'.repeat(64) }),
    (value: Record<string, unknown>) => ({ ...value, orderingKey: 'wrong' }),
    (value: Record<string, unknown>) => ({ ...value, extra: true }),
    (value: Record<string, unknown>) => ({ ...value, schemaVersion: 'unknown' }),
    (value: Record<string, unknown>) => ({ ...value, open: 210.1 }),
  ])('rejects tampered or noncanonical content', (tamper) => {
    const encoded = serializeOneMinuteBarEvent(createOneMinuteBarEvent(validInput()));
    const decoded = JSON.parse(encoded) as Record<string, unknown>;

    expect(() => deserializeOneMinuteBarEvent(JSON.stringify(tamper(decoded)))).toThrowError();
  });

  it('rejects semantically equivalent JSON in a different field order', () => {
    const event = createOneMinuteBarEvent(validInput());
    const decoded = JSON.parse(serializeOneMinuteBarEvent(event)) as Record<string, unknown>;
    const reordered = JSON.stringify({ kind: decoded.kind, ...decoded });

    expect(() => deserializeOneMinuteBarEvent(reordered)).toThrowError(MarketDataValidationError);
  });
});
