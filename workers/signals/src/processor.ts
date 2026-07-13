import type { Clock, UtcTimestamp } from '@daily-trader/domain';
import {
  MAX_FEATURE_STATE_BARS_PER_INSTRUMENT,
  affectedEvaluationEventIds,
  computeFeatureResult,
  evaluateBreakoutPlusVolume,
  type FeatureResult,
  type SignalConfiguration,
  type SignalEvaluation,
} from '@daily-trader/signals';
import {
  NYSE_CORE_SESSION_CALENDAR,
  utcEpochMilliseconds,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';

import { SignalsWorkerError } from './errors.js';
import type { SignalMetrics } from './metrics.js';
import type { JournalRevision, LiveRunClaim, SignalsRepository } from './persistence/repository.js';

function symbol(event: OneMinuteBarEvent): string {
  return event.instrument.symbol;
}

function influenceEndsBeforeBoundary(
  event: OneMinuteBarEvent,
  lookbackBars: number,
  boundary: UtcTimestamp,
): boolean {
  return (
    utcEpochMilliseconds(event.barStart) + lookbackBars * 60_000 < utcEpochMilliseconds(boundary)
  );
}

/** Maintains only a disposable cache; durable reconstruction always starts at the repository. */
export class LiveJournalProcessor {
  readonly #repository: SignalsRepository;
  readonly #configuration: SignalConfiguration;
  readonly #queueCapacity: number;
  readonly #clock: Clock;
  readonly #boundaries: ReadonlyMap<string, UtcTimestamp>;
  readonly #metrics: SignalMetrics | undefined;
  #claim: LiveRunClaim;

  private constructor(input: {
    readonly repository: SignalsRepository;
    readonly configuration: SignalConfiguration;
    readonly queueCapacity: number;
    readonly clock: Clock;
    readonly claim: LiveRunClaim;
    readonly boundaries: ReadonlyMap<string, UtcTimestamp>;
    readonly metrics?: SignalMetrics;
  }) {
    this.#repository = input.repository;
    this.#configuration = input.configuration;
    this.#queueCapacity = input.queueCapacity;
    this.#clock = input.clock;
    this.#claim = input.claim;
    this.#boundaries = input.boundaries;
    this.#metrics = input.metrics;
  }

  public static async create(input: {
    readonly repository: SignalsRepository;
    readonly configuration: SignalConfiguration;
    readonly queueCapacity: number;
    readonly clock: Clock;
    readonly claim: LiveRunClaim;
    readonly metrics?: SignalMetrics;
  }): Promise<LiveJournalProcessor> {
    const boundaries = await input.repository.boundaries(input.claim.runId);
    return new LiveJournalProcessor({ ...input, boundaries });
  }

  public get claim(): LiveRunClaim {
    return this.#claim;
  }

  public async process(revision: JournalRevision): Promise<readonly SignalEvaluation[]> {
    const session = NYSE_CORE_SESSION_CALENDAR.classify(revision.event.barStart);
    if (session.state !== 'open') throw new SignalsWorkerError('stored_data_invalid');
    const revisionSymbol = String(revision.event.instrument.symbol);
    if (revisionSymbol !== 'AAPL' && revisionSymbol !== 'SPY') {
      throw new SignalsWorkerError('stored_data_invalid');
    }
    const revisionBoundary = this.#boundaries.get(revisionSymbol);
    if (revisionBoundary === undefined) throw new SignalsWorkerError('stored_data_invalid');
    const loadSessionBars = (): Promise<readonly OneMinuteBarEvent[]> =>
      this.#repository.loadSessionBars(this.#claim, revisionSymbol, session.calendarDate);
    const sessionBars =
      this.#metrics === undefined
        ? await loadSessionBars()
        : await this.#metrics.measureReconstruction(loadSessionBars);
    if (sessionBars.length > MAX_FEATURE_STATE_BARS_PER_INSTRUMENT) {
      this.#metrics?.recordCapacity('feature_state', 'exceeded');
      throw new SignalsWorkerError('capacity_exceeded');
    }
    this.#metrics?.recordCapacity('feature_state', 'within_limit');
    const barsByKey = new Map(sessionBars.map((bar) => [bar.orderingKey, bar]));
    if (barsByKey.size !== sessionBars.length) throw new SignalsWorkerError('stored_data_invalid');
    const prior = barsByKey.get(revision.event.orderingKey);
    if (revision.revision.operation === 'insert' && prior !== undefined) {
      throw new SignalsWorkerError('stored_data_invalid');
    }
    if (
      revision.revision.operation === 'replace' &&
      prior?.eventId !== revision.revision.previousCanonicalEventId
    ) {
      if (
        prior === undefined &&
        influenceEndsBeforeBoundary(
          revision.event,
          this.#configuration.lookbackBars,
          revisionBoundary,
        )
      ) {
        const evaluations = Object.freeze([]) as readonly SignalEvaluation[];
        this.#claim = await this.#repository.commitRevision(
          this.#claim,
          revision,
          evaluations,
          this.#clock,
        );
        return evaluations;
      }
      throw new SignalsWorkerError('stored_data_invalid');
    }
    const next = new Map(barsByKey);
    next.set(revision.event.orderingKey, revision.event);
    if (next.size > MAX_FEATURE_STATE_BARS_PER_INSTRUMENT) {
      this.#metrics?.recordCapacity('feature_state', 'exceeded');
      throw new SignalsWorkerError('capacity_exceeded');
    }
    const bars = Object.freeze([...next.values()]);
    const affected = affectedEvaluationEventIds({
      canonicalBars: bars,
      changedEventId: revision.event.eventId,
      lookbackBars: this.#configuration.lookbackBars,
    });
    if (affected.length > this.#queueCapacity) {
      this.#metrics?.recordCapacity('evaluation_queue', 'exceeded');
      throw new SignalsWorkerError('capacity_exceeded');
    }
    this.#metrics?.recordCapacity('evaluation_queue', 'within_limit');
    const evaluations: SignalEvaluation[] = [];
    for (const eventId of affected) {
      const evaluationBar = bars.find((bar) => bar.eventId === eventId);
      if (evaluationBar === undefined) throw new SignalsWorkerError('stored_data_invalid');
      const boundary = this.#boundaries.get(symbol(evaluationBar));
      if (boundary === undefined) throw new SignalsWorkerError('stored_data_invalid');
      if (evaluationBar.barStart < boundary) continue;
      const computeFeature = (): FeatureResult =>
        computeFeatureResult({
          canonicalBars: bars,
          evaluationEventId: eventId,
          configuration: this.#configuration,
        });
      const feature =
        this.#metrics === undefined
          ? computeFeature()
          : this.#metrics.measureFeature(computeFeature);
      const evaluate = (): SignalEvaluation =>
        evaluateBreakoutPlusVolume(feature, this.#configuration);
      evaluations.push(
        this.#metrics === undefined ? evaluate() : this.#metrics.measureEvaluation(evaluate),
      );
    }
    this.#claim = await this.#repository.commitRevision(
      this.#claim,
      revision,
      evaluations,
      this.#clock,
    );
    return Object.freeze(evaluations);
  }
}
