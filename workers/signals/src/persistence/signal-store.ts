import {
  serializeSignalEvaluation,
  type SignalEvaluation,
  type SignalEvaluationTransition,
} from '@daily-trader/signals';

import type { SqlQueryable } from './sql.js';

export type SignalPersistenceInvariantError = (cause?: unknown) => Error;

function invalid(createInvariantError: SignalPersistenceInvariantError, field: string): never {
  throw createInvariantError(new TypeError(`invalid stored ${field}`));
}

function storedText(
  value: unknown,
  field: string,
  createInvariantError: SignalPersistenceInvariantError,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    return invalid(createInvariantError, field);
  }
  return value;
}

function storedInteger(
  value: unknown,
  field: string,
  createInvariantError: SignalPersistenceInvariantError,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return invalid(createInvariantError, field);
  }
  return value;
}

/**
 * Shared live/replay sink for globally deterministic evaluation content.
 * Existing rows must match exactly; idempotency never accepts partial evidence
 * or a conflicting occurrence payload.
 */
export async function persistSignalEvaluation(
  queryable: SqlQueryable,
  evaluation: SignalEvaluation,
  createInvariantError: SignalPersistenceInvariantError,
): Promise<void> {
  const feature = evaluation.featureResult;
  const ready = feature.kind === 'ready' ? feature : null;
  const comparison = evaluation.outcome === 'suppressed' ? null : evaluation.volumeComparison;
  const occurrence = evaluation.outcome === 'fired' ? evaluation.occurrence : null;
  const payload = serializeSignalEvaluation(evaluation);
  const insertedEvaluation = await queryable.query(
    `/* signal-store:insert-evaluation */
     INSERT INTO signal_evaluations (
       evaluation_id, feature_result_id, schema_version, definition_version,
       configuration_version, configuration_hash, instrument_symbol, instrument_venue,
       evaluation_event_id, evaluation_bar_start, observation_as_of, knowledge_as_of,
       evaluation_mode, outcome, reason, direction, invalidation_condition,
       close_price, current_volume, breakout_reference, prior_high, prior_low,
       prior_volume_sum, prior_count, volume_multiplier, window_start, window_end,
       source_provider, source_feed, source_entitlement, canonical_payload
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
     ) ON CONFLICT (evaluation_id) DO NOTHING
     RETURNING evaluation_id`,
    [
      evaluation.evaluationId,
      feature.featureResultId,
      evaluation.schemaVersion,
      evaluation.definitionVersion,
      feature.semantics.configurationVersion,
      feature.semantics.configurationHash,
      feature.instrument.symbol,
      feature.instrument.venue,
      feature.evaluationBar.eventId,
      feature.evaluationBar.barStart,
      feature.observationAsOf,
      feature.knowledgeAsOf,
      feature.mode,
      evaluation.outcome,
      evaluation.outcome === 'fired' ? evaluation.occurrence.reason : evaluation.reason,
      evaluation.outcome === 'fired' ? evaluation.direction : null,
      occurrence === null ? null : JSON.stringify(occurrence.invalidationCondition),
      feature.evaluationBar.close,
      feature.evaluationBar.volume,
      occurrence?.breakoutReference ?? null,
      ready?.priorRange.high ?? null,
      ready?.priorRange.low ?? null,
      ready?.priorVolume.sum ?? null,
      ready?.priorVolume.count ?? null,
      comparison?.multiplier ?? null,
      ready?.window.firstBarStart ?? null,
      ready?.window.lastBarStart ?? null,
      feature.source.provider,
      feature.source.feed,
      feature.source.entitlement,
      payload,
    ],
  );
  const stored = await queryable.query<{ readonly canonical_payload: unknown }>(
    `/* signal-store:select-evaluation */
     SELECT canonical_payload FROM signal_evaluations WHERE evaluation_id = $1`,
    [evaluation.evaluationId],
  );
  if (stored.rows.length !== 1 || stored.rows[0]?.canonical_payload !== payload) {
    throw createInvariantError();
  }

  if (insertedEvaluation.rowCount !== 0 && insertedEvaluation.rowCount !== 1) {
    throw createInvariantError();
  }
  if (insertedEvaluation.rowCount === 1) {
    for (const evidence of feature.evidence) {
      await queryable.query(
        `/* signal-store:insert-evidence */
         INSERT INTO signal_evaluation_evidence (evaluation_id, role, ordinal, event_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [evaluation.evaluationId, evidence.role, evidence.ordinal, evidence.eventId],
      );
    }
  }
  const evidenceRows = await queryable.query<{
    readonly role: unknown;
    readonly ordinal: unknown;
    readonly event_id: unknown;
  }>(
    `/* signal-store:select-evidence */
     SELECT role, ordinal, event_id FROM signal_evaluation_evidence
     WHERE evaluation_id = $1 ORDER BY role, ordinal`,
    [evaluation.evaluationId],
  );
  const expectedEvidence = [...feature.evidence]
    .map(({ role, ordinal, eventId }) => ({ role, ordinal, eventId }))
    .sort((left, right) => left.role.localeCompare(right.role) || left.ordinal - right.ordinal);
  const actualEvidence = evidenceRows.rows.map((row) => ({
    role: storedText(row.role, 'evidence role', createInvariantError),
    ordinal: storedInteger(row.ordinal, 'evidence ordinal', createInvariantError),
    eventId: storedText(row.event_id, 'evidence event id', createInvariantError),
  }));
  if (JSON.stringify(actualEvidence) !== JSON.stringify(expectedEvidence)) {
    throw createInvariantError();
  }

  const occurrencePayload = occurrence === null ? null : JSON.stringify(occurrence);
  if (occurrence !== null && insertedEvaluation.rowCount === 1) {
    await queryable.query(
      `/* signal-store:insert-occurrence */
       INSERT INTO signal_occurrences
         (occurrence_id, evaluation_id, direction, canonical_payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (occurrence_id) DO NOTHING`,
      [occurrence.occurrenceId, evaluation.evaluationId, occurrence.direction, occurrencePayload],
    );
  }
  const storedOccurrences = await queryable.query<{
    readonly occurrence_id: unknown;
    readonly direction: unknown;
    readonly canonical_payload: unknown;
  }>(
    `/* signal-store:select-occurrence */
     SELECT occurrence_id, direction, canonical_payload
     FROM signal_occurrences WHERE evaluation_id = $1
     ORDER BY occurrence_id`,
    [evaluation.evaluationId],
  );
  if (occurrence === null) {
    if (storedOccurrences.rows.length !== 0) throw createInvariantError();
    return;
  }
  const storedOccurrence = storedOccurrences.rows[0];
  if (
    storedOccurrences.rows.length !== 1 ||
    storedOccurrence === undefined ||
    storedText(storedOccurrence.occurrence_id, 'occurrence id', createInvariantError) !==
      occurrence.occurrenceId ||
    storedText(storedOccurrence.direction, 'occurrence direction', createInvariantError) !==
      occurrence.direction ||
    storedOccurrence.canonical_payload !== occurrencePayload
  ) {
    throw createInvariantError();
  }
}

/** Shared live/replay association sink; source-specific cursor fencing stays with each owner. */
export async function persistSignalRunAssociation(
  queryable: SqlQueryable,
  input: {
    readonly runId: string;
    readonly sourceKind: 'live_journal' | 'replay_schedule';
    readonly sourceOrdinal: string;
    readonly transitionOrdinal: number;
    readonly transition: SignalEvaluationTransition;
    readonly evaluation: SignalEvaluation;
  },
): Promise<void> {
  const occurrenceId =
    input.evaluation.outcome === 'fired' ? input.evaluation.occurrence.occurrenceId : null;
  await queryable.query(
    `/* signal-store:insert-transition */
     INSERT INTO signal_run_transitions (
       run_id, source_kind, source_ordinal, transition_ordinal, transition_id,
       evaluation_id, occurrence_id, predecessor_evaluation_id,
       retracted_occurrence_id, triggering_revision_id, transition_kind,
       latest_revision_state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.runId,
      input.sourceKind,
      input.sourceOrdinal,
      input.transitionOrdinal,
      input.transition.transitionId,
      input.evaluation.evaluationId,
      occurrenceId,
      input.transition.predecessorEvaluationId ?? null,
      input.transition.retractedOccurrenceId ?? null,
      input.transition.triggeringRevisionId,
      input.transition.kind,
      input.transition.latestRevisionState,
    ],
  );
  const feature = input.evaluation.featureResult;
  await queryable.query(
    `/* signal-store:upsert-latest */
     INSERT INTO signal_run_latest_evaluations (
       run_id, definition_version, configuration_hash, instrument_symbol,
       evaluation_bar_start, evaluation_id, occurrence_id, source_ordinal
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (run_id, definition_version, configuration_hash,
                  instrument_symbol, evaluation_bar_start)
     DO UPDATE SET evaluation_id = EXCLUDED.evaluation_id,
       occurrence_id = EXCLUDED.occurrence_id,
       source_ordinal = EXCLUDED.source_ordinal, updated_at = CURRENT_TIMESTAMP`,
    [
      input.runId,
      input.evaluation.definitionVersion,
      feature.semantics.configurationHash,
      feature.instrument.symbol,
      feature.evaluationBar.barStart,
      input.evaluation.evaluationId,
      occurrenceId,
      input.sourceOrdinal,
    ],
  );
}
