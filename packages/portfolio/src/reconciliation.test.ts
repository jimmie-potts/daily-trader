import { describe, expect, it } from 'vitest';

import type { PortfolioSyncSnapshot } from './contracts.js';
import { PortfolioError } from './errors.js';
import { parsePortfolioSyncSnapshot } from './serialization.js';
import {
  classifyPortfolioSnapshotDelta,
  createPortfolioPreparedProjection,
  diffPortfolioSnapshots,
  preparePortfolioProjection,
  reconcilePortfolioProjection,
  serializePortfolioPreparedProjection,
  serializePortfolioReconciliation,
  serializePortfolioSnapshotDelta,
  type PortfolioPreparedProjection,
} from './reconciliation.js';
import {
  accountObservation,
  fillObservation,
  orderObservation,
  positionObservation,
  shortPositionObservation,
  sourceFingerprint,
  syncSnapshot,
} from './test-helpers.js';

function laterEquivalentSnapshot(): PortfolioSyncSnapshot {
  const accountRequest = sourceFingerprint('request', 'later-account-request');
  const positionRequest = sourceFingerprint('request', 'later-position-request');
  const orderRequest = sourceFingerprint('request', 'later-order-request');
  const fillRequest = sourceFingerprint('request', 'later-fill-request');
  return syncSnapshot({
    captureStartedAt: '2026-07-13T14:31:00.000Z',
    captureCompletedAt: '2026-07-13T14:31:04.000Z',
    activityBaselineOnly: false,
    activityCutoverAt: '2026-07-13T14:31:00.000Z',
    account: accountObservation({
      sourceRequestFingerprint: accountRequest,
      observedAt: '2026-07-13T14:31:00.500Z',
    }),
    positions: [
      positionObservation({
        sourceRequestFingerprint: positionRequest,
        observedAt: '2026-07-13T14:31:01.500Z',
      }),
      shortPositionObservation({
        sourceRequestFingerprint: positionRequest,
        observedAt: '2026-07-13T14:31:01.500Z',
      }),
    ],
    orders: [
      orderObservation({
        sourceRequestFingerprint: orderRequest,
        observedAt: '2026-07-13T14:31:02.500Z',
      }),
    ],
    fills: [
      fillObservation({
        sourceRequestFingerprint: fillRequest,
        observedAt: '2026-07-13T14:31:03.500Z',
      }),
    ],
  });
}

function legacyV1Snapshot(): PortfolioSyncSnapshot {
  const current = syncSnapshot({ positions: [], fills: [] });
  return parsePortfolioSyncSnapshot(
    JSON.stringify({
      ...current,
      schemaVersion: 'daily-trader.portfolio.sync-snapshot.v1',
      orders: [
        {
          ...current.orders[0]!,
          schemaVersion: 'daily-trader.portfolio.order-observation.v1',
          orderObservationId: '010e68b98b3dc92eec77a882f0d2cba26f23bd963c1a925716ef8073a641ea17',
        },
      ],
      snapshotId: '9e9301c6e2d9861de98bdf3e9c51ebf9d556e2a24325c0806bb7c22614d308e8',
    }),
  );
}

function rebuildPrepared(
  source: PortfolioPreparedProjection,
  overrides: Partial<Parameters<typeof createPortfolioPreparedProjection>[0]>,
): PortfolioPreparedProjection {
  return createPortfolioPreparedProjection({
    snapshotId: source.snapshotId,
    accountFingerprint: source.accountFingerprint,
    accountObservationId: source.accountObservationId,
    positions: source.positions,
    orders: source.orders,
    fills: source.fills,
    portfolioResultId: source.portfolioResultId,
    ...overrides,
  });
}

