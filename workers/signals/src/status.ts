import type { Clock, UtcTimestamp } from '@daily-trader/domain';
import {
  NYSE_CORE_SESSION_CALENDAR,
  PHASE_2_INSTRUMENTS,
  classifyMarketDataFreshness,
  utcEpochMilliseconds,
  type MarketSessionCalendar,
  type OneMinuteBarEvent,
  type SupportedMarketDataSymbol,
} from '@daily-trader/market-data';

import type { PersistedSignalStatus, SignalStatusEvaluation } from './persistence/repository.js';

function value(label: string, current: string | number | null): string {
  return `${label}: ${current ?? 'unavailable'}`;
}

function appendOptional(lines: string[], label: string, current: string | number | null): void {
  if (current !== null) lines.push(value(label, current));
}

function inputEligibility(mode: string): string {
  return mode === 'on_time' ? 'on-time eligible' : 'retrospective only';
}

function appendEvaluation(lines: string[], evaluation: SignalStatusEvaluation): void {
  lines.push(
    value('outcome', evaluation.outcome),
    value('reason', evaluation.reason),
    value('evaluation bar', evaluation.evaluationBarStart),
    value('observation as of', evaluation.observationAsOf),
    value('knowledge as of', evaluation.knowledgeAsOf),
    value('mode', evaluation.mode),
    value('signal input eligibility', inputEligibility(evaluation.mode)),
    value('source provider', evaluation.sourceProvider),
    value('source feed', evaluation.sourceFeed),
    value('source entitlement', evaluation.sourceEntitlement),
  );
  appendOptional(lines, 'close USD/share', evaluation.closePrice);
  appendOptional(lines, 'prior high USD/share', evaluation.priorHigh);
  appendOptional(lines, 'prior low USD/share', evaluation.priorLow);
  appendOptional(lines, 'breakout reference USD/share', evaluation.breakoutReference);
  appendOptional(lines, 'current volume shares', evaluation.currentVolume);
  appendOptional(lines, 'prior volume sum shares', evaluation.priorVolumeSum);
  appendOptional(lines, 'prior volume count', evaluation.priorCount);
  appendOptional(lines, 'volume multiplier', evaluation.volumeMultiplier);
  appendOptional(lines, 'window start', evaluation.windowStart);
  appendOptional(lines, 'window end', evaluation.windowEnd);
  if (evaluation.outcome === 'fired') {
    appendOptional(lines, 'direction', evaluation.direction);
    appendOptional(lines, 'invalidation', evaluation.invalidationCondition);
  }
}

function workerHeartbeat(
  heartbeatAt: UtcTimestamp | null,
  observedAt: UtcTimestamp,
  staleAfterMs: number,
): Readonly<{ freshness: string; ageMs: number | null }> {
  if (heartbeatAt === null) return Object.freeze({ freshness: 'unavailable', ageMs: null });
  const ageMs = utcEpochMilliseconds(observedAt) - utcEpochMilliseconds(heartbeatAt);
  return Object.freeze({
    freshness: ageMs < 0 ? 'future' : ageMs > staleAfterMs ? 'stale' : 'current',
    ageMs,
  });
}

function workerProcessingLag(status: PersistedSignalStatus): string {
  if (status.runId === null) return 'unavailable';
  const suffix = status.backlogCount === '1' ? 'revision' : 'revisions';
  return status.revisionGapDetected
    ? `${status.backlogCount} pending canonical ${suffix}; blocked by revision gap`
    : `${status.backlogCount} pending canonical ${suffix}`;
}

