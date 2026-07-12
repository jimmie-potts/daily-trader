import { createUtcTimestamp, type UtcTimestamp } from '@daily-trader/domain';
import {
  NYSE_CORE_SESSION_CALENDAR,
  PHASE_2_INSTRUMENTS,
  classifyMarketDataFreshness,
  isLateArrival,
  utcEpochMilliseconds,
  type MarketDataFreshness,
  type MarketSessionCalendar,
  type OneMinuteBarEvent,
  type SupportedMarketDataSymbol,
} from '@daily-trader/market-data';

import type {
  BuildMarketStatusInput,
  MarketStatusModel,
  MarketStatusRow,
  MissingMarketDataFreshness,
  PresentMarketDataFreshness,
  PresentMarketStatusRow,
} from './types.js';

function assertExpectedInstrument(
  expected: SupportedMarketDataSymbol,
  event: OneMinuteBarEvent,
): void {
  const instrument = PHASE_2_INSTRUMENTS[expected];
  if (
    event.instrument.symbol !== instrument.symbol ||
    event.instrument.venue !== instrument.venue
  ) {
    throw new TypeError(`Latest canonical event does not match the ${expected} repository slot`);
  }
}

function presentFreshness(classification: MarketDataFreshness): PresentMarketDataFreshness {
  switch (classification.state) {
    case 'fresh':
    case 'future':
    case 'outside_session':
    case 'stale':
    case 'unknown':
      return classification.state;
    case 'no_data':
      throw new TypeError('A present canonical event cannot have no-data freshness');
  }
}

function missingFreshness(classification: MarketDataFreshness): MissingMarketDataFreshness {
  switch (classification.state) {
    case 'outside_session':
    case 'unknown':
      return classification.state;
    case 'no_data':
      return 'no_data';
    case 'fresh':
    case 'future':
    case 'stale':
      throw new TypeError('A missing canonical event cannot have present-data freshness');
  }
}

function mapPresentEvent(
  expected: SupportedMarketDataSymbol,
  event: OneMinuteBarEvent,
  observedAt: UtcTimestamp,
  calendar: MarketSessionCalendar,
  freshnessThresholdMs: number | undefined,
  freshnessNotBefore: UtcTimestamp | undefined,
): PresentMarketStatusRow {
  assertExpectedInstrument(expected, event);
  const freshness = classifyMarketDataFreshness(event, observedAt, calendar, freshnessThresholdMs);
  const gatedFreshness =
    freshness.state === 'fresh' &&
    freshnessNotBefore !== undefined &&
    utcEpochMilliseconds(event.receivedAt) < utcEpochMilliseconds(freshnessNotBefore)
      ? 'unknown'
      : presentFreshness(freshness);
  const ageMilliseconds = utcEpochMilliseconds(observedAt) - utcEpochMilliseconds(event.barEnd);

  return Object.freeze({
    state: 'present',
    symbol: expected,
    venue: event.instrument.venue,
    close: event.close,
    currency: event.currency,
    priceUnit: event.priceUnit,
    barStart: event.barStart,
    asOf: event.barEnd,
    providerTimestamp: event.providerTimestamp,
    receivedAt: event.receivedAt,
    ageMilliseconds,
    freshness: gatedFreshness,
    arrival: isLateArrival(event, event.receivedAt, freshnessThresholdMs) ? 'late' : 'on_time',
    source: Object.freeze({
      provider: event.source.provider,
      feed: event.source.feed,
      entitlement: event.source.entitlement,
      delayMilliseconds: event.source.delayMilliseconds,
    }),
  });
}

function mapStatusRow(
  symbol: SupportedMarketDataSymbol,
  event: OneMinuteBarEvent | undefined,
  observedAt: UtcTimestamp,
  calendar: MarketSessionCalendar,
  freshnessThresholdMs: number | undefined,
  freshnessNotBefore: UtcTimestamp | undefined,
): MarketStatusRow {
  if (event !== undefined) {
    return mapPresentEvent(
      symbol,
      event,
      observedAt,
      calendar,
      freshnessThresholdMs,
      freshnessNotBefore,
    );
  }

  return Object.freeze({
    state: 'missing',
    symbol,
    venue: PHASE_2_INSTRUMENTS[symbol].venue,
    freshness: missingFreshness(
      classifyMarketDataFreshness(undefined, observedAt, calendar, freshnessThresholdMs),
    ),
  });
}

/** Creates a deterministic, presentation-only projection from canonical state. */
export function buildMarketStatusModel(input: BuildMarketStatusInput): MarketStatusModel {
  const observedAt = createUtcTimestamp(input.clock.now());
  const calendar = input.calendar ?? NYSE_CORE_SESSION_CALENDAR;
  const lastSuccessfulEvent =
    input.lastSuccessfulEvent === undefined
      ? undefined
      : createUtcTimestamp(input.lastSuccessfulEvent);

  const rows = Object.freeze([
    mapStatusRow(
      'AAPL',
      input.repository.latest.AAPL,
      observedAt,
      calendar,
      input.freshnessThresholdMs,
      input.freshnessNotBefore,
    ),
    mapStatusRow(
      'SPY',
      input.repository.latest.SPY,
      observedAt,
      calendar,
      input.freshnessThresholdMs,
      input.freshnessNotBefore,
    ),
  ] as const);

  return Object.freeze({
    observedAt,
    rows,
    overall: Object.freeze({
      connection: input.connection,
      lastSuccessfulEvent,
      gap: input.gap,
      redisDelivery: input.repository.redisDelivery,
      postgresPersistence: input.repository.postgresPersistence,
    }),
  });
}