describe('snapshot delta classification', () => {
  it('separates the first observed baseline from reconciliation integrity', () => {
    const current = syncSnapshot();
    const delta = classifyPortfolioSnapshotDelta(null, current);
    expect(delta).toMatchObject({
      status: 'baseline',
      previousSnapshotId: null,
      currentSnapshotId: current.snapshotId,
      diff: {
        accountChanged: true,
        coverageChanged: false,
      },
    });
    expect(delta.diff.positions.added).toHaveLength(2);
    expect(delta.diff.orders.added).toHaveLength(1);
    expect(delta.diff.fills.added).toHaveLength(1);
  });

  it('classifies unchanged provider business facts across later receipt metadata', () => {
    const previous = syncSnapshot();
    const current = laterEquivalentSnapshot();
    expect(current.snapshotId).not.toBe(previous.snapshotId);
    const delta = classifyPortfolioSnapshotDelta(previous, current);
    expect(delta.status).toBe('unchanged');
    expect(delta.diff).toEqual({
      accountChanged: false,
      positions: { added: [], removed: [], changed: [] },
      orders: { added: [], removed: [], changed: [] },
      fills: { added: [], removed: [], changed: [] },
      coverageChanged: false,
    });
  });

  it('classifies exact business revisions, additions, and removals by source fingerprint', () => {
    const previous = syncSnapshot();
    const changedLong = positionObservation({ currentPrice: '41', marketValue: '82' });
    const addedFill = fillObservation({
      fillFingerprint: sourceFingerprint('fill', 'fill-2'),
      quantity: '0.5',
      cumulativeQuantity: '1.5',
      leavesQuantity: '0.5',
      transactionAt: '2026-07-13T10:29:59.999999999-04:00',
    });
    const current = syncSnapshot({
      account: accountObservation({ cash: '39' }),
      positions: [changedLong],
      fills: [fillObservation(), addedFill],
    });
    const delta = classifyPortfolioSnapshotDelta(previous, current);
    expect(delta.status).toBe('changed');
    expect(delta.diff.accountChanged).toBe(true);
    expect(delta.diff.positions.changed).toEqual([changedLong.assetFingerprint]);
    expect(delta.diff.positions.removed).toEqual([shortPositionObservation().assetFingerprint]);
    expect(delta.diff.fills.added).toEqual([addedFill.fillFingerprint]);
  });

  it('reports completeness changes without treating activity cutover movement as business drift', () => {
    const previous = syncSnapshot();
    const incomplete = syncSnapshot({ fillsComplete: false });
    expect(diffPortfolioSnapshots(previous, incomplete).coverageChanged).toBe(true);
    expect(diffPortfolioSnapshots(previous, laterEquivalentSnapshot()).coverageChanged).toBe(false);
  });

  it('rejects delta comparison across account fingerprints', () => {
    const previous = syncSnapshot();
    const accountFingerprint = sourceFingerprint('account', 'another-account');
    const account = accountObservation({ accountFingerprint });
    const current = syncSnapshot({
      account,
      positions: [],
      orders: [],
      fills: [],
    });
    expect(() => classifyPortfolioSnapshotDelta(previous, current)).toThrowError(PortfolioError);
  });

  it('has deterministic serialization and rejects a tampered delta', () => {
    const value = classifyPortfolioSnapshotDelta(syncSnapshot(), laterEquivalentSnapshot());
    expect(serializePortfolioSnapshotDelta(value)).toBe(
      serializePortfolioSnapshotDelta(
        classifyPortfolioSnapshotDelta(syncSnapshot(), laterEquivalentSnapshot()),
      ),
    );
    expect(() => serializePortfolioSnapshotDelta({ ...value, status: 'changed' })).toThrowError(
      PortfolioError,
    );
  });
});

