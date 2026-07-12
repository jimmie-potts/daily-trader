import { createUtcTimestamp, instrumentKey, type UtcTimestamp } from '@daily-trader/domain';

import { type OneMinuteBarEvent } from './bar-event.js';
import { NYSE_CORE_SESSION_CALENDAR, type MarketSessionCalendar } from './calendar.js';
import { FRESHNESS_THRESHOLD_MS } from './constants.js';
import { isLateArrival } from './freshness.js';
import { addUtcMilliseconds, utcEpochMilliseconds } from './timestamp.js';

export type EventOrderingClassification = 'accepted' | 'duplicate' | 'correction' | 'out_of_order';
export type GapState = 'complete' | 'gapped' | 'unknown';

export interface GapAssessment {
  readonly state: GapState;
  readonly missingIntervalCount: number;
  readonly firstMissingBarStart?: UtcTimestamp;
  readonly lastMissingBarStart?: UtcTimestamp;
  readonly scanLimited: boolean;
}

export interface EventOrderingResult {
  readonly classification: EventOrderingClassification;
  readonly late: boolean;
  readonly gap: GapAssessment;
}

interface SeriesState {
  greatestBarStart: UtcTimestamp;
  gap: GapAssessment;
}

export const MAX_GAP_SCAN_INTERVALS = 10_080 as const;
export const DEFAULT_ORDERING_TRACKER_CAPACITY = 10_000 as const;

export interface MarketEventOrderingTrackerOptions {
  readonly calendar?: MarketSessionCalendar;
  readonly freshnessThresholdMs?: number;
  readonly maximumTrackedEvents?: number;
}

const UNKNOWN_GAP: GapAssessment = Object.freeze({
  state: 'unknown',
  missingIntervalCount: 0,
  scanLimited: false,
});

const COMPLETE_GAP: GapAssessment = Object.freeze({
  state: 'complete',
  missingIntervalCount: 0,
  scanLimited: false,
});

function seriesKey(event: OneMinuteBarEvent): string {
  return `${instrumentKey(event.instrument)}|${event.interval}`;
}

export function assessIntervalGap(
  previousBarStart: UtcTimestamp,
  currentBarStart: UtcTimestamp,
  calendar: MarketSessionCalendar = NYSE_CORE_SESSION_CALENDAR,
): GapAssessment {
  const previous = createUtcTimestamp(previousBarStart);
  const current = createUtcTimestamp(currentBarStart);
  const previousEpoch = utcEpochMilliseconds(previous);
  const currentEpoch = utcEpochMilliseconds(current);
  if (currentEpoch <= previousEpoch) {
    return UNKNOWN_GAP;
  }

  const intervals = (currentEpoch - previousEpoch) / 60_000 - 1;
  if (!Number.isInteger(intervals)) {
    return UNKNOWN_GAP;
  }
  if (intervals > MAX_GAP_SCAN_INTERVALS) {
    return Object.freeze({
      state: 'unknown',
      missingIntervalCount: 0,
      scanLimited: true,
    });
  }

  let missingIntervalCount = 0;
  let firstMissingBarStart: UtcTimestamp | undefined;
  let lastMissingBarStart: UtcTimestamp | undefined;
  for (let index = 1; index <= intervals; index += 1) {
    const candidate = addUtcMilliseconds(previous, index * 60_000);
    const classification = calendar.classify(candidate);
    if (classification.state === 'unknown') {
      return UNKNOWN_GAP;
    }
    if (classification.state === 'open') {
      missingIntervalCount += 1;
      firstMissingBarStart ??= candidate;
      lastMissingBarStart = candidate;
    }
  }

  if (missingIntervalCount === 0) {
    return COMPLETE_GAP;
  }
  return Object.freeze({
    state: 'gapped',
    missingIntervalCount,
    ...(firstMissingBarStart === undefined ? {} : { firstMissingBarStart }),
    ...(lastMissingBarStart === undefined ? {} : { lastMissingBarStart }),
    scanLimited: false,
  });
}

