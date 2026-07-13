import { createHash } from 'node:crypto';

import {
  SIGNAL_REPLAY_OUTPUT_VERSION,
  serializeSignalConfiguration,
  serializeSignalEvaluation,
  serializeSignalReplayOutput,
  serializeSignalTransition,
  type SignalEvaluation,
  type SignalReplayArtifact,
  type SignalReplayCanonicalOutput,
  type SignalReplayPersistencePort,
  type SignalReplayTargetDescriptor,
} from '@daily-trader/signals';

import type { SqlClient, SqlPool, SqlQueryable, SqlRow } from '../persistence/sql.js';
import {
  persistSignalEvaluation,
  persistSignalRunAssociation,
} from '../persistence/signal-store.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const TARGET_ID = /^signal-replay-[0-9a-f]{64}$/u;
const REPLAY_OPERATIONAL_VERSION = 'daily-trader.signals.replay-persistence.v1' as const;

export type ReplayPersistenceErrorCode =
  | 'association_invalid'
  | 'completion_invalid'
  | 'cursor_conflict'
  | 'descriptor_invalid'
  | 'persistence_failed'
  | 'stored_data_invalid';

export class ReplayPersistenceError extends Error {
  public readonly code: ReplayPersistenceErrorCode;

  public constructor(code: ReplayPersistenceErrorCode, options?: ErrorOptions) {
    super(`Signal replay persistence failed: ${code}`, options);
    this.name = 'ReplayPersistenceError';
    this.code = code;
  }
}

export interface ReplayOperationalMetadata {
  readonly payload: string;
  readonly hash: string;
  readonly backlogLimit: number;
}

interface Claim {
  readonly descriptor: SignalReplayTargetDescriptor;
  readonly fenceToken: string;
}

interface RunRow extends SqlRow {
  readonly run_id: unknown;
  readonly source_kind: unknown;
  readonly state: unknown;
  readonly configuration_hash: unknown;
  readonly configuration_payload: unknown;
  readonly operational_configuration_hash: unknown;
  readonly operational_configuration_payload: unknown;
  readonly backlog_limit: unknown;
  readonly cursor_position: unknown;
  readonly cursor_value: unknown;
  readonly stop_position: unknown;
  readonly claim_fence: unknown;
  readonly expected_membership_count: unknown;
  readonly replay_catalog_version: unknown;
  readonly replay_catalog_checksum: unknown;
  readonly replay_schedule_version: unknown;
  readonly replay_schedule_checksum: unknown;
  readonly replay_manifest_version: unknown;
  readonly replay_manifest_checksum: unknown;
  readonly expected_output_checksum: unknown;
  readonly replay_output_checksum: unknown;
  readonly replay_output_payload: unknown;
}

export interface ReplayTargetInspection {
  readonly targetId: string;
  readonly state: string;
  readonly cursor: string;
  readonly expectedCount: number;
  readonly failureCode: string | null;
  readonly outputChecksum: string | null;
  readonly outputPayload: string | null;
}

export interface ReplayObservation {
  readonly symbol: string;
  readonly venue: string;
  readonly definitionVersion: string;
  readonly configurationVersion: string;
  readonly configurationHash: string;
  readonly evaluationBarStart: string;
  readonly outcome: string;
  readonly reason: string;
  readonly direction: string | null;
  readonly observationAsOf: string;
  readonly knowledgeAsOf: string;
  readonly mode: string;
  readonly closePrice: string | null;
  readonly breakoutReference: string | null;
  readonly priorHigh: string | null;
  readonly priorLow: string | null;
  readonly currentVolume: string | null;
  readonly priorVolumeSum: string | null;
  readonly priorCount: number | null;
  readonly volumeMultiplier: string | null;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly invalidationCondition: string | null;
  readonly sourceProvider: string;
  readonly sourceFeed: string;
  readonly sourceEntitlement: string;
}

