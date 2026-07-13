import { describe, expect, it } from 'vitest';

import {
  CANONICAL_REVISION_SCHEMA_VERSION,
  createCanonicalRevision,
  createCanonicalRevisionNoOp,
  createCanonicalRevisionPosition,
  decideCanonicalTransition,
  deserializeCanonicalRevision,
  serializeCanonicalRevision,
  type CanonicalRevisionInput,
} from './canonical-revision.js';
import { createOneMinuteBarEvent, type OneMinuteBarEvent } from './bar-event.js';
import { MARKET_DATA_SCHEMA_VERSION } from './constants.js';
import { MarketDataValidationError } from './validation.js';

const PREVIOUS_EVENT_ID = 'a'.repeat(64);
const NEW_EVENT_ID = 'b'.repeat(64);

function bar(
  overrides: {
    readonly providerTimestamp?: string;
    readonly receivedAt?: string;
    readonly close?: string;
  } = {},
): OneMinuteBarEvent {
  const receivedAt = overrides.receivedAt ?? '2026-07-13T13:31:00.100Z';
  return createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: overrides.providerTimestamp ?? '2026-07-13T13:30:00Z',
    receivedAt,
    processedAt: receivedAt,
    open: '100',
    high: '102',
    low: '99',
    close: overrides.close ?? '101',
    volume: '1000',
  });
}

function insertInput(overrides: Partial<CanonicalRevisionInput> = {}): CanonicalRevisionInput {
  return {
    operation: 'insert',
    processingPosition: '1',
    logicalBarKey: 'XNAS:AAPL|1m|2026-07-13T13:30:00.000Z',
    previousCanonicalEventId: null,
    newCanonicalEventId: NEW_EVENT_ID,
    marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    arrival: {
      classification: 'accepted',
      historical: false,
      outOfOrder: false,
    },
    gap: {
      state: 'unknown',
      filledKnownGap: false,
    },
    ...overrides,
  } as CanonicalRevisionInput;
}

function replaceInput(overrides: Partial<CanonicalRevisionInput> = {}): CanonicalRevisionInput {
  return {
    operation: 'replace',
    processingPosition: '2',
    logicalBarKey: 'ARCX:SPY|1m|2026-07-13T13:31:00.000Z',
    previousCanonicalEventId: PREVIOUS_EVENT_ID,
    newCanonicalEventId: NEW_EVENT_ID,
    marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    arrival: {
      classification: 'correction',
      historical: true,
      outOfOrder: false,
    },
    gap: {
      state: 'unknown',
      filledKnownGap: false,
    },
    ...overrides,
  } as CanonicalRevisionInput;
}

describe('canonical revision construction', () => {
  it('constructs a deeply immutable insert with explicit arrival and gap metadata', () => {
    const revision = createCanonicalRevision(
      insertInput({
        processingPosition: '9223372036854775807',
        arrival: { classification: 'out_of_order', historical: true, outOfOrder: true },
        gap: { state: 'gapped', filledKnownGap: true },
      }),
    );

    expect(revision).toMatchObject({
      schemaVersion: CANONICAL_REVISION_SCHEMA_VERSION,
      kind: 'canonical_revision',
      processingPosition: '9223372036854775807',
      operation: 'insert',
      previousCanonicalEventId: null,
      newCanonicalEventId: NEW_EVENT_ID,
      marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
      arrival: { classification: 'out_of_order', historical: true, outOfOrder: true },
      gap: { state: 'gapped', filledKnownGap: true },
    });
    expect(revision.revisionId).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.arrival)).toBe(true);
    expect(Object.isFrozen(revision.gap)).toBe(true);
  });

  it('constructs a replace with distinct previous and new canonical events', () => {
    const revision = createCanonicalRevision(replaceInput());

    expect(revision).toMatchObject({
      operation: 'replace',
      previousCanonicalEventId: PREVIOUS_EVENT_ID,
      newCanonicalEventId: NEW_EVENT_ID,
      arrival: { classification: 'correction', historical: true, outOfOrder: false },
      gap: { state: 'unknown', filledKnownGap: false },
    });
  });

  it('derives stable identity from transition content and excludes processing position', () => {
    const first = createCanonicalRevision(insertInput({ processingPosition: '1' }));
    const laterPosition = createCanonicalRevision(insertInput({ processingPosition: '99' }));
    const historical = createCanonicalRevision(
      insertInput({
        processingPosition: '99',
        arrival: { classification: 'out_of_order', historical: true, outOfOrder: true },
      }),
    );

    expect(first.revisionId).toBe(laterPosition.revisionId);
    expect(first.revisionId).toBe(
      '363413a404ad1521621210e58c3efff64728a63b72f7e6fd82220feb11dcf929',
    );
    expect(historical.revisionId).not.toBe(first.revisionId);
  });

  it.each(['duplicate', 'losing_replacement', 'noncanonical'] as const)(
    'represents %s as an immutable no-op without journal identity or position',
    (reason) => {
      const result = createCanonicalRevisionNoOp(reason);

      expect(result).toEqual({
        kind: 'canonical_revision_no_op',
        operation: 'no_op',
        reason,
      });
      expect('revisionId' in result).toBe(false);
      expect('processingPosition' in result).toBe(false);
      expect(Object.isFrozen(result)).toBe(true);
    },
  );
});