function preserveDetectedGap(current: GapAssessment, next: GapAssessment): GapAssessment {
  if (current.state === 'gapped') {
    return current;
  }
  return next;
}

export class MarketEventOrderingTracker {
  readonly #calendar: MarketSessionCalendar;
  readonly #freshnessThresholdMs: number;
  readonly #maximumTrackedEvents: number;
  readonly #orderingKeyByEventId = new Map<string, string>();
  readonly #eventIdByOrderingKey = new Map<string, string>();
  readonly #series = new Map<string, SeriesState>();

  public constructor(options: MarketEventOrderingTrackerOptions = {}) {
    const freshnessThresholdMs = options.freshnessThresholdMs ?? FRESHNESS_THRESHOLD_MS;
    const maximumTrackedEvents = options.maximumTrackedEvents ?? DEFAULT_ORDERING_TRACKER_CAPACITY;
    if (!Number.isSafeInteger(freshnessThresholdMs) || freshnessThresholdMs < 0) {
      throw new TypeError('freshnessThresholdMs must be a nonnegative safe integer');
    }
    if (!Number.isSafeInteger(maximumTrackedEvents) || maximumTrackedEvents < 1) {
      throw new TypeError('maximumTrackedEvents must be a positive safe integer');
    }
    this.#calendar = options.calendar ?? NYSE_CORE_SESSION_CALENDAR;
    this.#freshnessThresholdMs = freshnessThresholdMs;
    this.#maximumTrackedEvents = maximumTrackedEvents;
  }

  private remember(event: OneMinuteBarEvent): void {
    this.#orderingKeyByEventId.set(event.eventId, event.orderingKey);
    this.#eventIdByOrderingKey.set(event.orderingKey, event.eventId);

    while (this.#orderingKeyByEventId.size > this.#maximumTrackedEvents) {
      const oldest = this.#orderingKeyByEventId.entries().next().value as
        readonly [string, string] | undefined;
      if (oldest === undefined) {
        return;
      }
      const [eventId, orderingKey] = oldest;
      this.#orderingKeyByEventId.delete(eventId);
      if (this.#eventIdByOrderingKey.get(orderingKey) === eventId) {
        this.#eventIdByOrderingKey.delete(orderingKey);
      }
    }
  }

  public classify(event: OneMinuteBarEvent, observedAt: UtcTimestamp): EventOrderingResult {
    const observed = createUtcTimestamp(observedAt);
    const late = isLateArrival(event, observed, this.#freshnessThresholdMs);
    const state = this.#series.get(seriesKey(event));
    const existingEventId = this.#eventIdByOrderingKey.get(event.orderingKey);

    if (this.#orderingKeyByEventId.has(event.eventId)) {
      return Object.freeze({ classification: 'duplicate', late, gap: state?.gap ?? UNKNOWN_GAP });
    }

    this.remember(event);
    if (existingEventId !== undefined) {
      return Object.freeze({ classification: 'correction', late, gap: state?.gap ?? UNKNOWN_GAP });
    }

    if (state === undefined) {
      this.#series.set(seriesKey(event), {
        greatestBarStart: event.barStart,
        gap: UNKNOWN_GAP,
      });
      return Object.freeze({ classification: 'accepted', late, gap: UNKNOWN_GAP });
    }

    if (utcEpochMilliseconds(event.barStart) < utcEpochMilliseconds(state.greatestBarStart)) {
      return Object.freeze({ classification: 'out_of_order', late, gap: state.gap });
    }

    const assessedGap = assessIntervalGap(state.greatestBarStart, event.barStart, this.#calendar);
    state.greatestBarStart = event.barStart;
    state.gap = preserveDetectedGap(state.gap, assessedGap);
    return Object.freeze({ classification: 'accepted', late, gap: state.gap });
  }

  public reset(): void {
    this.#orderingKeyByEventId.clear();
    this.#eventIdByOrderingKey.clear();
    this.#series.clear();
  }
}
