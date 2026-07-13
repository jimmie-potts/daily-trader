import { createUtcTimestamp } from '@daily-trader/domain';
import { createHash } from 'node:crypto';

import { MARKET_DATA_SCHEMA_VERSION, ONE_MINUTE_INTERVAL } from './constants.js';
import { utcEpochMilliseconds } from './timestamp.js';
import { MarketDataValidationError, requireRecord, requireString } from './validation.js';
import type { OneMinuteBarEvent } from './bar-event.js';

export const CANONICAL_REVISION_SCHEMA_VERSION =
  'daily-trader.market-data.canonical-revision.v1' as const;

const EVENT_ID = /^[0-9a-f]{64}$/u;
const POSITIVE_POSITION = /^[1-9][0-9]{0,18}$/u;
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;

declare const canonicalRevisionPositionBrand: unique symbol;

/** A PostgreSQL BIGINT journal position represented without JavaScript number coercion. */
export type CanonicalRevisionPosition = string & {
  readonly [canonicalRevisionPositionBrand]: 'CanonicalRevisionPosition';
};

export type CanonicalRevisionOperation = 'insert' | 'replace';
export type CanonicalRevisionNoOpReason = 'duplicate' | 'losing_replacement' | 'noncanonical';
export type CanonicalRevisionArrivalClassification = 'accepted' | 'correction' | 'out_of_order';
export type CanonicalRevisionGapState = 'complete' | 'gapped' | 'unknown';

export interface CanonicalRevisionArrivalMetadata {
  readonly classification: CanonicalRevisionArrivalClassification;
  readonly historical: boolean;
  readonly outOfOrder: boolean;
}

export interface CanonicalRevisionGapMetadata {
  readonly state: CanonicalRevisionGapState;
  readonly filledKnownGap: boolean;
}

interface CanonicalRevisionBase {
  readonly schemaVersion: typeof CANONICAL_REVISION_SCHEMA_VERSION;
  readonly kind: 'canonical_revision';
  readonly revisionId: string;
  readonly processingPosition: CanonicalRevisionPosition;
  readonly logicalBarKey: string;
  readonly newCanonicalEventId: string;
  readonly marketEventSchemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
  readonly arrival: CanonicalRevisionArrivalMetadata;
  readonly gap: CanonicalRevisionGapMetadata;
}

export interface CanonicalInsertRevision extends CanonicalRevisionBase {
  readonly operation: 'insert';
  readonly previousCanonicalEventId: null;
}

export interface CanonicalReplaceRevision extends CanonicalRevisionBase {
  readonly operation: 'replace';
  readonly previousCanonicalEventId: string;
}

export type CanonicalRevision = CanonicalInsertRevision | CanonicalReplaceRevision;

export interface CanonicalRevisionNoOp {
  readonly kind: 'canonical_revision_no_op';
  readonly operation: 'no_op';
  readonly reason: CanonicalRevisionNoOpReason;
}

export type CanonicalRevisionDecision = CanonicalRevision | CanonicalRevisionNoOp;

export interface CanonicalInsertTransitionDecision {
  readonly kind: 'canonical_transition';
  readonly operation: 'insert';
  readonly previousCanonicalEventId: null;
  readonly newCanonicalEventId: string;
}

export interface CanonicalReplaceTransitionDecision {
  readonly kind: 'canonical_transition';
  readonly operation: 'replace';
  readonly previousCanonicalEventId: string;
  readonly newCanonicalEventId: string;
}

export type CanonicalTransitionDecision =
  CanonicalInsertTransitionDecision | CanonicalReplaceTransitionDecision | CanonicalRevisionNoOp;

export interface DecideCanonicalTransitionInput {
  readonly currentCanonical: OneMinuteBarEvent | undefined;
  readonly candidate: OneMinuteBarEvent;
  readonly candidateEligible: boolean;
}

interface CanonicalRevisionInputBase {
  readonly processingPosition: unknown;
  readonly logicalBarKey: unknown;
  readonly newCanonicalEventId: unknown;
  readonly marketEventSchemaVersion: unknown;
  readonly arrival: {
    readonly classification: unknown;
    readonly historical: unknown;
    readonly outOfOrder: unknown;
  };
  readonly gap: {
    readonly state: unknown;
    readonly filledKnownGap: unknown;
  };
}

export interface CanonicalInsertRevisionInput extends CanonicalRevisionInputBase {
  readonly operation: 'insert';
  readonly previousCanonicalEventId: null;
}

export interface CanonicalReplaceRevisionInput extends CanonicalRevisionInputBase {
  readonly operation: 'replace';
  readonly previousCanonicalEventId: unknown;
}