describe('canonical transition precedence', () => {
  it('returns immutable position-free insert, duplicate, and noncanonical material', () => {
    const candidate = bar();
    const insert = decideCanonicalTransition({
      currentCanonical: undefined,
      candidate,
      candidateEligible: true,
    });

    expect(insert).toEqual({
      kind: 'canonical_transition',
      operation: 'insert',
      previousCanonicalEventId: null,
      newCanonicalEventId: candidate.eventId,
    });
    expect('processingPosition' in insert).toBe(false);
    expect(Object.isFrozen(insert)).toBe(true);
    expect(
      decideCanonicalTransition({
        currentCanonical: candidate,
        candidate,
        candidateEligible: true,
      }),
    ).toMatchObject({ operation: 'no_op', reason: 'duplicate' });
    expect(
      decideCanonicalTransition({
        currentCanonical: undefined,
        candidate,
        candidateEligible: false,
      }),
    ).toMatchObject({ operation: 'no_op', reason: 'noncanonical' });
    expect(
      decideCanonicalTransition({
        currentCanonical: candidate,
        candidate: bar({ providerTimestamp: '2026-07-13T13:31:00Z' }),
        candidateEligible: true,
      }),
    ).toMatchObject({ operation: 'no_op', reason: 'noncanonical' });
  });

  it('uses receivedAt first and eventId as the exact replacement tie-breaker', () => {
    const earlier = bar({ receivedAt: '2026-07-13T13:31:00.100Z', close: '100.5' });
    const later = bar({ receivedAt: '2026-07-13T13:31:00.200Z', close: '101' });

    expect(
      decideCanonicalTransition({
        currentCanonical: earlier,
        candidate: later,
        candidateEligible: true,
      }),
    ).toEqual({
      kind: 'canonical_transition',
      operation: 'replace',
      previousCanonicalEventId: earlier.eventId,
      newCanonicalEventId: later.eventId,
    });
    expect(
      decideCanonicalTransition({
        currentCanonical: later,
        candidate: earlier,
        candidateEligible: true,
      }),
    ).toMatchObject({ operation: 'no_op', reason: 'losing_replacement' });

    const firstTie = bar({ receivedAt: '2026-07-13T13:31:00.300Z', close: '100.5' });
    const secondTie = bar({ receivedAt: '2026-07-13T13:31:00.300Z', close: '101' });
    const [lowerId, higherId] = [firstTie, secondTie].sort((left, right) =>
      left.eventId.localeCompare(right.eventId),
    );
    if (lowerId === undefined || higherId === undefined) {
      throw new Error('tie fixtures must contain two events');
    }

    expect(
      decideCanonicalTransition({
        currentCanonical: lowerId,
        candidate: higherId,
        candidateEligible: true,
      }),
    ).toMatchObject({ operation: 'replace' });
    expect(
      decideCanonicalTransition({
        currentCanonical: higherId,
        candidate: lowerId,
        candidateEligible: true,
      }),
    ).toMatchObject({ operation: 'no_op', reason: 'losing_replacement' });
  });
});