describe('prepared local portfolio projection', () => {
  it('derives deterministic, sorted, immutable local membership from one snapshot', () => {
    const snapshot = syncSnapshot();
    const first = preparePortfolioProjection(snapshot, null);
    const second = preparePortfolioProjection(snapshot, null);
    expect(first.preparedProjectionId).toBe(second.preparedProjectionId);
    expect(first.positions.map((value) => value.assetFingerprint)).toEqual(
      snapshot.positions.map((value) => value.assetFingerprint),
    );
    expect(first.orders[0]).toMatchObject({
      observationId: snapshot.orders[0]?.orderObservationId,
      support: snapshot.orders[0]?.support,
    });
    expect(first.fills[0]?.observationId).toBe(snapshot.fills[0]?.fillObservationId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.positions)).toBe(true);
    expect(serializePortfolioPreparedProjection(first)).toBe(
      serializePortfolioPreparedProjection(second),
    );
  });

  it('binds the optional exact portfolio result identity', () => {
    const snapshot = syncSnapshot();
    const resultId = sourceFingerprint('request', 'result-id-fixture');
    const withoutResult = preparePortfolioProjection(snapshot, null);
    const withResult = preparePortfolioProjection(snapshot, resultId);
    expect(withResult.portfolioResultId).toBe(resultId);
    expect(withResult.preparedProjectionId).not.toBe(withoutResult.preparedProjectionId);
  });

  it('rejects duplicate local resource membership before promotion', () => {
    const source = preparePortfolioProjection(syncSnapshot(), null);
    expect(() =>
      createPortfolioPreparedProjection({
        ...source,
        positions: [source.positions[0]!, source.positions[0]!],
      }),
    ).toThrowError(PortfolioError);
  });

  it('rejects tampered canonical prepared state', () => {
    const value = preparePortfolioProjection(syncSnapshot(), null);
    expect(() =>
      serializePortfolioPreparedProjection({
        ...value,
        accountObservationId: sourceFingerprint('request', 'wrong-account-revision'),
      }),
    ).toThrowError(PortfolioError);
  });
});