export interface ReplayObservationInspection {
  readonly target: ReplayTargetInspection;
  readonly latest: readonly ReplayObservation[];
  readonly latestValidFired: readonly ReplayObservation[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Fixed target mechanics; this hash is operational metadata, never semantic replay output. */
export function replayOperationalMetadata(
  expectedAssociationCount: number,
): ReplayOperationalMetadata {
  if (
    !Number.isSafeInteger(expectedAssociationCount) ||
    expectedAssociationCount < 0 ||
    expectedAssociationCount > 100_000
  ) {
    throw new ReplayPersistenceError('descriptor_invalid');
  }
  const backlogLimit = Math.max(1, expectedAssociationCount);
  const payload = JSON.stringify({
    schemaVersion: REPLAY_OPERATIONAL_VERSION,
    claimMode: 'transaction_fence',
    backlogLimit,
  });
  return Object.freeze({ payload, hash: sha256(payload), backlogLimit });
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReplayPersistenceError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ReplayPersistenceError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return value;
}

function bigintText(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^(?:0|[1-9]\d*)$/u.test(result)) {
    throw new ReplayPersistenceError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return result;
}

function checksum(value: unknown, field: string): string {
  const result = text(value, field);
  if (!SHA256.test(result)) {
    throw new ReplayPersistenceError('stored_data_invalid', { cause: new TypeError(field) });
  }
  return result;
}

export function replayTimestampText(value: unknown, field: string): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  throw new ReplayPersistenceError('stored_data_invalid', { cause: new TypeError(field) });
}

function validateDescriptor(descriptor: SignalReplayTargetDescriptor): ReplayOperationalMetadata {
  const runtimeOutputVersion: unknown = descriptor.outputVersion;
  if (
    !TARGET_ID.test(descriptor.targetId) ||
    !SHA256.test(descriptor.inputChecksum) ||
    descriptor.targetId !== `signal-replay-${descriptor.inputChecksum}` ||
    !SHA256.test(descriptor.expectedOutputChecksum) ||
    descriptor.expectedOutputChecksum !== descriptor.manifest.expectedOutputChecksum ||
    runtimeOutputVersion !== SIGNAL_REPLAY_OUTPUT_VERSION ||
    descriptor.expectedAssociationCount < 0 ||
    !Number.isSafeInteger(descriptor.expectedAssociationCount)
  ) {
    throw new ReplayPersistenceError('descriptor_invalid');
  }
  const payload = serializeSignalConfiguration(descriptor.configuration);
  if (
    descriptor.configuration.configurationHash !==
      descriptor.manifest.configuration.configurationHash ||
    payload !== serializeSignalConfiguration(descriptor.manifest.configuration)
  ) {
    throw new ReplayPersistenceError('descriptor_invalid');
  }
  return replayOperationalMetadata(descriptor.expectedAssociationCount);
}

function verifyStoredOutput(row: RunRow, descriptor: SignalReplayTargetDescriptor): void {
  const storedChecksum = checksum(row.replay_output_checksum, 'replay_output_checksum');
  const payload = text(row.replay_output_payload, 'replay_output_payload');
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new ReplayPersistenceError('stored_data_invalid', { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ReplayPersistenceError('stored_data_invalid');
  }
  const canonical = parsed as Readonly<Record<string, unknown>>;
  const { checksum: embedded, ...unsigned } = canonical;
  if (
    storedChecksum !== descriptor.expectedOutputChecksum ||
    embedded !== storedChecksum ||
    sha256(JSON.stringify(unsigned)) !== storedChecksum ||
    `${JSON.stringify(canonical, null, 2)}\n` !== payload
  ) {
    throw new ReplayPersistenceError('stored_data_invalid');
  }
}

async function transaction<T>(pool: SqlPool, work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (started) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new ReplayPersistenceError('persistence_failed', { cause: rollbackError });
      }
    }
    if (error instanceof ReplayPersistenceError) throw error;
    throw new ReplayPersistenceError('persistence_failed', { cause: error });
  } finally {
    client.release();
  }
}

function expectedEvaluationBarKey(evaluation: SignalEvaluation): string {
  const feature = evaluation.featureResult;
  return `${feature.instrument.venue}:${feature.instrument.symbol}|1m|${feature.evaluationBar.barStart}`;
}

function validateArtifact(
  descriptor: SignalReplayTargetDescriptor,
  artifact: SignalReplayArtifact,
): void {
  const { association, featureResult, evaluation, transition } = artifact;
  if (
    !Number.isSafeInteger(association.targetOrdinal) ||
    association.targetOrdinal < 1 ||
    association.targetOrdinal > descriptor.expectedAssociationCount ||
    !Number.isSafeInteger(association.scheduleOrdinal) ||
    association.scheduleOrdinal < 1 ||
    association.scheduleOrdinal > descriptor.manifest.scheduleEntryCount ||
    association.evaluationBarKey !== expectedEvaluationBarKey(evaluation) ||
    association.featureResultId !== featureResult.featureResultId ||
    association.evaluationId !== evaluation.evaluationId ||
    evaluation.featureResult.featureResultId !== featureResult.featureResultId ||
    association.outcome !== evaluation.outcome ||
    association.transitionKind !== transition.kind ||
    transition.signalRunId !== descriptor.targetId ||
    transition.processingPosition !== String(association.targetOrdinal) ||
    transition.currentEvaluationId !== evaluation.evaluationId ||
    transition.currentOccurrenceId !==
      (evaluation.outcome === 'fired' ? evaluation.occurrence.occurrenceId : undefined) ||
    transition.triggeringRevisionId !== association.triggeringRevisionId ||
    association.occurrenceId !==
      (evaluation.outcome === 'fired' ? evaluation.occurrence.occurrenceId : undefined) ||
    association.retractedOccurrenceId !== transition.retractedOccurrenceId ||
    featureResult.semantics.configurationHash !== descriptor.configuration.configurationHash
  ) {
    throw new ReplayPersistenceError('association_invalid');
  }
  serializeSignalEvaluation(evaluation);
  serializeSignalTransition(transition);
}

