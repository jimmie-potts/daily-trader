import {
  MARKET_DATA_SCHEMA_VERSION,
  NYSE_CORE_SESSION_CALENDAR,
  MarketEventOrderingTracker,
  createCanonicalRevision,
  decideCanonicalTransition,
  utcEpochMilliseconds,
  type CanonicalRevision,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';

import { type SignalConfiguration } from '../configuration.js';
import { type SignalEvaluation } from '../contracts.js';
import { evaluateBreakoutPlusVolume } from '../evaluation.js';
import { SignalError } from '../errors.js';
import { affectedEvaluationEventIds, computeFeatureResult } from '../features.js';
import { sha256Canonical } from '../identity.js';
import { serializeSignalEvaluation } from '../serialization.js';
import { createSignalTransition } from '../transitions.js';
import { isVerifiedSignalReplayRecording } from './recording.js';
import {
  MAX_SIGNAL_REPLAY_ASSOCIATIONS,
  SIGNAL_REPLAY_OUTPUT_VERSION,
  type SignalReplayActiveOccurrence,
  type SignalReplayArtifact,
  type SignalReplayAssociation,
  type SignalReplayCanonicalOutput,
  type SignalReplayLatestEvaluation,
  type SignalReplayPersistencePort,
  type SignalReplayProjection,
  type SignalReplayTargetDescriptor,
  type VerifiedSignalReplayRecording,
} from './types.js';

interface LatestState {
  readonly targetOrdinal: number;
  readonly evaluation: SignalEvaluation;
}

function targetId(inputChecksum: string): string {
  return `signal-replay-${inputChecksum}`;
}

function seriesKey(event: OneMinuteBarEvent): string {
  return `${event.instrument.venue}:${event.instrument.symbol}|${event.interval}`;
}

function compareCanonical(left: OneMinuteBarEvent, right: OneMinuteBarEvent): number {
  const leftSeries = seriesKey(left);
  const rightSeries = seriesKey(right);
  if (leftSeries !== rightSeries) return leftSeries < rightSeries ? -1 : 1;
  return utcEpochMilliseconds(left.barStart) - utcEpochMilliseconds(right.barStart);
}

function updateSortedCanonical(
  bars: OneMinuteBarEvent[],
  event: OneMinuteBarEvent,
  operation: 'insert' | 'replace',
): void {
  let lower = 0;
  let upper = bars.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const candidate = bars[middle];
    if (candidate === undefined) throw new SignalError('invariant_violation');
    if (compareCanonical(candidate, event) < 0) lower = middle + 1;
    else upper = middle;
  }
  const current = bars[lower];
  if (operation === 'replace') {
    if (current?.orderingKey !== event.orderingKey) {
      throw new SignalError('invariant_violation');
    }
    bars[lower] = event;
    return;
  }
  if (current?.orderingKey === event.orderingKey) {
    throw new SignalError('invariant_violation');
  }
  bars.splice(lower, 0, event);
}

function canonicalOutput(
  unsigned: Omit<SignalReplayCanonicalOutput, 'checksum'>,
): SignalReplayCanonicalOutput {
  return Object.freeze({ ...unsigned, checksum: sha256Canonical(JSON.stringify(unsigned)) });
}

export function serializeSignalReplayOutput(output: SignalReplayCanonicalOutput): string {
  const { checksum, ...unsigned } = output;
  if (sha256Canonical(JSON.stringify(unsigned)) !== checksum) {
    throw new SignalError('replay_invalid');
  }
  return `${JSON.stringify(output, null, 2)}\n`;
}

function revisionFor(input: {
  readonly event: OneMinuteBarEvent;
  readonly operation: 'insert' | 'replace';
  readonly previousCanonicalEventId: string | null;
  readonly scheduleOrdinal: number;
  readonly classification: 'accepted' | 'correction' | 'out_of_order';
  readonly historical: boolean;
  readonly gapState: 'complete' | 'gapped' | 'unknown';
  readonly filledKnownGap: boolean;
}): CanonicalRevision {
  const common = {
    processingPosition: String(input.scheduleOrdinal),
    logicalBarKey: input.event.orderingKey,
    newCanonicalEventId: input.event.eventId,
    marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    arrival: {
      classification: input.classification,
      historical: input.historical,
      outOfOrder: input.classification === 'out_of_order',
    },
    gap: { state: input.gapState, filledKnownGap: input.filledKnownGap },
  } as const;
  return input.operation === 'insert'
    ? createCanonicalRevision({ ...common, operation: 'insert', previousCanonicalEventId: null })
    : createCanonicalRevision({
        ...common,
        operation: 'replace',
        previousCanonicalEventId: input.previousCanonicalEventId,
      });
}