function marketDataLines(
  symbol: SupportedMarketDataSymbol,
  event: OneMinuteBarEvent | undefined,
  observedAt: UtcTimestamp,
  freshnessThresholdMs: number | null,
  calendar: MarketSessionCalendar,
): readonly string[] {
  const venue = PHASE_2_INSTRUMENTS[symbol].venue;
  const lines = [`${symbol}/${venue} market data — IEX single-exchange`];
  if (event === undefined) {
    lines.push('latest canonical bar end: missing');
  } else {
    lines.push(value('latest canonical bar end', event.barEnd));
    lines.push(
      value(
        'market-data age ms',
        utcEpochMilliseconds(observedAt) - utcEpochMilliseconds(event.barEnd),
      ),
    );
  }
  if (freshnessThresholdMs === null) {
    lines.push(
      'market-data freshness: unavailable',
      'persisted freshness threshold ms: unavailable',
    );
    return Object.freeze(lines);
  }
  lines.push(
    value(
      'market-data freshness',
      classifyMarketDataFreshness(event, observedAt, calendar, freshnessThresholdMs).state,
    ),
    value('persisted freshness threshold ms', freshnessThresholdMs),
  );
  return Object.freeze(lines);
}

export function renderSignalStatus(
  status: PersistedSignalStatus,
  clock: Clock,
  staleAfterMs = 60_000,
  calendar: MarketSessionCalendar = NYSE_CORE_SESSION_CALENDAR,
): string {
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) {
    throw new TypeError('staleAfterMs must be a nonnegative safe integer');
  }
  const observedAt = clock.now();
  const heartbeat = workerHeartbeat(status.heartbeatAt, observedAt, staleAfterMs);
  const lines = [
    'LIVE SIGNAL OBSERVATIONS — not recommendations or position actions',
    value('as of', observedAt),
    value('worker', status.lifecycle),
    value('postgres persistence', 'healthy'),
    value('run', status.runId),
    value('run state', status.runState),
    value('cursor', status.cursorPosition),
    value('frozen stop', status.stopPosition),
    value('revision backlog', status.backlogCount),
    value('revision gap', status.revisionGapDetected ? 'detected' : 'none'),
    value('worker processing lag', workerProcessingLag(status)),
    value('worker heartbeat', status.heartbeatAt),
    value('worker heartbeat age ms', heartbeat.ageMs),
    value('worker heartbeat freshness', heartbeat.freshness),
    value('last durable evaluation bar', status.lastEvaluatedBarStart),
  ];
  if (status.failureCode !== null) lines.push(value('failure', status.failureCode));
  if (status.semantics !== null) {
    lines.push(
      value('definition version', status.semantics.definitionVersion),
      value('configuration version', status.semantics.configurationVersion),
      value('configuration hash', status.semantics.configurationHash),
      value('arithmetic policy', status.semantics.arithmeticPolicyVersion),
      value('calendar', status.semantics.calendarVersion),
      value('market event schema', status.semantics.marketEventSchemaVersion),
      value('canonical revision schema', status.semantics.revisionSchemaVersion),
      value('feature schema', status.semantics.featureSchemaVersion),
      value('evaluation schema', status.semantics.evaluationSchemaVersion),
      value('data quality policy', status.semantics.dataQualityPolicyVersion),
      value('freshness threshold ms', status.semantics.freshnessThresholdMs),
      value('lookback bars', status.semantics.lookbackBars),
      value('configured volume multiplier', status.semantics.volumeMultiplier),
    );
  }

  for (const symbol of ['AAPL', 'SPY'] as const) {
    const marketData = status.latestMarketData[symbol];
    lines.push(
      '',
      ...marketDataLines(
        symbol,
        marketData?.event,
        observedAt,
        marketData?.freshnessThresholdMs ?? status.semantics?.freshnessThresholdMs ?? null,
        calendar,
      ),
    );
  }

  const presentSymbols = new Set(status.latest.map(({ symbol }) => symbol));
  for (const symbol of ['AAPL', 'SPY'] as const) {
    if (!presentSymbols.has(symbol)) lines.push('', `${symbol}: warming-up or missing`);
  }
  for (const evaluation of status.latest) {
    lines.push('', `${evaluation.symbol}/${evaluation.venue} — IEX single-exchange observation`);
    appendEvaluation(lines, evaluation);
  }
  for (const occurrence of status.latestValidFired) {
    lines.push(
      '',
      `${occurrence.symbol}/${occurrence.venue} latest valid historical fired observation`,
    );
    appendEvaluation(lines, occurrence);
  }
  return `${lines.join('\n')}\n`;
}
