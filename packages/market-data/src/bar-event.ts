import {
  compareExactDecimals,
  createExactDecimal,
  createUtcTimestamp,
  instrumentKey,
  isPositiveExactDecimal,
  type ExactDecimal,
  type InstrumentId,
  type UtcTimestamp,
} from '@daily-trader/domain';
import { createHash } from 'node:crypto';

import {
  MARKET_DATA_CURRENCY,
  MARKET_DATA_DELAY_MILLISECONDS,
  MARKET_DATA_ENTITLEMENT,
  MARKET_DATA_FEED,
  MARKET_DATA_PRICE_UNIT,
  MARKET_DATA_PROVIDER,
  MARKET_DATA_SCHEMA_VERSION,
  MARKET_DATA_SOURCE_IDENTIFIER,
  MARKET_DATA_VOLUME_UNIT,
  ONE_MINUTE_INTERVAL,
  validatePhase2Instrument,
} from './constants.js';
import { canonicalizeDecimalLexeme } from './decimal-lexeme.js';
import {
  addUtcMilliseconds,
  normalizeProviderTimestamp,
  utcEpochMilliseconds,
  type ProviderTimestamp,
} from './timestamp.js';
import { MarketDataValidationError, requireRecord, requireString } from './validation.js';

export interface MarketDataSource {
  readonly provider: typeof MARKET_DATA_PROVIDER;
  readonly feed: typeof MARKET_DATA_FEED;
  readonly identifier: typeof MARKET_DATA_SOURCE_IDENTIFIER;
  readonly entitlement: typeof MARKET_DATA_ENTITLEMENT;
  readonly delayMilliseconds: typeof MARKET_DATA_DELAY_MILLISECONDS;
}

export interface OneMinuteBarEvent {
  readonly schemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
  readonly kind: 'one_minute_bar';
  readonly eventId: string;
  readonly orderingKey: string;
  readonly instrument: InstrumentId;
  readonly interval: typeof ONE_MINUTE_INTERVAL;
  readonly currency: typeof MARKET_DATA_CURRENCY;
  readonly priceUnit: typeof MARKET_DATA_PRICE_UNIT;
  readonly volumeUnit: typeof MARKET_DATA_VOLUME_UNIT;
  readonly source: MarketDataSource;
  readonly providerTimestamp: ProviderTimestamp;
  readonly barStart: UtcTimestamp;
  readonly barEnd: UtcTimestamp;
  readonly receivedAt: UtcTimestamp;
  readonly processedAt: UtcTimestamp;
  readonly open: ExactDecimal;
  readonly high: ExactDecimal;
  readonly low: ExactDecimal;
  readonly close: ExactDecimal;
  readonly volume: ExactDecimal;
}

export interface OneMinuteBarEventInput {
  readonly symbol: unknown;
  readonly venue: unknown;
  readonly providerTimestamp: unknown;
  readonly receivedAt: unknown;
  readonly processedAt: unknown;
  readonly open: unknown;
  readonly high: unknown;
  readonly low: unknown;
  readonly close: unknown;
  readonly volume: unknown;
}

const SOURCE: MarketDataSource = Object.freeze({
  provider: MARKET_DATA_PROVIDER,
  feed: MARKET_DATA_FEED,
  identifier: MARKET_DATA_SOURCE_IDENTIFIER,
  entitlement: MARKET_DATA_ENTITLEMENT,
  delayMilliseconds: MARKET_DATA_DELAY_MILLISECONDS,
});

const ZERO = createExactDecimal('0');