/** Runs verified input through production canonicalization and signal constructors. */
export function projectVerifiedSignalReplay(
  recording: VerifiedSignalReplayRecording,
): SignalReplayProjection {
  if (!isVerifiedSignalReplayRecording(recording)) throw new SignalError('replay_invalid');
  const configuration: SignalConfiguration = recording.manifest.configuration;
  const byEventId = new Map(recording.catalog.events.map((event) => [event.eventId, event]));
  const canonical = new Map<string, OneMinuteBarEvent>();
  const canonicalBars: OneMinuteBarEvent[] = [];
  const ordering = new MarketEventOrderingTracker({
    freshnessThresholdMs: configuration.freshnessThresholdMs,
    maximumTrackedEvents: recording.catalog.events.length,
  });
  const knownGapStarts = new Set<string>();
  const gapStateByOrderingKey = new Map<string, 'complete' | 'gapped' | 'unknown'>();
  const frontierBySeries = new Map<string, number>();
  const latest = new Map<string, LatestState>();
  const artifacts: SignalReplayArtifact[] = [];
  let noOpCount = 0;
  let revisionCount = 0;
  let targetOrdinal = 0;

  for (const scheduleEntry of recording.schedule.entries) {
    const event = byEventId.get(scheduleEntry.eventId);
    if (event === undefined) throw new SignalError('replay_invalid');
    const session = NYSE_CORE_SESSION_CALENDAR.classify(event.barStart);
    if (session.state !== 'open') throw new SignalError('invariant_violation');
    const order = ordering.classify(event, event.receivedAt);
    if (
      order.classification === 'accepted' &&
      order.gap.firstMissingBarStart !== undefined &&
      order.gap.lastMissingBarStart !== undefined
    ) {
      const last = utcEpochMilliseconds(order.gap.lastMissingBarStart);
      for (
        let epoch = utcEpochMilliseconds(order.gap.firstMissingBarStart);
        epoch <= last;
        epoch += 60_000
      ) {
        knownGapStarts.add(`${seriesKey(event)}|${new Date(epoch).toISOString()}`);
      }
    }
    const current = canonical.get(event.orderingKey);
    const decision = decideCanonicalTransition({
      currentCanonical: current,
      candidate: event,
      candidateEligible: true,
    });
    if (decision.operation === 'no_op') {
      noOpCount += 1;
      continue;
    }
    revisionCount += 1;
    const eventSeries = seriesKey(event);
    const eventStart = utcEpochMilliseconds(event.barStart);
    const frontier = frontierBySeries.get(eventSeries);
    const historical = frontier !== undefined && frontier > eventStart;
    const filledKnownGap =
      decision.operation === 'insert' &&
      knownGapStarts.delete(`${seriesKey(event)}|${event.barStart}`);
    const revisionGapState =
      decision.operation === 'replace'
        ? (gapStateByOrderingKey.get(event.orderingKey) ?? 'unknown')
        : filledKnownGap
          ? 'gapped'
          : order.gap.state;
    const classification =
      decision.operation === 'replace'
        ? ('correction' as const)
        : order.classification === 'out_of_order'
          ? ('out_of_order' as const)
          : ('accepted' as const);
    const revision = revisionFor({
      event,
      operation: decision.operation,
      previousCanonicalEventId: decision.previousCanonicalEventId,
      scheduleOrdinal: scheduleEntry.targetOrdinal,
      classification,
      historical,
      gapState: revisionGapState,
      filledKnownGap,
    });
    canonical.set(event.orderingKey, event);
    updateSortedCanonical(canonicalBars, event, decision.operation);
    if (frontier === undefined || eventStart > frontier) {
      frontierBySeries.set(eventSeries, eventStart);
    }
    if (decision.operation === 'insert') {
      gapStateByOrderingKey.set(event.orderingKey, revisionGapState);
    }
    const bars = Object.freeze([...canonicalBars]);
    const affected = affectedEvaluationEventIds({
      canonicalBars: bars,
      changedEventId: event.eventId,
      lookbackBars: configuration.lookbackBars,
    });
    for (const evaluationEventId of affected) {
      const featureResult = computeFeatureResult({
        canonicalBars: bars,
        evaluationEventId,
        configuration,
      });
      const evaluation = evaluateBreakoutPlusVolume(featureResult, configuration);
      const evaluationBarKey = bars.find(
        ({ eventId }) => eventId === evaluationEventId,
      )?.orderingKey;
      if (evaluationBarKey === undefined) throw new SignalError('invariant_violation');
      const predecessor = latest.get(evaluationBarKey)?.evaluation;
      if (predecessor?.evaluationId === evaluation.evaluationId) continue;
      if (targetOrdinal >= MAX_SIGNAL_REPLAY_ASSOCIATIONS) {
        throw new SignalError('replay_invalid');
      }
      targetOrdinal += 1;
      const transition = createSignalTransition({
        signalRunId: targetId(recording.inputChecksum),
        triggeringRevisionId: revision.revisionId,
        processingPosition: String(targetOrdinal),
        current: evaluation,
        ...(predecessor === undefined ? {} : { predecessor }),
      });
      const association = Object.freeze({
        targetOrdinal,
        scheduleOrdinal: scheduleEntry.targetOrdinal,
        triggeringRevisionId: revision.revisionId,
        evaluationBarKey,
        featureResultId: featureResult.featureResultId,
        evaluationId: evaluation.evaluationId,
        outcome: evaluation.outcome,
        transitionKind: transition.kind,
        ...(evaluation.outcome === 'fired'
          ? { occurrenceId: evaluation.occurrence.occurrenceId }
          : {}),
        ...(transition.retractedOccurrenceId === undefined
          ? {}
          : { retractedOccurrenceId: transition.retractedOccurrenceId }),
      } satisfies SignalReplayAssociation);
      artifacts.push(Object.freeze({ association, featureResult, evaluation, transition }));
      latest.set(evaluationBarKey, { targetOrdinal, evaluation });
    }
  }

  const latestEvaluations: readonly SignalReplayLatestEvaluation[] = Object.freeze(
    [...latest.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([evaluationBarKey, state]) =>
        Object.freeze({
          evaluationBarKey,
          targetOrdinal: state.targetOrdinal,
          evaluation: JSON.parse(serializeSignalEvaluation(state.evaluation)) as SignalEvaluation,
        }),
      ),
  );
  const activeFiredHistory: readonly SignalReplayActiveOccurrence[] = Object.freeze(
    latestEvaluations.flatMap((item) =>
      item.evaluation.outcome === 'fired'
        ? [
            Object.freeze({
              evaluationBarKey: item.evaluationBarKey,
              targetOrdinal: item.targetOrdinal,
              occurrence: item.evaluation.occurrence,
            }),
          ]
        : [],
    ),
  );
  const unsigned: Omit<SignalReplayCanonicalOutput, 'checksum'> = {
    version: SIGNAL_REPLAY_OUTPUT_VERSION,
    targetId: targetId(recording.inputChecksum),
    inputChecksum: recording.inputChecksum,
    configurationHash: configuration.configurationHash,
    catalogEventCount: recording.catalog.events.length,
    scheduleEntryCount: recording.schedule.entries.length,
    processedScheduleEntryCount: recording.schedule.entries.length,
    canonicalRevisionCount: revisionCount,
    canonicalNoOpCount: noOpCount,
    associations: Object.freeze(artifacts.map(({ association }) => association)),
    latestEvaluations,
    activeFiredHistory,
  };
  const output = canonicalOutput(unsigned);
  return Object.freeze({
    output,
    serializedOutput: serializeSignalReplayOutput(output),
    artifacts: Object.freeze(artifacts),
  });
}