function verifyRun(row: RunRow, descriptor: SignalReplayTargetDescriptor): void {
  const operational = replayOperationalMetadata(descriptor.expectedAssociationCount);
  const configurationPayload = serializeSignalConfiguration(descriptor.configuration);
  const manifest = descriptor.manifest;
  if (
    text(row.run_id, 'run_id') !== descriptor.targetId ||
    text(row.source_kind, 'source_kind') !== 'replay_schedule' ||
    text(row.configuration_hash, 'configuration_hash') !==
      descriptor.configuration.configurationHash ||
    text(row.configuration_payload, 'configuration_payload') !== configurationPayload ||
    text(row.operational_configuration_hash, 'operational_configuration_hash') !==
      operational.hash ||
    text(row.operational_configuration_payload, 'operational_configuration_payload') !==
      operational.payload ||
    integer(row.backlog_limit, 'backlog_limit') !== operational.backlogLimit ||
    bigintText(row.stop_position, 'stop_position') !==
      String(descriptor.expectedAssociationCount) ||
    integer(row.expected_membership_count, 'expected_membership_count') !==
      descriptor.expectedAssociationCount ||
    text(row.replay_catalog_version, 'replay_catalog_version') !== manifest.catalogVersion ||
    checksum(row.replay_catalog_checksum, 'replay_catalog_checksum') !== manifest.catalogChecksum ||
    text(row.replay_schedule_version, 'replay_schedule_version') !== manifest.scheduleVersion ||
    checksum(row.replay_schedule_checksum, 'replay_schedule_checksum') !==
      manifest.scheduleChecksum ||
    text(row.replay_manifest_version, 'replay_manifest_version') !== manifest.version ||
    checksum(row.replay_manifest_checksum, 'replay_manifest_checksum') !== manifest.checksum ||
    checksum(row.expected_output_checksum, 'expected_output_checksum') !==
      descriptor.expectedOutputChecksum
  ) {
    throw new ReplayPersistenceError('descriptor_invalid');
  }
}

function associationValues(targetId: string, artifact: SignalReplayArtifact): readonly unknown[] {
  const { association, transition, evaluation } = artifact;
  return [
    targetId,
    association.targetOrdinal,
    association.scheduleOrdinal,
    transition.transitionId,
    evaluation.evaluationId,
    evaluation.outcome === 'fired' ? evaluation.occurrence.occurrenceId : null,
    transition.predecessorEvaluationId ?? null,
    transition.retractedOccurrenceId ?? null,
    transition.triggeringRevisionId,
    transition.kind,
    transition.latestRevisionState,
  ];
}

async function verifyExistingAssociation(
  queryable: SqlQueryable,
  targetId: string,
  artifact: SignalReplayArtifact,
): Promise<void> {
  const result = await queryable.query<SqlRow>(
    `/* signal-replay:select-association */
     SELECT membership.expected_evaluation_id, transition.transition_ordinal,
            transition.transition_id, transition.evaluation_id, transition.occurrence_id,
            transition.predecessor_evaluation_id, transition.retracted_occurrence_id,
            transition.triggering_revision_id, transition.transition_kind,
            transition.latest_revision_state, evaluation.canonical_payload
     FROM signal_run_expected_membership AS membership
     JOIN signal_run_transitions AS transition
       ON transition.run_id = membership.run_id AND transition.source_ordinal = membership.ordinal
     JOIN signal_evaluations AS evaluation ON evaluation.evaluation_id = transition.evaluation_id
     WHERE membership.run_id = $1 AND membership.ordinal = $2`,
    [targetId, artifact.association.targetOrdinal],
  );
  const row = result.rows[0];
  const expected = associationValues(targetId, artifact);
  if (
    result.rows.length !== 1 ||
    row === undefined ||
    text(row.expected_evaluation_id, 'expected_evaluation_id') !== expected[4] ||
    integer(row.transition_ordinal, 'transition_ordinal') !== expected[2] ||
    text(row.transition_id, 'transition_id') !== expected[3] ||
    text(row.evaluation_id, 'evaluation_id') !== expected[4] ||
    optionalText(row.occurrence_id, 'occurrence_id') !== expected[5] ||
    optionalText(row.predecessor_evaluation_id, 'predecessor_evaluation_id') !== expected[6] ||
    optionalText(row.retracted_occurrence_id, 'retracted_occurrence_id') !== expected[7] ||
    text(row.triggering_revision_id, 'triggering_revision_id') !== expected[8] ||
    text(row.transition_kind, 'transition_kind') !== expected[9] ||
    text(row.latest_revision_state, 'latest_revision_state') !== expected[10] ||
    text(row.canonical_payload, 'canonical_payload') !==
      serializeSignalEvaluation(artifact.evaluation)
  ) {
    throw new ReplayPersistenceError('stored_data_invalid');
  }
}

