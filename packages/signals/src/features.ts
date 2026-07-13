import { createUtcTimestamp, instrumentKey, type UtcTimestamp } from '@daily-trader/domain';
import {
  NYSE_CORE_SESSION_CALENDAR,
  deserializeOneMinuteBarEvent,
  serializeOneMinuteBarEvent,
  utcEpochMilliseconds,
  type MarketSessionCalendar,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';

import {
  addSignalDecimals,
  compareSignalDecimals,
  createSignalDecimal,
  type SignalDecimal,
} from './arithmetic.js';
import {
  BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
  FEATURE_RESULT_SCHEMA_VERSION,
  MAX_LOOKBACK_BARS,
  semanticVersions,
  type SignalConfiguration,
} from './configuration.js';
import type {
  FeatureResult,
  FeatureSuppressionReason,
  ReadyFeatureResult,
  SignalEvaluationBar,
  SignalEvidenceReference,
  SignalEvaluationMode,
  SignalUnits,
  SuppressedFeatureResult,
} from './contracts.js';
import { SignalError } from './errors.js';
import { featureResultIdentity } from './serialization.js';

export const MAX_FEATURE_STATE_BARS_PER_INSTRUMENT = MAX_LOOKBACK_BARS + 1;

const UNITS: SignalUnits = Object.freeze({
  currency: 'USD',
  price: 'USD/share',
  volume: 'share',
});

export interface ComputeFeatureResultInput {
  readonly canonicalBars: readonly OneMinuteBarEvent[];
  readonly evaluationEventId: string;
  readonly configuration: SignalConfiguration;
  readonly calendar?: MarketSessionCalendar;
}

function canonicalProjection(bars: readonly OneMinuteBarEvent[]): readonly OneMinuteBarEvent[] {
  const byOrderingKey = new Set<string>();
  const byEventId = new Set<string>();
  const validated = bars.map((bar) => {
    let event: OneMinuteBarEvent;
    try {
      event = deserializeOneMinuteBarEvent(serializeOneMinuteBarEvent(bar));
    } catch {
      throw new SignalError('invariant_violation');
    }
    if (byOrderingKey.has(event.orderingKey) || byEventId.has(event.eventId)) {
      throw new SignalError('invariant_violation');
    }
    byOrderingKey.add(event.orderingKey);
    byEventId.add(event.eventId);
    return event;
  });
  return Object.freeze(
    validated.sort((left, right) => {
      const instrumentComparison = instrumentKey(left.instrument).localeCompare(
        instrumentKey(right.instrument),
      );
      if (instrumentComparison !== 0) return instrumentComparison;
      const timeComparison =
        utcEpochMilliseconds(left.barStart) - utcEpochMilliseconds(right.barStart);
      if (timeComparison !== 0) return timeComparison;
      return left.eventId.localeCompare(right.eventId);
    }),
  );
}

function evaluationBar(event: OneMinuteBarEvent): SignalEvaluationBar {
  return Object.freeze({
    eventId: event.eventId,
    barStart: event.barStart,
    barEnd: event.barEnd,
    receivedAt: event.receivedAt,
    close: event.close,
    volume: event.volume,
  });
}

function evidence(events: readonly OneMinuteBarEvent[]): readonly SignalEvidenceReference[] {
  return Object.freeze(
    events.map((event, index) =>
      Object.freeze({
        role: index === 0 ? ('evaluation_bar' as const) : ('reference_bar' as const),
        ordinal: index === 0 ? 0 : index - 1,
        eventId: event.eventId,
        barStart: event.barStart,
        receivedAt: event.receivedAt,
      }),
    ),
  );
}

function latestReceivedAt(events: readonly OneMinuteBarEvent[]): UtcTimestamp {
  const latest = events.reduce((current, event) =>
    utcEpochMilliseconds(event.receivedAt) > utcEpochMilliseconds(current.receivedAt)
      ? event
      : current,
  );
  return latest.receivedAt;
}

function evaluationMode(
  evaluation: OneMinuteBarEvent,
  references: readonly OneMinuteBarEvent[],
  freshnessThresholdMs: number,
): SignalEvaluationMode {
  const evaluationFresh =
    utcEpochMilliseconds(evaluation.receivedAt) - utcEpochMilliseconds(evaluation.barEnd) <=
    freshnessThresholdMs;
  const evidenceKnown = references.every(
    (reference) =>
      utcEpochMilliseconds(reference.receivedAt) <= utcEpochMilliseconds(evaluation.receivedAt),
  );
  return evaluationFresh && evidenceKnown ? 'on_time' : 'retrospective';
}

function commonResult(
  evaluation: OneMinuteBarEvent,
  references: readonly OneMinuteBarEvent[],
  configuration: SignalConfiguration,
): Omit<FeatureResult, 'featureResultId' | 'kind'> {
  const currentEvidence = [evaluation, ...references] as const;
  return {
    schemaVersion: FEATURE_RESULT_SCHEMA_VERSION,
    definitionVersion: BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
    instrument: evaluation.instrument,
    evaluationBar: evaluationBar(evaluation),
    observationAsOf: evaluation.receivedAt,
    knowledgeAsOf: latestReceivedAt(currentEvidence),
    mode: evaluationMode(evaluation, references, configuration.freshnessThresholdMs),
    source: evaluation.source,
    units: UNITS,
    evidence: evidence(currentEvidence),
    semantics: semanticVersions(configuration),
  };
}

function finalizeSuppressed(
  evaluation: OneMinuteBarEvent,
  references: readonly OneMinuteBarEvent[],
  configuration: SignalConfiguration,
  reason: FeatureSuppressionReason,
): SuppressedFeatureResult {
  const provisional: SuppressedFeatureResult = {
    ...commonResult(evaluation, references, configuration),
    kind: 'suppressed',
    reason,
    featureResultId: '',
  };
  return Object.freeze({ ...provisional, featureResultId: featureResultIdentity(provisional) });
}

function finalizeReady(
  evaluation: OneMinuteBarEvent,
  references: readonly OneMinuteBarEvent[],
  configuration: SignalConfiguration,
  priorHigh: SignalDecimal,
  priorLow: SignalDecimal,
  priorVolumeSum: SignalDecimal,
): ReadyFeatureResult {
  const first = references[0];
  const last = references.at(-1);
  if (first === undefined || last === undefined) {
    throw new SignalError('invariant_violation');
  }
  const provisional: ReadyFeatureResult = {
    ...commonResult(evaluation, references, configuration),
    kind: 'ready',
    priorRange: Object.freeze({ high: priorHigh, low: priorLow }),
    priorVolume: Object.freeze({ sum: priorVolumeSum, count: references.length }),
    window: Object.freeze({
      firstBarStart: first.barStart,
      lastBarStart: last.barStart,
      count: references.length,
    }),
    featureResultId: '',
  };
  return Object.freeze({ ...provisional, featureResultId: featureResultIdentity(provisional) });
}

function expectedReferenceStarts(
  evaluation: OneMinuteBarEvent,
  lookbackBars: number,
  calendar: MarketSessionCalendar,
): {
  readonly starts: readonly UtcTimestamp[];
  readonly warm: boolean;
  readonly calendarDate: string;
} {
  const classification = calendar.classify(evaluation.barStart);
  if (classification.state !== 'open') {
    throw new SignalError('invariant_violation');
  }
  const starts: UtcTimestamp[] = [];
  let warm = true;
  for (let offset = lookbackBars; offset >= 1; offset -= 1) {
    const start = createUtcTimestamp(
      new Date(utcEpochMilliseconds(evaluation.barStart) - offset * 60_000).toISOString(),
    );
    const expected = calendar.classify(start);
    if (expected.state !== 'open' || expected.calendarDate !== classification.calendarDate) {
      warm = false;
    } else {
      starts.push(start);
    }
  }
  return Object.freeze({
    starts: Object.freeze(starts),
    warm,
    calendarDate: classification.calendarDate,
  });
}

function validateCanonicalSession(
  bars: readonly OneMinuteBarEvent[],
  calendar: MarketSessionCalendar,
): void {
  for (const bar of bars) {
    if (calendar.classify(bar.barStart).state !== 'open') {
      throw new SignalError('invariant_violation');
    }
  }
}

function extrema(values: readonly SignalDecimal[]): { high: SignalDecimal; low: SignalDecimal } {
  const first = values[0];
  if (first === undefined) throw new SignalError('invariant_violation');
  let high = first;
  let low = first;
  for (const value of values.slice(1)) {
    if (compareSignalDecimals(value, high) > 0) high = value;
    if (compareSignalDecimals(value, low) < 0) low = value;
  }
  return { high, low };
}

export function computeFeatureResult(input: ComputeFeatureResultInput): FeatureResult {
  const calendar = input.calendar ?? NYSE_CORE_SESSION_CALENDAR;
  const projection = canonicalProjection(input.canonicalBars);
  validateCanonicalSession(projection, calendar);
  const evaluation = projection.find((bar) => bar.eventId === input.evaluationEventId);
  if (evaluation === undefined) throw new SignalError('invariant_violation');

  if (utcEpochMilliseconds(evaluation.barEnd) > utcEpochMilliseconds(evaluation.receivedAt)) {
    return finalizeSuppressed(evaluation, [], input.configuration, 'future_evaluation_bar');
  }

  const expected = expectedReferenceStarts(evaluation, input.configuration.lookbackBars, calendar);
  const sameInstrument = projection.filter(
    (bar) => instrumentKey(bar.instrument) === instrumentKey(evaluation.instrument),
  );
  const byStart = new Map(sameInstrument.map((bar) => [bar.barStart, bar]));
  const availableReferences = expected.starts.flatMap((start) => {
    const bar = byStart.get(start);
    return bar === undefined ? [] : [bar];
  });
  if (!expected.warm) {
    return finalizeSuppressed(
      evaluation,
      availableReferences,
      input.configuration,
      'insufficient_warmup',
    );
  }
  if (availableReferences.length !== input.configuration.lookbackBars) {
    return finalizeSuppressed(
      evaluation,
      availableReferences,
      input.configuration,
      'missing_interval',
    );
  }

  try {
    const highs = availableReferences.map((bar) => createSignalDecimal(bar.high));
    const lows = availableReferences.map((bar) => createSignalDecimal(bar.low));
    const volumes = availableReferences.map((bar) => createSignalDecimal(bar.volume));
    const priorVolumeSum = addSignalDecimals(volumes);
    if (compareSignalDecimals(priorVolumeSum, createSignalDecimal('0')) === 0) {
      return finalizeSuppressed(
        evaluation,
        availableReferences,
        input.configuration,
        'unusable_volume_baseline',
      );
    }
    const { high } = extrema(highs.length === lows.length ? highs : []);
    const lowExtrema = extrema(lows);
    return finalizeReady(
      evaluation,
      availableReferences,
      input.configuration,
      high,
      lowExtrema.low,
      priorVolumeSum,
    );
  } catch (error) {
    if (error instanceof SignalError && error.code === 'invariant_violation') throw error;
    return finalizeSuppressed(
      evaluation,
      availableReferences,
      input.configuration,
      'arithmetic_overflow',
    );
  }
}

/**
 * Returns the current canonical evaluation bars whose bounded reference window
 * can change when the supplied canonical bar changes.
 */
export function affectedEvaluationEventIds(input: {
  readonly canonicalBars: readonly OneMinuteBarEvent[];
  readonly changedEventId: string;
  readonly lookbackBars: number;
  readonly calendar?: MarketSessionCalendar;
}): readonly string[] {
  if (
    !Number.isSafeInteger(input.lookbackBars) ||
    input.lookbackBars < 1 ||
    input.lookbackBars > MAX_LOOKBACK_BARS
  ) {
    throw new SignalError('invariant_violation');
  }
  const calendar = input.calendar ?? NYSE_CORE_SESSION_CALENDAR;
  const projection = canonicalProjection(input.canonicalBars);
  validateCanonicalSession(projection, calendar);
  const changed = projection.find((bar) => bar.eventId === input.changedEventId);
  if (changed === undefined) throw new SignalError('invariant_violation');
  const changedSession = calendar.classify(changed.barStart);
  if (changedSession.state !== 'open') throw new SignalError('invariant_violation');
  const lower = utcEpochMilliseconds(changed.barStart);
  const upper = lower + input.lookbackBars * 60_000;
  return Object.freeze(
    projection
      .filter((bar) => {
        const session = calendar.classify(bar.barStart);
        const start = utcEpochMilliseconds(bar.barStart);
        return (
          instrumentKey(bar.instrument) === instrumentKey(changed.instrument) &&
          session.state === 'open' &&
          session.calendarDate === changedSession.calendarDate &&
          start >= lower &&
          start <= upper
        );
      })
      .map((bar) => bar.eventId),
  );
}