export type CanonicalRevisionInput = CanonicalInsertRevisionInput | CanonicalReplaceRevisionInput;

/**
 * Selects canonical transition material with the same `(receivedAt, eventId)`
 * precedence used by durable live ingestion. It never allocates journal order.
 */
export function decideCanonicalTransition(
  input: DecideCanonicalTransitionInput,
): CanonicalTransitionDecision {
  if (!input.candidateEligible) {
    return createCanonicalRevisionNoOp('noncanonical');
  }
  const current = input.currentCanonical;
  if (current === undefined) {
    return Object.freeze({
      kind: 'canonical_transition',
      operation: 'insert',
      previousCanonicalEventId: null,
      newCanonicalEventId: input.candidate.eventId,
    });
  }
  if (current.orderingKey !== input.candidate.orderingKey) {
    return createCanonicalRevisionNoOp('noncanonical');
  }
  if (current.eventId === input.candidate.eventId) {
    return createCanonicalRevisionNoOp('duplicate');
  }

  const currentReceived = utcEpochMilliseconds(current.receivedAt);
  const candidateReceived = utcEpochMilliseconds(input.candidate.receivedAt);
  const candidateWins =
    candidateReceived > currentReceived ||
    (candidateReceived === currentReceived && input.candidate.eventId > current.eventId);
  if (!candidateWins) {
    return createCanonicalRevisionNoOp('losing_replacement');
  }
  return Object.freeze({
    kind: 'canonical_transition',
    operation: 'replace',
    previousCanonicalEventId: current.eventId,
    newCanonicalEventId: input.candidate.eventId,
  });
}

export function createCanonicalRevisionPosition(value: unknown): CanonicalRevisionPosition {
  const text = requireString(value, 'canonicalRevision.processingPosition');
  if (!POSITIVE_POSITION.test(text) || BigInt(text) > POSTGRES_BIGINT_MAXIMUM) {
    throw new MarketDataValidationError(
      'canonicalRevision.processingPosition',
      'must be canonical positive PostgreSQL BIGINT text',
    );
  }
  return text as CanonicalRevisionPosition;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new MarketDataValidationError(field, 'must be a boolean');
  }
  return value;
}

function requireEventId(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (!EVENT_ID.test(text)) {
    throw new MarketDataValidationError(field, 'must be a lowercase SHA-256 digest');
  }
  return text;
}

function requireLogicalBarKey(value: unknown): string {
  const text = requireString(value, 'canonicalRevision.logicalBarKey');
  const segments = text.split('|');
  if (segments.length !== 3) {
    throw new MarketDataValidationError(
      'canonicalRevision.logicalBarKey',
      'must identify one supported one-minute logical bar',
    );
  }
  const [instrument, interval, barStart] = segments;
  if (
    (instrument !== 'XNAS:AAPL' && instrument !== 'ARCX:SPY') ||
    interval !== ONE_MINUTE_INTERVAL
  ) {
    throw new MarketDataValidationError(
      'canonicalRevision.logicalBarKey',
      'must identify one supported one-minute logical bar',
    );
  }
  let canonicalBarStart: string;
  try {
    canonicalBarStart = createUtcTimestamp(barStart);
  } catch {
    throw new MarketDataValidationError(
      'canonicalRevision.logicalBarKey',
      'must contain a canonical UTC bar start',
    );
  }
  if (Date.parse(canonicalBarStart) % 60_000 !== 0) {
    throw new MarketDataValidationError(
      'canonicalRevision.logicalBarKey',
      'bar start must align to a UTC minute boundary',
    );
  }
  return `${instrument}|${interval}|${canonicalBarStart}`;
}

function requireMarketEventSchemaVersion(value: unknown): typeof MARKET_DATA_SCHEMA_VERSION {
  if (value !== MARKET_DATA_SCHEMA_VERSION) {
    throw new MarketDataValidationError(
      'canonicalRevision.marketEventSchemaVersion',
      `must be ${MARKET_DATA_SCHEMA_VERSION}`,
    );
  }
  return MARKET_DATA_SCHEMA_VERSION;
}