function validateOutput(
  descriptor: SignalReplayTargetDescriptor,
  output: SignalReplayCanonicalOutput,
): string {
  const payload = serializeSignalReplayOutput(output);
  if (
    output.targetId !== descriptor.targetId ||
    output.inputChecksum !== descriptor.inputChecksum ||
    output.configurationHash !== descriptor.configuration.configurationHash ||
    output.associations.length !== descriptor.expectedAssociationCount ||
    output.checksum !== descriptor.expectedOutputChecksum ||
    output.catalogEventCount !== descriptor.manifest.catalogEventCount ||
    output.scheduleEntryCount !== descriptor.manifest.scheduleEntryCount ||
    output.processedScheduleEntryCount !== descriptor.manifest.scheduleEntryCount
  ) {
    throw new ReplayPersistenceError('completion_invalid');
  }
  const parsed = JSON.parse(payload) as Readonly<Record<string, unknown>>;
  const { checksum: embedded, ...unsigned } = parsed;
  if (embedded !== output.checksum || sha256(JSON.stringify(unsigned)) !== output.checksum) {
    throw new ReplayPersistenceError('completion_invalid');
  }
  return payload;
}

export class PostgresSignalReplayPersistencePort implements SignalReplayPersistencePort {
  readonly #pool: SqlPool;
  readonly #claims = new Map<string, Claim>();

  public constructor(pool: SqlPool) {
    this.#pool = pool;
  }