function validateBarValues(values: {
  readonly open: ExactDecimal;
  readonly high: ExactDecimal;
  readonly low: ExactDecimal;
  readonly close: ExactDecimal;
  readonly volume: ExactDecimal;
}): void {
  for (const [field, value] of [
    ['open', values.open],
    ['high', values.high],
    ['low', values.low],
    ['close', values.close],
  ] as const) {
    if (!isPositiveExactDecimal(value)) {
      throw new MarketDataValidationError(field, 'must be greater than zero');
    }
  }
  if (compareExactDecimals(values.volume, ZERO) < 0) {
    throw new MarketDataValidationError('volume', 'must be nonnegative');
  }
  if (compareExactDecimals(values.low, values.high) > 0) {
    throw new MarketDataValidationError('low', 'must be less than or equal to high');
  }
  if (
    compareExactDecimals(values.open, values.low) < 0 ||
    compareExactDecimals(values.open, values.high) > 0
  ) {
    throw new MarketDataValidationError('open', 'must be between low and high');
  }
  if (
    compareExactDecimals(values.close, values.low) < 0 ||
    compareExactDecimals(values.close, values.high) > 0
  ) {
    throw new MarketDataValidationError('close', 'must be between low and high');
  }
}

function canonicalIdentity(input: {
  readonly instrument: InstrumentId;
  readonly providerTimestamp: ProviderTimestamp;
  readonly open: ExactDecimal;
  readonly high: ExactDecimal;
  readonly low: ExactDecimal;
  readonly close: ExactDecimal;
  readonly volume: ExactDecimal;
}): string {
  return JSON.stringify({
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    provider: MARKET_DATA_PROVIDER,
    feed: MARKET_DATA_FEED,
    delayMilliseconds: MARKET_DATA_DELAY_MILLISECONDS,
    instrument: {
      symbol: input.instrument.symbol,
      venue: input.instrument.venue,
    },
    interval: ONE_MINUTE_INTERVAL,
    providerTimestamp: input.providerTimestamp,
    currency: MARKET_DATA_CURRENCY,
    priceUnit: MARKET_DATA_PRICE_UNIT,
    volumeUnit: MARKET_DATA_VOLUME_UNIT,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volume: input.volume,
  });
}

function eventIdentifier(identity: string): string {
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

export function createOneMinuteBarEvent(input: OneMinuteBarEventInput): OneMinuteBarEvent {
  const instrument = validatePhase2Instrument(input.symbol, input.venue);
  const providerTime = normalizeProviderTimestamp(input.providerTimestamp);
  if (utcEpochMilliseconds(providerTime.utc) % 60_000 !== 0) {
    throw new MarketDataValidationError(
      'providerTimestamp',
      'one-minute bar start must align to a UTC minute boundary',
    );
  }

  const receivedAt = createUtcTimestamp(input.receivedAt);
  const processedAt = createUtcTimestamp(input.processedAt);
  if (utcEpochMilliseconds(processedAt) < utcEpochMilliseconds(receivedAt)) {
    throw new MarketDataValidationError('processedAt', 'must not precede receivedAt');
  }

  const values = {
    open: canonicalizeDecimalLexeme(input.open, 'open'),
    high: canonicalizeDecimalLexeme(input.high, 'high'),
    low: canonicalizeDecimalLexeme(input.low, 'low'),
    close: canonicalizeDecimalLexeme(input.close, 'close'),
    volume: canonicalizeDecimalLexeme(input.volume, 'volume'),
  } as const;
  validateBarValues(values);

  const orderingKey = `${instrumentKey(instrument)}|${ONE_MINUTE_INTERVAL}|${providerTime.utc}`;
  const eventId = eventIdentifier(
    canonicalIdentity({
      instrument,
      providerTimestamp: providerTime.original,
      ...values,
    }),
  );

  return Object.freeze({
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    kind: 'one_minute_bar',
    eventId,
    orderingKey,
    instrument,
    interval: ONE_MINUTE_INTERVAL,
    currency: MARKET_DATA_CURRENCY,
    priceUnit: MARKET_DATA_PRICE_UNIT,
    volumeUnit: MARKET_DATA_VOLUME_UNIT,
    source: SOURCE,
    providerTimestamp: providerTime.original,
    barStart: providerTime.utc,
    barEnd: addUtcMilliseconds(providerTime.utc, 60_000),
    receivedAt,
    processedAt,
    ...values,
  });
}

function canonicalEventObject(event: OneMinuteBarEvent): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: event.schemaVersion,
    kind: event.kind,
    eventId: event.eventId,
    orderingKey: event.orderingKey,
    instrument: {
      symbol: event.instrument.symbol,
      venue: event.instrument.venue,
    },
    interval: event.interval,
    currency: event.currency,
    priceUnit: event.priceUnit,
    volumeUnit: event.volumeUnit,
    source: {
      provider: event.source.provider,
      feed: event.source.feed,
      identifier: event.source.identifier,
      entitlement: event.source.entitlement,
      delayMilliseconds: event.source.delayMilliseconds,
    },
    providerTimestamp: event.providerTimestamp,
    barStart: event.barStart,
    barEnd: event.barEnd,
    receivedAt: event.receivedAt,
    processedAt: event.processedAt,
    open: event.open,
    high: event.high,
    low: event.low,
    close: event.close,
    volume: event.volume,
  };
}