function arrivalMetadata(input: unknown): CanonicalRevisionArrivalMetadata {
  const record = requireRecord(input, 'canonicalRevision.arrival');
  const classification = record.classification;
  if (
    classification !== 'accepted' &&
    classification !== 'correction' &&
    classification !== 'out_of_order'
  ) {
    throw new MarketDataValidationError(
      'canonicalRevision.arrival.classification',
      'must be accepted, correction, or out_of_order',
    );
  }
  const historical = requireBoolean(record.historical, 'canonicalRevision.arrival.historical');
  const outOfOrder = requireBoolean(record.outOfOrder, 'canonicalRevision.arrival.outOfOrder');
  if (outOfOrder !== (classification === 'out_of_order')) {
    throw new MarketDataValidationError(
      'canonicalRevision.arrival.outOfOrder',
      'must agree with arrival classification',
    );
  }
  if (classification === 'out_of_order' && !historical) {
    throw new MarketDataValidationError(
      'canonicalRevision.arrival.outOfOrder',
      'requires historical arrival metadata',
    );
  }
  return Object.freeze({ classification, historical, outOfOrder });
}

function gapMetadata(input: unknown): CanonicalRevisionGapMetadata {
  const record = requireRecord(input, 'canonicalRevision.gap');
  const state = record.state;
  if (state !== 'complete' && state !== 'gapped' && state !== 'unknown') {
    throw new MarketDataValidationError(
      'canonicalRevision.gap.state',
      'must be complete, gapped, or unknown',
    );
  }
  return Object.freeze({
    state,
    filledKnownGap: requireBoolean(record.filledKnownGap, 'canonicalRevision.gap.filledKnownGap'),
  });
}

function canonicalRevisionIdentity(input: {
  readonly operation: CanonicalRevisionOperation;
  readonly logicalBarKey: string;
  readonly previousCanonicalEventId: string | null;
  readonly newCanonicalEventId: string;
  readonly marketEventSchemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
  readonly arrival: CanonicalRevisionArrivalMetadata;
  readonly gap: CanonicalRevisionGapMetadata;
}): string {
  return JSON.stringify({
    schemaVersion: CANONICAL_REVISION_SCHEMA_VERSION,
    kind: 'canonical_revision',
    operation: input.operation,
    logicalBarKey: input.logicalBarKey,
    previousCanonicalEventId: input.previousCanonicalEventId,
    newCanonicalEventId: input.newCanonicalEventId,
    marketEventSchemaVersion: input.marketEventSchemaVersion,
    arrival: {
      classification: input.arrival.classification,
      historical: input.arrival.historical,
      outOfOrder: input.arrival.outOfOrder,
    },
    gap: {
      state: input.gap.state,
      filledKnownGap: input.gap.filledKnownGap,
    },
  });
}