  public async beginTarget(descriptor: SignalReplayTargetDescriptor): Promise<void> {
    const operational = validateDescriptor(descriptor);
    const fenceToken = await transaction(this.#pool, async (client) => {
      const config = descriptor.configuration;
      const manifest = descriptor.manifest;
      await client.query(
        `/* signal-replay:insert-run */
         INSERT INTO signal_runs (
           run_id, source_kind, state, definition_version, configuration_version,
           configuration_hash, configuration_payload, operational_configuration_hash,
           operational_configuration_payload, backlog_limit, arithmetic_policy_version,
           calendar_version, market_event_schema_version, data_quality_policy_version,
           revision_schema_version, feature_schema_version, evaluation_schema_version,
           freshness_threshold_ms, lookback_window, volume_multiplier, source_provenance,
           source_cursor_namespace, start_position, stop_position, cursor_position,
           capture_active, claim_fence, expected_membership_count,
           replay_catalog_version, replay_catalog_checksum, replay_schedule_version,
           replay_schedule_checksum, replay_manifest_version, replay_manifest_checksum,
           expected_output_checksum, started_at
         ) VALUES (
           $1,'replay_schedule','active',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
           $13,$14,$15,$16,$17,$18,$19,$20,0,$21::bigint,0,false,1,$21::integer,
           $22,$23,$24,$25,$26,$27,$28,CURRENT_TIMESTAMP
         ) ON CONFLICT (run_id) DO NOTHING`,
        [
          descriptor.targetId,
          config.signalDefinitionVersion,
          config.configurationVersion,
          config.configurationHash,
          serializeSignalConfiguration(config),
          operational.hash,
          operational.payload,
          operational.backlogLimit,
          manifest.semantics.arithmeticPolicyVersion,
          manifest.semantics.calendarSnapshotVersion,
          manifest.semantics.marketEventSchemaVersion,
          manifest.semantics.dataQualityPolicyVersion,
          manifest.semantics.canonicalRevisionSchemaVersion,
          manifest.semantics.featureResultSchemaVersion,
          manifest.semantics.evaluationSchemaVersion,
          config.freshnessThresholdMs,
          config.lookbackBars,
          config.volumeMultiplier,
          `verified-signal-replay.${manifest.checksum}`,
          `replay.${descriptor.inputChecksum}`,
          descriptor.expectedAssociationCount,
          manifest.catalogVersion,
          manifest.catalogChecksum,
          manifest.scheduleVersion,
          manifest.scheduleChecksum,
          manifest.version,
          manifest.checksum,
          descriptor.expectedOutputChecksum,
        ],
      );
      await client.query(
        `/* signal-replay:insert-cursor */
         INSERT INTO signal_run_cursors (run_id, source_kind, cursor_value, fence_token)
         VALUES ($1,'replay_schedule',0,1) ON CONFLICT (run_id) DO NOTHING`,
        [descriptor.targetId],
      );
      const selected = await client.query<RunRow>(
        `/* signal-replay:select-run */
         SELECT run_id, source_kind, state, configuration_hash, configuration_payload,
                operational_configuration_hash, operational_configuration_payload, backlog_limit,
                cursor_position, stop_position, claim_fence, expected_membership_count,
                replay_catalog_version, replay_catalog_checksum, replay_schedule_version,
                replay_schedule_checksum, replay_manifest_version, replay_manifest_checksum,
                expected_output_checksum, replay_output_checksum, replay_output_payload
         FROM signal_runs WHERE run_id = $1 FOR UPDATE`,
        [descriptor.targetId],
      );
      const row = selected.rows[0];
      if (selected.rows.length !== 1 || row === undefined) {
        throw new ReplayPersistenceError('stored_data_invalid');
      }
      verifyRun(row, descriptor);
      const state = text(row.state, 'state');
      if (state === 'completed') {
        verifyStoredOutput(row, descriptor);
        return bigintText(row.claim_fence, 'claim_fence');
      }
      if (state !== 'active' && state !== 'failed' && state !== 'pending') {
        throw new ReplayPersistenceError('descriptor_invalid');
      }
      const updated = await client.query<{ readonly claim_fence: unknown }>(
        `/* signal-replay:claim-run */
         UPDATE signal_runs SET state = 'active', ended_at = NULL, failure_code = NULL,
           claim_fence = claim_fence + 1
         WHERE run_id = $1 RETURNING claim_fence`,
        [descriptor.targetId],
      );
      const fence = bigintText(updated.rows[0]?.claim_fence, 'claim_fence');
      const cursor = await client.query(
        `/* signal-replay:fence-cursor */
         UPDATE signal_run_cursors SET fence_token = $2, updated_at = CURRENT_TIMESTAMP
         WHERE run_id = $1 AND source_kind = 'replay_schedule'`,
        [descriptor.targetId, fence],
      );
      if (cursor.rowCount !== 1) throw new ReplayPersistenceError('stored_data_invalid');
      return fence;
    });
    this.#claims.set(descriptor.targetId, Object.freeze({ descriptor, fenceToken }));
  }

  public async persistAssociation(targetId: string, artifact: SignalReplayArtifact): Promise<void> {
    const claim = this.#claims.get(targetId);
    if (claim === undefined || targetId !== claim.descriptor.targetId) {
      throw new ReplayPersistenceError('cursor_conflict');
    }
    validateArtifact(claim.descriptor, artifact);
    await transaction(this.#pool, async (client) => {
      const locked = await client.query<RunRow>(
        `/* signal-replay:lock-association-cursor */
         SELECT run.run_id, run.source_kind, run.state, run.configuration_hash,
                run.configuration_payload, run.operational_configuration_hash,
                run.operational_configuration_payload, run.backlog_limit, run.cursor_position,
                cursor.cursor_value,
                run.stop_position, run.claim_fence, run.expected_membership_count,
                run.replay_catalog_version, run.replay_catalog_checksum,
                run.replay_schedule_version, run.replay_schedule_checksum,
                run.replay_manifest_version, run.replay_manifest_checksum,
                run.expected_output_checksum, run.replay_output_checksum,
                run.replay_output_payload
         FROM signal_runs AS run JOIN signal_run_cursors AS cursor USING (run_id)
         WHERE run.run_id = $1 AND run.claim_fence = $2 AND cursor.fence_token = $2
           AND cursor.source_kind = 'replay_schedule' FOR UPDATE OF run, cursor`,
        [targetId, claim.fenceToken],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new ReplayPersistenceError('cursor_conflict');
      verifyRun(row, claim.descriptor);
      const current = bigintText(row.cursor_position, 'cursor_position');
      if (bigintText(row.cursor_value, 'cursor_value') !== current) {
        throw new ReplayPersistenceError('cursor_conflict');
      }
      const ordinal = String(artifact.association.targetOrdinal);
      if (BigInt(ordinal) <= BigInt(current)) {
        await persistSignalEvaluation(
          client,
          artifact.evaluation,
          (cause) => new ReplayPersistenceError('stored_data_invalid', { cause }),
        );
        await verifyExistingAssociation(client, targetId, artifact);
        return;
      }
      if (text(row.state, 'state') !== 'active' || BigInt(ordinal) !== BigInt(current) + 1n) {
        throw new ReplayPersistenceError('cursor_conflict');
      }
      await persistSignalEvaluation(
        client,
        artifact.evaluation,
        (cause) => new ReplayPersistenceError('stored_data_invalid', { cause }),
      );
      await client.query(
        `/* signal-replay:insert-membership */
         INSERT INTO signal_run_expected_membership
           (run_id, ordinal, expected_evaluation_id) VALUES ($1,$2,$3)`,
        [targetId, ordinal, artifact.evaluation.evaluationId],
      );
      await persistSignalRunAssociation(client, {
        runId: targetId,
        sourceKind: 'replay_schedule',
        sourceOrdinal: ordinal,
        transitionOrdinal: artifact.association.scheduleOrdinal,
        transition: artifact.transition,
        evaluation: artifact.evaluation,
      });
      const cursor = await client.query(
        `/* signal-replay:advance-cursor */
         UPDATE signal_run_cursors SET cursor_value = $2, updated_at = CURRENT_TIMESTAMP
         WHERE run_id = $1 AND fence_token = $3 AND cursor_value = $4`,
        [targetId, ordinal, claim.fenceToken, current],
      );
      const run = await client.query(
        `/* signal-replay:advance-run */
         UPDATE signal_runs SET cursor_position = $2
         WHERE run_id = $1 AND claim_fence = $3 AND cursor_position = $4`,
        [targetId, ordinal, claim.fenceToken, current],
      );
      if (cursor.rowCount !== 1 || run.rowCount !== 1) {
        throw new ReplayPersistenceError('cursor_conflict');
      }
    });
  }

  public async completeTarget(
    targetId: string,
    output: SignalReplayCanonicalOutput,
  ): Promise<void> {
    const claim = this.#claims.get(targetId);
    if (claim === undefined) throw new ReplayPersistenceError('cursor_conflict');
    const payload = validateOutput(claim.descriptor, output);
    await transaction(this.#pool, async (client) => {
      const locked = await client.query<RunRow>(
        `/* signal-replay:lock-completion */
         SELECT run_id, source_kind, state, configuration_hash, configuration_payload,
                operational_configuration_hash, operational_configuration_payload, backlog_limit,
                cursor_position, stop_position, claim_fence, expected_membership_count,
                replay_catalog_version, replay_catalog_checksum, replay_schedule_version,
                replay_schedule_checksum, replay_manifest_version, replay_manifest_checksum,
                expected_output_checksum, replay_output_checksum, replay_output_payload
         FROM signal_runs WHERE run_id = $1 AND claim_fence = $2 FOR UPDATE`,
        [targetId, claim.fenceToken],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new ReplayPersistenceError('cursor_conflict');
      verifyRun(row, claim.descriptor);
      if (text(row.state, 'state') === 'completed') {
        if (
          optionalText(row.replay_output_checksum, 'replay_output_checksum') !== output.checksum ||
          optionalText(row.replay_output_payload, 'replay_output_payload') !== payload
        ) {
          throw new ReplayPersistenceError('completion_invalid');
        }
        return;
      }
      if (
        text(row.state, 'state') !== 'active' ||
        bigintText(row.cursor_position, 'cursor_position') !==
          String(claim.descriptor.expectedAssociationCount)
      ) {
        throw new ReplayPersistenceError('completion_invalid');
      }
      await this.#verifyCompletion(client, claim.descriptor, output);
      const completed = await client.query(
        `/* signal-replay:complete-run */
         UPDATE signal_runs SET state = 'completed', replay_output_checksum = $2,
           replay_output_payload = $3, ended_at = CURRENT_TIMESTAMP, failure_code = NULL
         WHERE run_id = $1 AND state = 'active' AND claim_fence = $4
           AND cursor_position = expected_membership_count`,
        [targetId, output.checksum, payload, claim.fenceToken],
      );
      if (completed.rowCount !== 1) throw new ReplayPersistenceError('completion_invalid');
    });
  }

  async #verifyCompletion(
    queryable: SqlQueryable,
    descriptor: SignalReplayTargetDescriptor,
    output: SignalReplayCanonicalOutput,
  ): Promise<void> {
    const membership = await queryable.query<{
      readonly ordinal: unknown;
      readonly expected_evaluation_id: unknown;
    }>(
      `/* signal-replay:completion-membership */
       SELECT ordinal, expected_evaluation_id FROM signal_run_expected_membership
       WHERE run_id = $1 ORDER BY ordinal`,
      [descriptor.targetId],
    );
    const actualMembership = membership.rows.map((row) => ({
      ordinal: bigintText(row.ordinal, 'ordinal'),
      evaluationId: checksum(row.expected_evaluation_id, 'expected_evaluation_id'),
    }));
    const expectedMembership = output.associations.map((association, index) => ({
      ordinal: String(index + 1),
      evaluationId: association.evaluationId,
    }));
    if (
      actualMembership.length !== descriptor.expectedAssociationCount ||
      JSON.stringify(actualMembership) !== JSON.stringify(expectedMembership)
    ) {
      throw new ReplayPersistenceError('completion_invalid');
    }
    const associations = await queryable.query<SqlRow>(
      `/* signal-replay:completion-associations */
       SELECT transition.source_ordinal, transition.transition_ordinal,
              transition.triggering_revision_id, transition.evaluation_id,
              transition.occurrence_id, transition.retracted_occurrence_id,
              transition.transition_kind, evaluation.feature_result_id,
              evaluation.outcome, evaluation.instrument_symbol,
              evaluation.instrument_venue, evaluation.evaluation_bar_start
       FROM signal_run_transitions AS transition
       JOIN signal_evaluations AS evaluation ON evaluation.evaluation_id = transition.evaluation_id
       WHERE transition.run_id = $1 AND transition.source_kind = 'replay_schedule'
       ORDER BY transition.source_ordinal`,
      [descriptor.targetId],
    );
    const actualAssociations = associations.rows.map((row) => {
      const sourceOrdinal = bigintText(row.source_ordinal, 'source_ordinal');
      if (
        BigInt(sourceOrdinal) < 1n ||
        BigInt(sourceOrdinal) > BigInt(descriptor.expectedAssociationCount)
      ) {
        throw new ReplayPersistenceError('completion_invalid');
      }
      return {
        targetOrdinal: Number(sourceOrdinal),
        scheduleOrdinal: integer(row.transition_ordinal, 'transition_ordinal'),
        triggeringRevisionId: checksum(row.triggering_revision_id, 'triggering_revision_id'),
        evaluationBarKey: `${text(row.instrument_venue, 'instrument_venue')}:${text(row.instrument_symbol, 'instrument_symbol')}|1m|${replayTimestampText(row.evaluation_bar_start, 'evaluation_bar_start')}`,
        featureResultId: checksum(row.feature_result_id, 'feature_result_id'),
        evaluationId: checksum(row.evaluation_id, 'evaluation_id'),
        outcome: text(row.outcome, 'outcome'),
        transitionKind: text(row.transition_kind, 'transition_kind'),
        ...(row.occurrence_id === null
          ? {}
          : { occurrenceId: checksum(row.occurrence_id, 'occurrence_id') }),
        ...(row.retracted_occurrence_id === null
          ? {}
          : {
              retractedOccurrenceId: checksum(
                row.retracted_occurrence_id,
                'retracted_occurrence_id',
              ),
            }),
      };
    });
    if (JSON.stringify(actualAssociations) !== JSON.stringify(output.associations)) {
      throw new ReplayPersistenceError('completion_invalid');
    }
    const latest = await queryable.query<SqlRow>(
      `/* signal-replay:completion-latest */
       SELECT latest.source_ordinal, latest.occurrence_id, evaluation.canonical_payload,
              evaluation.instrument_symbol, evaluation.instrument_venue,
              evaluation.evaluation_bar_start
       FROM signal_run_latest_evaluations AS latest
       JOIN signal_evaluations AS evaluation ON evaluation.evaluation_id = latest.evaluation_id
       WHERE latest.run_id = $1 ORDER BY evaluation.instrument_venue,
         evaluation.instrument_symbol, evaluation.evaluation_bar_start`,
      [descriptor.targetId],
    );
    const expectedLatest = output.latestEvaluations.map((item) => ({
      evaluationBarKey: item.evaluationBarKey,
      targetOrdinal: String(item.targetOrdinal),
      payload: serializeSignalEvaluation(item.evaluation),
      occurrenceId:
        item.evaluation.outcome === 'fired' ? item.evaluation.occurrence.occurrenceId : null,
    }));
    const actualLatest = latest.rows.map((row) => ({
      evaluationBarKey: `${text(row.instrument_venue, 'instrument_venue')}:${text(row.instrument_symbol, 'instrument_symbol')}|1m|${replayTimestampText(row.evaluation_bar_start, 'evaluation_bar_start')}`,
      targetOrdinal: bigintText(row.source_ordinal, 'source_ordinal'),
      payload: text(row.canonical_payload, 'canonical_payload'),
      occurrenceId: optionalText(row.occurrence_id, 'occurrence_id'),
    }));
    if (JSON.stringify(actualLatest) !== JSON.stringify(expectedLatest)) {
      throw new ReplayPersistenceError('completion_invalid');
    }
    const actualActive = actualLatest
      .filter(({ occurrenceId }) => occurrenceId !== null)
      .map(({ evaluationBarKey, targetOrdinal, occurrenceId }) => ({
        evaluationBarKey,
        targetOrdinal,
        occurrenceId,
      }));
    const expectedActive = output.activeFiredHistory.map((item) => ({
      evaluationBarKey: item.evaluationBarKey,
      targetOrdinal: String(item.targetOrdinal),
      occurrenceId: item.occurrence.occurrenceId,
    }));
    if (JSON.stringify(actualActive) !== JSON.stringify(expectedActive)) {
      throw new ReplayPersistenceError('completion_invalid');
    }
  }

  public async failTarget(targetId: string): Promise<void> {
    const claim = this.#claims.get(targetId);
    if (claim === undefined) return;
    await this.#pool.query(
      `/* signal-replay:fail-run */
       UPDATE signal_runs SET state = 'failed', failure_code = 'replay_sink_failed',
         ended_at = CURRENT_TIMESTAMP
       WHERE run_id = $1 AND state = 'active' AND claim_fence = $2`,
      [targetId, claim.fenceToken],
    );
  }

  public async inspectTarget(targetId: string): Promise<ReplayTargetInspection> {
    if (!TARGET_ID.test(targetId)) throw new ReplayPersistenceError('descriptor_invalid');
    const result = await this.#pool.query<SqlRow>(
      `/* signal-replay:inspect-target */
       SELECT state, cursor_position, expected_membership_count, failure_code,
              replay_output_checksum, replay_output_payload
       FROM signal_runs WHERE run_id = $1 AND source_kind = 'replay_schedule'`,
      [targetId],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined) {
      throw new ReplayPersistenceError('stored_data_invalid');
    }
    return Object.freeze({
      targetId,
      state: text(row.state, 'state'),
      cursor: bigintText(row.cursor_position, 'cursor_position'),
      expectedCount: integer(row.expected_membership_count, 'expected_membership_count'),
      failureCode: optionalText(row.failure_code, 'failure_code'),
      outputChecksum: optionalText(row.replay_output_checksum, 'replay_output_checksum'),
      outputPayload: optionalText(row.replay_output_payload, 'replay_output_payload'),
    });
  }

  public async inspectObservations(targetId: string): Promise<ReplayObservationInspection> {
    const target = await this.inspectTarget(targetId);
    const select = async (firedOnly: boolean): Promise<readonly ReplayObservation[]> => {
      const result = await this.#pool.query<SqlRow>(
        `/* signal-replay:inspect-observations */
         SELECT DISTINCT ON (evaluation.instrument_symbol)
           evaluation.instrument_symbol, evaluation.instrument_venue,
           evaluation.definition_version, evaluation.configuration_version,
           evaluation.configuration_hash,
           evaluation.evaluation_bar_start, evaluation.outcome, evaluation.reason,
           evaluation.direction, evaluation.observation_as_of, evaluation.knowledge_as_of,
           evaluation.evaluation_mode, evaluation.close_price,
           evaluation.breakout_reference, evaluation.prior_high, evaluation.prior_low,
           evaluation.current_volume,
           evaluation.prior_volume_sum, evaluation.prior_count,
           evaluation.volume_multiplier, evaluation.window_start, evaluation.window_end,
           evaluation.invalidation_condition, evaluation.source_provider,
           evaluation.source_feed, evaluation.source_entitlement
         FROM signal_run_latest_evaluations AS latest
         JOIN signal_evaluations AS evaluation ON evaluation.evaluation_id = latest.evaluation_id
         WHERE latest.run_id = $1 AND ($2::boolean = false OR latest.occurrence_id IS NOT NULL)
         ORDER BY evaluation.instrument_symbol, evaluation.evaluation_bar_start DESC`,
        [targetId, firedOnly],
      );
      return Object.freeze(
        result.rows.map((row) => ({
          symbol: text(row.instrument_symbol, 'instrument_symbol'),
          venue: text(row.instrument_venue, 'instrument_venue'),
          definitionVersion: text(row.definition_version, 'definition_version'),
          configurationVersion: text(row.configuration_version, 'configuration_version'),
          configurationHash: checksum(row.configuration_hash, 'configuration_hash'),
          evaluationBarStart: replayTimestampText(row.evaluation_bar_start, 'evaluation_bar_start'),
          outcome: text(row.outcome, 'outcome'),
          reason: text(row.reason, 'reason'),
          direction: optionalText(row.direction, 'direction'),
          observationAsOf: replayTimestampText(row.observation_as_of, 'observation_as_of'),
          knowledgeAsOf: replayTimestampText(row.knowledge_as_of, 'knowledge_as_of'),
          mode: text(row.evaluation_mode, 'evaluation_mode'),
          closePrice: optionalText(row.close_price, 'close_price'),
          breakoutReference: optionalText(row.breakout_reference, 'breakout_reference'),
          priorHigh: optionalText(row.prior_high, 'prior_high'),
          priorLow: optionalText(row.prior_low, 'prior_low'),
          currentVolume: optionalText(row.current_volume, 'current_volume'),
          priorVolumeSum: optionalText(row.prior_volume_sum, 'prior_volume_sum'),
          priorCount: row.prior_count === null ? null : integer(row.prior_count, 'prior_count'),
          volumeMultiplier: optionalText(row.volume_multiplier, 'volume_multiplier'),
          windowStart:
            row.window_start === null
              ? null
              : replayTimestampText(row.window_start, 'window_start'),
          windowEnd:
            row.window_end === null ? null : replayTimestampText(row.window_end, 'window_end'),
          invalidationCondition: optionalText(row.invalidation_condition, 'invalidation_condition'),
          sourceProvider: text(row.source_provider, 'source_provider'),
          sourceFeed: text(row.source_feed, 'source_feed'),
          sourceEntitlement: text(row.source_entitlement, 'source_entitlement'),
        })),
      );
    };
    const [latest, latestValidFired] = await Promise.all([select(false), select(true)]);
    return Object.freeze({ target, latest, latestValidFired });
  }
}