export function serializeOneMinuteBarEvent(event: OneMinuteBarEvent): string {
  return JSON.stringify(canonicalEventObject(event));
}

function requireConstant(value: unknown, expected: string | number, field: string): void {
  if (value !== expected) {
    throw new MarketDataValidationError(field, `must be ${expected}`);
  }
}

export function deserializeOneMinuteBarEvent(serialized: unknown): OneMinuteBarEvent {
  const text = requireString(serialized, 'serializedEvent');
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new MarketDataValidationError('serializedEvent', 'must be valid JSON');
  }

  const record = requireRecord(decoded, 'event');
  const instrument = requireRecord(record.instrument, 'event.instrument');
  const source = requireRecord(record.source, 'event.source');
  requireConstant(record.schemaVersion, MARKET_DATA_SCHEMA_VERSION, 'event.schemaVersion');
  requireConstant(record.kind, 'one_minute_bar', 'event.kind');
  requireConstant(record.interval, ONE_MINUTE_INTERVAL, 'event.interval');
  requireConstant(record.currency, MARKET_DATA_CURRENCY, 'event.currency');
  requireConstant(record.priceUnit, MARKET_DATA_PRICE_UNIT, 'event.priceUnit');
  requireConstant(record.volumeUnit, MARKET_DATA_VOLUME_UNIT, 'event.volumeUnit');
  requireConstant(source.provider, MARKET_DATA_PROVIDER, 'event.source.provider');
  requireConstant(source.feed, MARKET_DATA_FEED, 'event.source.feed');
  requireConstant(source.identifier, MARKET_DATA_SOURCE_IDENTIFIER, 'event.source.identifier');
  requireConstant(source.entitlement, MARKET_DATA_ENTITLEMENT, 'event.source.entitlement');
  requireConstant(
    source.delayMilliseconds,
    MARKET_DATA_DELAY_MILLISECONDS,
    'event.source.delayMilliseconds',
  );

  const event = createOneMinuteBarEvent({
    symbol: instrument.symbol,
    venue: instrument.venue,
    providerTimestamp: record.providerTimestamp,
    receivedAt: record.receivedAt,
    processedAt: record.processedAt,
    open: record.open,
    high: record.high,
    low: record.low,
    close: record.close,
    volume: record.volume,
  });

  if (record.eventId !== event.eventId || record.orderingKey !== event.orderingKey) {
    throw new MarketDataValidationError('event.eventId', 'does not match canonical event content');
  }
  if (record.barStart !== event.barStart || record.barEnd !== event.barEnd) {
    throw new MarketDataValidationError('event.barStart', 'does not match provider timestamp');
  }
  if (serializeOneMinuteBarEvent(event) !== text) {
    throw new MarketDataValidationError(
      'serializedEvent',
      'must use the fixed canonical field order without extra fields or whitespace',
    );
  }
  return event;
}