export function verifySignalReplayProjection(
  projection: SignalReplayProjection,
  expectedChecksum: string,
): void {
  if (projection.output.checksum !== expectedChecksum) throw new SignalError('replay_invalid');
  serializeSignalReplayOutput(projection.output);
}

export async function persistVerifiedSignalReplay(
  recording: VerifiedSignalReplayRecording,
  port: SignalReplayPersistencePort,
): Promise<SignalReplayProjection> {
  const projection = projectVerifiedSignalReplay(recording);
  verifySignalReplayProjection(projection, recording.manifest.expectedOutputChecksum);
  const descriptor: SignalReplayTargetDescriptor = Object.freeze({
    targetId: projection.output.targetId,
    inputChecksum: recording.inputChecksum,
    configuration: recording.manifest.configuration,
    manifest: recording.manifest,
    expectedAssociationCount: projection.artifacts.length,
    expectedOutputChecksum: recording.manifest.expectedOutputChecksum,
    outputVersion: SIGNAL_REPLAY_OUTPUT_VERSION,
  });
  try {
    await port.beginTarget(descriptor);
    for (const artifact of projection.artifacts) {
      await port.persistAssociation(descriptor.targetId, artifact);
    }
    await port.completeTarget(descriptor.targetId, projection.output);
  } catch {
    try {
      await port.failTarget(descriptor.targetId);
    } catch {
      // Keep the classified replay failure authoritative and omit sink detail.
    }
    throw new SignalError('replay_sink_failed');
  }
  return projection;
}