function revisionIdentifier(identity: string): string {
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

export function createCanonicalRevision(input: CanonicalRevisionInput): CanonicalRevision {
  const processingPosition = createCanonicalRevisionPosition(input.processingPosition);
  const logicalBarKey = requireLogicalBarKey(input.logicalBarKey);
  const newCanonicalEventId = requireEventId(
    input.newCanonicalEventId,
    'canonicalRevision.newCanonicalEventId',
  );
  const marketEventSchemaVersion = requireMarketEventSchemaVersion(input.marketEventSchemaVersion);
  const arrival = arrivalMetadata(input.arrival);
  const gap = gapMetadata(input.gap);

  const runtimeOperation: unknown = input.operation;
  if (runtimeOperation !== 'insert' && runtimeOperation !== 'replace') {
    throw new MarketDataValidationError('canonicalRevision.operation', 'must be insert or replace');
  }

  let previousCanonicalEventId: string | null;
  if (runtimeOperation === 'insert') {
    if (input.previousCanonicalEventId !== null) {
      throw new MarketDataValidationError(
        'canonicalRevision.previousCanonicalEventId',
        'must be null for insert',
      );
    }
    previousCanonicalEventId = null;
    if (arrival.classification === 'correction') {
      throw new MarketDataValidationError(
        'canonicalRevision.arrival.classification',
        'insert cannot use correction arrival classification',
      );
    }
  } else {
    previousCanonicalEventId = requireEventId(
      input.previousCanonicalEventId,
      'canonicalRevision.previousCanonicalEventId',
    );
    if (previousCanonicalEventId === newCanonicalEventId) {
      throw new MarketDataValidationError(
        'canonicalRevision.newCanonicalEventId',
        'must differ from the previous canonical event for replace',
      );
    }
    if (arrival.classification !== 'correction' || gap.filledKnownGap) {
      throw new MarketDataValidationError(
        'canonicalRevision.operation',
        'replace requires correction arrival classification and cannot fill a known gap',
      );
    }
  }

  if (
    gap.filledKnownGap &&
    (!arrival.historical || !arrival.outOfOrder || gap.state !== 'gapped')
  ) {
    throw new MarketDataValidationError(
      'canonicalRevision.gap.filledKnownGap',
      'requires a historical out-of-order insert with gapped state',
    );
  }

  const operation = runtimeOperation;
  const revisionId = revisionIdentifier(
    canonicalRevisionIdentity({
      operation,
      logicalBarKey,
      previousCanonicalEventId,
      newCanonicalEventId,
      marketEventSchemaVersion,
      arrival,
      gap,
    }),
  );
  const common = {
    schemaVersion: CANONICAL_REVISION_SCHEMA_VERSION,
    kind: 'canonical_revision' as const,
    revisionId,
    processingPosition,
    logicalBarKey,
    newCanonicalEventId,
    marketEventSchemaVersion,
    arrival,
    gap,
  };

  if (operation === 'insert') {
    return Object.freeze({
      ...common,
      operation: 'insert' as const,
      previousCanonicalEventId: null,
    });
  }
  if (previousCanonicalEventId === null) {
    throw new MarketDataValidationError(
      'canonicalRevision.previousCanonicalEventId',
      'must identify the previous canonical event for replace',
    );
  }
  return Object.freeze({
    ...common,
    operation: 'replace' as const,
    previousCanonicalEventId,
  });
}

export function createCanonicalRevisionNoOp(reason: unknown): CanonicalRevisionNoOp {
  if (reason !== 'duplicate' && reason !== 'losing_replacement' && reason !== 'noncanonical') {
    throw new MarketDataValidationError(
      'canonicalRevisionNoOp.reason',
      'must be duplicate, losing_replacement, or noncanonical',
    );
  }
  return Object.freeze({
    kind: 'canonical_revision_no_op',
    operation: 'no_op',
    reason,
  });
}

function canonicalRevisionObject(revision: CanonicalRevision): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: revision.schemaVersion,
    kind: revision.kind,
    revisionId: revision.revisionId,
    processingPosition: revision.processingPosition,
    operation: revision.operation,
    logicalBarKey: revision.logicalBarKey,
    previousCanonicalEventId: revision.previousCanonicalEventId,
    newCanonicalEventId: revision.newCanonicalEventId,
    marketEventSchemaVersion: revision.marketEventSchemaVersion,
    arrival: {
      classification: revision.arrival.classification,
      historical: revision.arrival.historical,
      outOfOrder: revision.arrival.outOfOrder,
    },
    gap: {
      state: revision.gap.state,
      filledKnownGap: revision.gap.filledKnownGap,
    },
  };
}

export function serializeCanonicalRevision(revision: CanonicalRevision): string {
  return JSON.stringify(canonicalRevisionObject(revision));
}

function requireConstant(value: unknown, expected: string, field: string): void {
  if (value !== expected) {
    throw new MarketDataValidationError(field, `must be ${expected}`);
  }
}

export function deserializeCanonicalRevision(serialized: unknown): CanonicalRevision {
  const text = requireString(serialized, 'serializedCanonicalRevision');
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new MarketDataValidationError('serializedCanonicalRevision', 'must be valid JSON');
  }

  const record = requireRecord(decoded, 'canonicalRevision');
  const arrival = requireRecord(record.arrival, 'canonicalRevision.arrival');
  const gap = requireRecord(record.gap, 'canonicalRevision.gap');
  requireConstant(
    record.schemaVersion,
    CANONICAL_REVISION_SCHEMA_VERSION,
    'canonicalRevision.schemaVersion',
  );
  requireConstant(record.kind, 'canonical_revision', 'canonicalRevision.kind');

  if (record.operation !== 'insert' && record.operation !== 'replace') {
    throw new MarketDataValidationError('canonicalRevision.operation', 'must be insert or replace');
  }

  const revision = createCanonicalRevision({
    operation: record.operation,
    processingPosition: record.processingPosition,
    logicalBarKey: record.logicalBarKey,
    previousCanonicalEventId: record.previousCanonicalEventId,
    newCanonicalEventId: record.newCanonicalEventId,
    marketEventSchemaVersion: record.marketEventSchemaVersion,
    arrival: {
      classification: arrival.classification,
      historical: arrival.historical,
      outOfOrder: arrival.outOfOrder,
    },
    gap: {
      state: gap.state,
      filledKnownGap: gap.filledKnownGap,
    },
  } as CanonicalRevisionInput);

  if (record.revisionId !== revision.revisionId) {
    throw new MarketDataValidationError(
      'canonicalRevision.revisionId',
      'does not match canonical revision content',
    );
  }
  if (serializeCanonicalRevision(revision) !== text) {
    throw new MarketDataValidationError(
      'serializedCanonicalRevision',
      'must use the fixed canonical field order without extra fields or whitespace',
    );
  }
  return revision;
}
