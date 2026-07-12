import { createUtcTimestamp, type UtcTimestamp } from '@daily-trader/domain';

import { type OneMinuteBarEvent } from './bar-event.js';
import {
  NYSE_CORE_SESSION_CALENDAR,
  type MarketSessionCalendar,
  type MarketSessionClassification,
} from './calendar.js';
import { FRESHNESS_THRESHOLD_MS } from './constants.js';
import { utcEpochMilliseconds } from './timestamp.js';

function validateFreshnessThreshold(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('freshnessThresholdMs must be a nonnegative safe integer');
  }
  return value;
}

export type MarketDataFreshness =
  | Readonly<{ state: 'fresh'; ageMs: number; session: MarketSessionClassification }>
  | Readonly<{ state: 'stale'; ageMs: number; session: MarketSessionClassification }>
  | Readonly<{ state: 'future'; ageMs: number; session: MarketSessionClassification }>
  | Readonly<{ state: 'no_data'; session: MarketSessionClassification }>
  | Readonly<{ state: 'outside_session'; session: MarketSessionClassification }>
  | Readonly<{ state: 'unknown'; session: MarketSessionClassification }>;

/** Classifies persisted bar freshness independently from transport state. */
export function classifyMarketDataFreshness(
  event: OneMinuteBarEvent | undefined,
  observedAt: UtcTimestamp,
  calendar: MarketSessionCalendar = NYSE_CORE_SESSION_CALENDAR,
  freshnessThresholdMs: number = FRESHNESS_THRESHOLD_MS,
): MarketDataFreshness {
  const threshold = validateFreshnessThreshold(freshnessThresholdMs);
  const observed = createUtcTimestamp(observedAt);
  const observedSession = calendar.classify(observed);
  if (observedSession.state === 'unknown') {
    return Object.freeze({ state: 'unknown', session: observedSession });
  }
  if (observedSession.state === 'outside_session') {
    return Object.freeze({ state: 'outside_session', session: observedSession });
  }
  if (event === undefined) {
    return Object.freeze({ state: 'no_data', session: observedSession });
  }

  const barSession = calendar.classify(event.barStart);
  if (barSession.state === 'unknown') {
    return Object.freeze({ state: 'unknown', session: barSession });
  }
  if (barSession.state === 'outside_session') {
    return Object.freeze({ state: 'outside_session', session: barSession });
  }

  const ageMs = utcEpochMilliseconds(observed) - utcEpochMilliseconds(event.barEnd);
  if (ageMs < 0) {
    return Object.freeze({ state: 'future', ageMs, session: observedSession });
  }
  if (ageMs <= threshold) {
    return Object.freeze({ state: 'fresh', ageMs, session: observedSession });
  }
  return Object.freeze({ state: 'stale', ageMs, session: observedSession });
}

export function isLateArrival(
  event: OneMinuteBarEvent,
  observedAt: UtcTimestamp,
  freshnessThresholdMs: number = FRESHNESS_THRESHOLD_MS,
): boolean {
  const threshold = validateFreshnessThreshold(freshnessThresholdMs);
  return (
    utcEpochMilliseconds(createUtcTimestamp(observedAt)) - utcEpochMilliseconds(event.barEnd) >
    threshold
  );
}