describe('provider-observation versus local-projection integrity', () => {
  it('converges only for the exact complete cycle and prepared rows', () => {
    const snapshot = syncSnapshot();
    const prepared = preparePortfolioProjection(snapshot, null);
    const value = reconcilePortfolioProjection(snapshot, prepared);
    expect(value).toEqual({
      schemaVersion: 'daily-trader.portfolio.reconciliation.v1',
      reconciliationId: value.reconciliationId,
      status: 'converged',
      snapshotId: snapshot.snapshotId,
      preparedProjectionId: prepared.preparedProjectionId,
      expectedPortfolioResultId: null,
      reasons: [],
    });
    expect(serializePortfolioReconciliation(value)).toContain('"status":"converged"');
  });

  it('continues to reconcile a validated legacy v1 snapshot', () => {
    const snapshot = legacyV1Snapshot();
    const prepared = preparePortfolioProjection(snapshot, null);

    expect(reconcilePortfolioProjection(snapshot, prepared)).toMatchObject({
      status: 'converged',
      snapshotId: snapshot.snapshotId,
      reasons: [],
    });
  });

  it('makes missing local state and incomplete provider evidence unavailable', () => {
    const snapshot = syncSnapshot();
    expect(reconcilePortfolioProjection(snapshot, null)).toMatchObject({
      status: 'unavailable',
      reasons: ['local_projection_unavailable'],
    });

    const incomplete = syncSnapshot({ ordersComplete: false });
    expect(
      reconcilePortfolioProjection(incomplete, preparePortfolioProjection(incomplete, null)),
    ).toMatchObject({
      status: 'unavailable',
      reasons: ['provider_evidence_incomplete'],
    });
  });

  it.each([
    [
      'cycle_identity_mismatch',
      (prepared: PortfolioPreparedProjection) =>
        rebuildPrepared(prepared, {
          snapshotId: sourceFingerprint('request', 'wrong-cycle'),
        }),
    ],
    [
      'account_fingerprint_mismatch',
      (prepared: PortfolioPreparedProjection) =>
        rebuildPrepared(prepared, {
          accountFingerprint: sourceFingerprint('account', 'wrong-account'),
        }),
    ],
    [
      'account_observation_mismatch',
      (prepared: PortfolioPreparedProjection) =>
        rebuildPrepared(prepared, {
          accountObservationId: sourceFingerprint('request', 'wrong-account-observation'),
        }),
    ],
    [
      'position_membership_mismatch',
      (prepared: PortfolioPreparedProjection) =>
        rebuildPrepared(prepared, { positions: prepared.positions.slice(1) }),
    ],
    [
      'order_membership_mismatch',
      (prepared: PortfolioPreparedProjection) => rebuildPrepared(prepared, { orders: [] }),
    ],
    [
      'fill_membership_mismatch',
      (prepared: PortfolioPreparedProjection) => rebuildPrepared(prepared, { fills: [] }),
    ],
    [
      'support_classification_mismatch',
      (prepared: PortfolioPreparedProjection) =>
        rebuildPrepared(prepared, {
          positions: prepared.positions.map((value, index) =>
            index === 0
              ? {
                  ...value,
                  support: { state: 'unsupported', reason: 'missing_instrument' },
                }
              : value,
          ),
        }),
    ],
  ] as const)('persists bounded drift for %s', (reason, mutate) => {
    const snapshot = syncSnapshot();
    const prepared = mutate(preparePortfolioProjection(snapshot, null));
    const value = reconcilePortfolioProjection(snapshot, prepared);
    expect(value.status).toBe('drift');
    expect(value.reasons).toContain(reason);
  });

  it('detects mismatched portfolio result identity without conflating snapshot change', () => {
    const snapshot = syncSnapshot();
    const expected = sourceFingerprint('request', 'expected-result');
    const wrong = sourceFingerprint('request', 'wrong-result');
    const prepared = preparePortfolioProjection(snapshot, wrong);
    const value = reconcilePortfolioProjection(snapshot, prepared, expected);
    expect(value.status).toBe('drift');
    expect(value.reasons).toEqual(['portfolio_result_mismatch']);
  });

  it('detects a tampered local canonical identity and duplicate local rows', () => {
    const snapshot = syncSnapshot();
    const prepared = preparePortfolioProjection(snapshot, null);
    const tampered = {
      ...prepared,
      accountObservationId: sourceFingerprint('request', 'tampered-account-observation'),
      positions: [prepared.positions[0]!, prepared.positions[0]!],
    } as PortfolioPreparedProjection;
    const value = reconcilePortfolioProjection(snapshot, tampered);
    expect(value.status).toBe('drift');
    expect(value.reasons).toEqual(
      expect.arrayContaining([
        'account_observation_mismatch',
        'duplicate_local_membership',
        'local_projection_identity_mismatch',
        'position_membership_mismatch',
        'support_classification_mismatch',
      ]),
    );
  });

  it('makes an unknown prepared projection version unavailable', () => {
    const snapshot = syncSnapshot();
    const prepared = {
      ...preparePortfolioProjection(snapshot, null),
      schemaVersion: 'daily-trader.portfolio.prepared-projection.v999',
    } as unknown as PortfolioPreparedProjection;
    expect(reconcilePortfolioProjection(snapshot, prepared)).toMatchObject({
      status: 'unavailable',
      reasons: ['projection_version_unsupported'],
    });
  });

  it('is deterministic for the same immutable evidence and rejects tampered output', () => {
    const snapshot = syncSnapshot();
    const prepared = preparePortfolioProjection(snapshot, null);
    const first = reconcilePortfolioProjection(snapshot, prepared);
    const second = reconcilePortfolioProjection(snapshot, prepared);
    expect(second.reconciliationId).toBe(first.reconciliationId);
    expect(serializePortfolioReconciliation(second)).toBe(serializePortfolioReconciliation(first));
    expect(() => serializePortfolioReconciliation({ ...first, status: 'drift' })).toThrowError(
      PortfolioError,
    );
  });
});