describe('canonical revision validation', () => {
  it.each([undefined, 1, '', '0', '-1', '+1', '01', '1.0', ' 1', '9223372036854775808'])(
    'rejects invalid textual position %o',
    (position) => {
      expect(() => createCanonicalRevisionPosition(position)).toThrowError(
        'canonicalRevision.processingPosition',
      );
    },
  );

  it.each([
    [{ newCanonicalEventId: 'B'.repeat(64) }, 'newCanonicalEventId'],
    [{ newCanonicalEventId: 'b'.repeat(63) }, 'newCanonicalEventId'],
    [{ logicalBarKey: 'XNAS:MSFT|1m|2026-07-13T13:30:00.000Z' }, 'logicalBarKey'],
    [{ logicalBarKey: 'XNAS:AAPL|5m|2026-07-13T13:30:00.000Z' }, 'logicalBarKey'],
    [{ logicalBarKey: 'XNAS:AAPL|1m|2026-07-13T13:30:00Z' }, 'logicalBarKey'],
    [{ logicalBarKey: 'XNAS:AAPL|1m|2026-07-13T13:30:01.000Z' }, 'logicalBarKey'],
    [{ marketEventSchemaVersion: 'unknown' }, 'marketEventSchemaVersion'],
    [
      { arrival: { classification: 'out_of_order', historical: false, outOfOrder: true } },
      'arrival.outOfOrder',
    ],
    [
      {
        arrival: { classification: 'accepted', historical: true, outOfOrder: false },
        gap: { state: 'gapped', filledKnownGap: true },
      },
      'gap.filledKnownGap',
    ],
  ] as const)('rejects invalid revision input %o', (overrides, field) => {
    expect(() => createCanonicalRevision(insertInput(overrides))).toThrowError(field);
  });

  it('rejects invalid insert and replacement transition combinations', () => {
    expect(() =>
      createCanonicalRevision(
        insertInput({
          previousCanonicalEventId: PREVIOUS_EVENT_ID,
        }),
      ),
    ).toThrowError('previousCanonicalEventId');
    expect(() =>
      createCanonicalRevision(replaceInput({ newCanonicalEventId: PREVIOUS_EVENT_ID })),
    ).toThrowError('newCanonicalEventId');
    expect(() =>
      createCanonicalRevision(
        replaceInput({
          arrival: { classification: 'out_of_order', historical: true, outOfOrder: true },
        }),
      ),
    ).toThrowError('canonicalRevision.operation');
    expect(() => createCanonicalRevisionNoOp('unknown')).toThrowError(
      'canonicalRevisionNoOp.reason',
    );
    expect(() =>
      createCanonicalRevision(
        insertInput({ operation: 'no_op' } as unknown as Partial<CanonicalRevisionInput>),
      ),
    ).toThrowError('canonicalRevision.operation');
    expect(() =>
      createCanonicalRevision(
        insertInput({ arrival: null } as unknown as Partial<CanonicalRevisionInput>),
      ),
    ).toThrowError('canonicalRevision.arrival');
  });
});

describe('canonical revision serialization', () => {
  it('round trips byte-for-byte in fixed field order', () => {
    const revision = createCanonicalRevision(replaceInput());
    const serialized = serializeCanonicalRevision(revision);

    expect(deserializeCanonicalRevision(serialized)).toEqual(revision);
    expect(serializeCanonicalRevision(deserializeCanonicalRevision(serialized))).toBe(serialized);
    expect(serialized.indexOf('"revisionId"')).toBeLessThan(
      serialized.indexOf('"processingPosition"'),
    );
    expect(serialized.indexOf('"processingPosition"')).toBeLessThan(
      serialized.indexOf('"operation"'),
    );
  });

  it.each([
    (value: Record<string, unknown>) => ({ ...value, schemaVersion: 'unknown' }),
    (value: Record<string, unknown>) => ({ ...value, revisionId: '0'.repeat(64) }),
    (value: Record<string, unknown>) => ({ ...value, processingPosition: 2 }),
    (value: Record<string, unknown>) => ({ ...value, extra: true }),
  ])('rejects tampered, unsupported, or noncanonical content', (tamper) => {
    const decoded = JSON.parse(
      serializeCanonicalRevision(createCanonicalRevision(replaceInput())),
    ) as Record<string, unknown>;

    expect(() => deserializeCanonicalRevision(JSON.stringify(tamper(decoded)))).toThrowError();
  });

  it('rejects semantically equivalent JSON in a different field order', () => {
    const revision = createCanonicalRevision(insertInput());
    const decoded = JSON.parse(serializeCanonicalRevision(revision)) as Record<string, unknown>;
    const reordered = JSON.stringify({ kind: decoded.kind, ...decoded });

    expect(() => deserializeCanonicalRevision(reordered)).toThrowError(MarketDataValidationError);
  });
});
