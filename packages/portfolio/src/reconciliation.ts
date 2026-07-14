import {
  PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION,
  PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION_V1,
  accountObservationContent,
  fillObservationContent,
  observationIdentityContent,
  orderObservationContent,
  positionObservationContent,
  type PortfolioHoldingSupport,
  type PortfolioSyncSnapshot,
} from './contracts.js';
import { PortfolioError } from './errors.js';
import {
  createPortfolioFingerprint,
  hashPortfolioCanonical,
  type PortfolioFingerprint,
} from './identity.js';

export const PORTFOLIO_PREPARED_PROJECTION_SCHEMA_VERSION =
  'daily-trader.portfolio.prepared-projection.v1' as const;
export const PORTFOLIO_RECONCILIATION_SCHEMA_VERSION =
  'daily-trader.portfolio.reconciliation.v1' as const;
export const PORTFOLIO_SNAPSHOT_DELTA_SCHEMA_VERSION =
  'daily-trader.portfolio.snapshot-delta.v1' as const;

export interface PortfolioResourceDiff {
  readonly added: readonly PortfolioFingerprint[];
  readonly removed: readonly PortfolioFingerprint[];
  readonly changed: readonly PortfolioFingerprint[];
}

export interface PortfolioSnapshotDiff {
  readonly accountChanged: boolean;
  readonly positions: PortfolioResourceDiff;
  readonly orders: PortfolioResourceDiff;
  readonly fills: PortfolioResourceDiff;
  readonly coverageChanged: boolean;
}

export type PortfolioSnapshotDeltaStatus = 'baseline' | 'changed' | 'unchanged';

export interface PortfolioSnapshotDelta {
  readonly schemaVersion: typeof PORTFOLIO_SNAPSHOT_DELTA_SCHEMA_VERSION;
  readonly deltaId: PortfolioFingerprint;
  readonly status: PortfolioSnapshotDeltaStatus;
  readonly previousSnapshotId: PortfolioFingerprint | null;
  readonly currentSnapshotId: PortfolioFingerprint;
  readonly diff: PortfolioSnapshotDiff;
}

export interface PortfolioPreparedPositionMembership {
  readonly assetFingerprint: PortfolioFingerprint;
  readonly observationId: PortfolioFingerprint;
  readonly support: PortfolioHoldingSupport;
}

export interface PortfolioPreparedOrderMembership {
  readonly orderFingerprint: PortfolioFingerprint;
  readonly observationId: PortfolioFingerprint;
  readonly support: PortfolioHoldingSupport;
}

export interface PortfolioPreparedFillMembership {
  readonly fillFingerprint: PortfolioFingerprint;
  readonly observationId: PortfolioFingerprint;
}

/**
 * Application-owned current rows prepared for atomic promotion. This is not a
 * portfolio calculation and it is not independent accounting state.
 */
export interface PortfolioPreparedProjection {
  readonly schemaVersion: typeof PORTFOLIO_PREPARED_PROJECTION_SCHEMA_VERSION;
  readonly preparedProjectionId: PortfolioFingerprint;
  readonly snapshotId: PortfolioFingerprint;
  readonly accountFingerprint: PortfolioFingerprint;
  readonly accountObservationId: PortfolioFingerprint;
  readonly positions: readonly PortfolioPreparedPositionMembership[];
  readonly orders: readonly PortfolioPreparedOrderMembership[];
  readonly fills: readonly PortfolioPreparedFillMembership[];
  readonly portfolioResultId: PortfolioFingerprint | null;
}

export interface CreatePortfolioPreparedProjectionInput {
  readonly snapshotId: unknown;
  readonly accountFingerprint: unknown;
  readonly accountObservationId: unknown;
  readonly positions: readonly PortfolioPreparedPositionMembership[];
  readonly orders: readonly PortfolioPreparedOrderMembership[];
  readonly fills: readonly PortfolioPreparedFillMembership[];
  readonly portfolioResultId: unknown;
}

export type PortfolioReconciliationStatus = 'converged' | 'drift' | 'unavailable';

export type PortfolioReconciliationReason =
  | 'account_fingerprint_mismatch'
  | 'account_observation_mismatch'
  | 'cycle_identity_mismatch'
  | 'duplicate_local_membership'
  | 'fill_membership_mismatch'
  | 'local_projection_identity_mismatch'
  | 'local_projection_unavailable'
  | 'order_membership_mismatch'
  | 'portfolio_result_mismatch'
  | 'position_membership_mismatch'
  | 'projection_version_unsupported'
  | 'provider_evidence_incomplete'
  | 'support_classification_mismatch';

export interface PortfolioReconciliation {
  readonly schemaVersion: typeof PORTFOLIO_RECONCILIATION_SCHEMA_VERSION;
  readonly reconciliationId: PortfolioFingerprint;
  readonly status: PortfolioReconciliationStatus;
  readonly snapshotId: PortfolioFingerprint;
  readonly preparedProjectionId: PortfolioFingerprint | null;
  readonly expectedPortfolioResultId: PortfolioFingerprint | null;
  readonly reasons: readonly PortfolioReconciliationReason[];
}

function resourceDiff<T>(
  previous: readonly T[],
  current: readonly T[],
  key: (value: T) => PortfolioFingerprint,
  version: (value: T) => PortfolioFingerprint,
): PortfolioResourceDiff {
  const previousByKey = new Map(previous.map((value) => [key(value), version(value)]));
  const currentByKey = new Map(current.map((value) => [key(value), version(value)]));
  const added: PortfolioFingerprint[] = [];
  const removed: PortfolioFingerprint[] = [];
  const changed: PortfolioFingerprint[] = [];
  for (const [identifier, currentVersion] of currentByKey) {
    const priorVersion = previousByKey.get(identifier);
    if (priorVersion === undefined) added.push(identifier);
    else if (priorVersion !== currentVersion) changed.push(identifier);
  }
  for (const identifier of previousByKey.keys()) {
    if (!currentByKey.has(identifier)) removed.push(identifier);
  }
  return Object.freeze({
    added: Object.freeze(added.sort()),
    removed: Object.freeze(removed.sort()),
    changed: Object.freeze(changed.sort()),
  });
}

function stateFingerprint(content: Readonly<Record<string, unknown>>): PortfolioFingerprint {
  return hashPortfolioCanonical(JSON.stringify(observationIdentityContent(content)));
}

export function diffPortfolioSnapshots(
  previous: PortfolioSyncSnapshot | null,
  current: PortfolioSyncSnapshot,
): PortfolioSnapshotDiff {
  if (previous !== null && previous.accountFingerprint !== current.accountFingerprint) {
    throw new PortfolioError('reconciliation_invalid');
  }
  if (previous === null) {
    return Object.freeze({
      accountChanged: true,
      positions: resourceDiff(
        [],
        current.positions,
        (value) => value.assetFingerprint,
        (value) => stateFingerprint(positionObservationContent(value)),
      ),
      orders: resourceDiff(
        [],
        current.orders,
        (value) => value.orderFingerprint,
        (value) => stateFingerprint(orderObservationContent(value)),
      ),
      fills: resourceDiff(
        [],
        current.fills,
        (value) => value.fillFingerprint,
        (value) => stateFingerprint(fillObservationContent(value)),
      ),
      coverageChanged: false,
    });
  }
  return Object.freeze({
    accountChanged:
      stateFingerprint(accountObservationContent(previous.account)) !==
      stateFingerprint(accountObservationContent(current.account)),
    positions: resourceDiff(
      previous.positions,
      current.positions,
      (value) => value.assetFingerprint,
      (value) => stateFingerprint(positionObservationContent(value)),
    ),
    orders: resourceDiff(
      previous.orders,
      current.orders,
      (value) => value.orderFingerprint,
      (value) => stateFingerprint(orderObservationContent(value)),
    ),
    fills: resourceDiff(
      previous.fills,
      current.fills,
      (value) => value.fillFingerprint,
      (value) => stateFingerprint(fillObservationContent(value)),
    ),
    coverageChanged:
      previous.coverage.positionsComplete !== current.coverage.positionsComplete ||
      previous.coverage.ordersComplete !== current.coverage.ordersComplete ||
      previous.coverage.fillsComplete !== current.coverage.fillsComplete,
  });
}

function hasResourceChanges(diff: PortfolioResourceDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}

function snapshotDeltaContent(
  delta: Omit<PortfolioSnapshotDelta, 'deltaId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: delta.schemaVersion,
    status: delta.status,
    previousSnapshotId: delta.previousSnapshotId,
    currentSnapshotId: delta.currentSnapshotId,
    diff: delta.diff,
  };
}

/** Classifies broker snapshot change independently from projection integrity. */
export function classifyPortfolioSnapshotDelta(
  previous: PortfolioSyncSnapshot | null,
  current: PortfolioSyncSnapshot,
): PortfolioSnapshotDelta {
  const diff = diffPortfolioSnapshots(previous, current);
  const changed =
    diff.accountChanged ||
    diff.coverageChanged ||
    hasResourceChanges(diff.positions) ||
    hasResourceChanges(diff.orders) ||
    hasResourceChanges(diff.fills);
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_SNAPSHOT_DELTA_SCHEMA_VERSION,
    status:
      previous === null
        ? ('baseline' as const)
        : changed
          ? ('changed' as const)
          : ('unchanged' as const),
    previousSnapshotId: previous?.snapshotId ?? null,
    currentSnapshotId: current.snapshotId,
    diff,
  });
  return Object.freeze({
    ...unsigned,
    deltaId: hashPortfolioCanonical(JSON.stringify(snapshotDeltaContent(unsigned))),
  });
}

function support(value: PortfolioHoldingSupport): PortfolioHoldingSupport {
  return value.state === 'supported'
    ? Object.freeze({ state: 'supported', reason: null })
    : Object.freeze({ state: 'unsupported', reason: value.reason });
}

function runtimeSchemaVersion(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>).schemaVersion
    : undefined;
}

function optionalFingerprint(value: unknown): PortfolioFingerprint | null {
  return value === null ? null : createPortfolioFingerprint(value);
}

function unique<T>(values: readonly T[], key: (value: T) => PortfolioFingerprint): void {
  const identifiers = new Set<PortfolioFingerprint>();
  for (const value of values) {
    const identifier = key(value);
    if (identifiers.has(identifier)) throw new PortfolioError('reconciliation_invalid');
    identifiers.add(identifier);
  }
}

export function preparedPortfolioProjectionContent(
  projection: Omit<PortfolioPreparedProjection, 'preparedProjectionId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: projection.schemaVersion,
    snapshotId: projection.snapshotId,
    accountFingerprint: projection.accountFingerprint,
    accountObservationId: projection.accountObservationId,
    positions: projection.positions,
    orders: projection.orders,
    fills: projection.fills,
    portfolioResultId: projection.portfolioResultId,
  };
}

export function createPortfolioPreparedProjection(
  input: CreatePortfolioPreparedProjectionInput,
): PortfolioPreparedProjection {
  const positions = input.positions
    .map((value) =>
      Object.freeze({
        assetFingerprint: createPortfolioFingerprint(value.assetFingerprint),
        observationId: createPortfolioFingerprint(value.observationId),
        support: support(value.support),
      }),
    )
    .sort((left, right) => left.assetFingerprint.localeCompare(right.assetFingerprint));
  const orders = input.orders
    .map((value) =>
      Object.freeze({
        orderFingerprint: createPortfolioFingerprint(value.orderFingerprint),
        observationId: createPortfolioFingerprint(value.observationId),
        support: support(value.support),
      }),
    )
    .sort((left, right) => left.orderFingerprint.localeCompare(right.orderFingerprint));
  const fills = input.fills
    .map((value) =>
      Object.freeze({
        fillFingerprint: createPortfolioFingerprint(value.fillFingerprint),
        observationId: createPortfolioFingerprint(value.observationId),
      }),
    )
    .sort((left, right) => left.fillFingerprint.localeCompare(right.fillFingerprint));
  unique(positions, (value) => value.assetFingerprint);
  unique(orders, (value) => value.orderFingerprint);
  unique(fills, (value) => value.fillFingerprint);
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_PREPARED_PROJECTION_SCHEMA_VERSION,
    snapshotId: createPortfolioFingerprint(input.snapshotId),
    accountFingerprint: createPortfolioFingerprint(input.accountFingerprint),
    accountObservationId: createPortfolioFingerprint(input.accountObservationId),
    positions: Object.freeze(positions),
    orders: Object.freeze(orders),
    fills: Object.freeze(fills),
    portfolioResultId: optionalFingerprint(input.portfolioResultId),
  });
  return Object.freeze({
    ...unsigned,
    preparedProjectionId: hashPortfolioCanonical(
      JSON.stringify(preparedPortfolioProjectionContent(unsigned)),
    ),
  });
}

/** Derives the local rows that a persistence adapter should prepare for promotion. */
export function preparePortfolioProjection(
  snapshot: PortfolioSyncSnapshot,
  portfolioResultId: PortfolioFingerprint | null,
): PortfolioPreparedProjection {
  return createPortfolioPreparedProjection({
    snapshotId: snapshot.snapshotId,
    accountFingerprint: snapshot.accountFingerprint,
    accountObservationId: snapshot.account.accountObservationId,
    positions: snapshot.positions.map((value) => ({
      assetFingerprint: value.assetFingerprint,
      observationId: value.positionObservationId,
      support: value.support,
    })),
    orders: snapshot.orders.map((value) => ({
      orderFingerprint: value.orderFingerprint,
      observationId: value.orderObservationId,
      support: value.support,
    })),
    fills: snapshot.fills.map((value) => ({
      fillFingerprint: value.fillFingerprint,
      observationId: value.fillObservationId,
    })),
    portfolioResultId,
  });
}

function duplicatePreparedMembership(value: PortfolioPreparedProjection): boolean {
  return (
    new Set(value.positions.map((item) => item.assetFingerprint)).size !== value.positions.length ||
    new Set(value.orders.map((item) => item.orderFingerprint)).size !== value.orders.length ||
    new Set(value.fills.map((item) => item.fillFingerprint)).size !== value.fills.length
  );
}

function membershipIdentity<T>(
  values: readonly T[],
  key: (value: T) => PortfolioFingerprint,
  observation: (value: T) => PortfolioFingerprint,
): string {
  return JSON.stringify(
    values
      .map((value) => [key(value), observation(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function supportIdentity<T>(
  values: readonly T[],
  key: (value: T) => PortfolioFingerprint,
  itemSupport: (value: T) => PortfolioHoldingSupport,
): string {
  return JSON.stringify(
    values
      .map((value) => [key(value), itemSupport(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function reconciliationContent(
  reconciliation: Omit<PortfolioReconciliation, 'reconciliationId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: reconciliation.schemaVersion,
    status: reconciliation.status,
    snapshotId: reconciliation.snapshotId,
    preparedProjectionId: reconciliation.preparedProjectionId,
    expectedPortfolioResultId: reconciliation.expectedPortfolioResultId,
    reasons: reconciliation.reasons,
  };
}

function createReconciliation(
  snapshot: PortfolioSyncSnapshot,
  preparedProjection: PortfolioPreparedProjection | null,
  expectedPortfolioResultId: PortfolioFingerprint | null,
  status: PortfolioReconciliationStatus,
  reasons: readonly PortfolioReconciliationReason[],
): PortfolioReconciliation {
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_RECONCILIATION_SCHEMA_VERSION,
    status,
    snapshotId: snapshot.snapshotId,
    preparedProjectionId: preparedProjection?.preparedProjectionId ?? null,
    expectedPortfolioResultId,
    reasons: Object.freeze([...new Set(reasons)].sort()),
  });
  return Object.freeze({
    ...unsigned,
    reconciliationId: hashPortfolioCanonical(JSON.stringify(reconciliationContent(unsigned))),
  });
}

/**
 * Checks one immutable provider cycle against the local rows prepared for
 * promotion. Snapshot change classification is intentionally a separate API.
 */
export function reconcilePortfolioProjection(
  snapshot: PortfolioSyncSnapshot,
  preparedProjection: PortfolioPreparedProjection | null,
  expectedPortfolioResultId: PortfolioFingerprint | null = null,
): PortfolioReconciliation {
  const expectedResult = optionalFingerprint(expectedPortfolioResultId);
  const snapshotSchemaVersion = runtimeSchemaVersion(snapshot);
  if (
    (snapshotSchemaVersion !== PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION_V1 &&
      snapshotSchemaVersion !== PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION) ||
    !snapshot.coverage.positionsComplete ||
    !snapshot.coverage.ordersComplete ||
    !snapshot.coverage.fillsComplete
  ) {
    return createReconciliation(snapshot, preparedProjection, expectedResult, 'unavailable', [
      'provider_evidence_incomplete',
    ]);
  }
  if (preparedProjection === null) {
    return createReconciliation(snapshot, null, expectedResult, 'unavailable', [
      'local_projection_unavailable',
    ]);
  }
  if (runtimeSchemaVersion(preparedProjection) !== PORTFOLIO_PREPARED_PROJECTION_SCHEMA_VERSION) {
    return createReconciliation(snapshot, preparedProjection, expectedResult, 'unavailable', [
      'projection_version_unsupported',
    ]);
  }

  const reasons: PortfolioReconciliationReason[] = [];
  try {
    if (
      hashPortfolioCanonical(
        JSON.stringify(preparedPortfolioProjectionContent(preparedProjection)),
      ) !== preparedProjection.preparedProjectionId
    ) {
      reasons.push('local_projection_identity_mismatch');
    }
  } catch {
    reasons.push('local_projection_identity_mismatch');
  }
  if (duplicatePreparedMembership(preparedProjection)) {
    reasons.push('duplicate_local_membership');
  }
  if (preparedProjection.snapshotId !== snapshot.snapshotId) {
    reasons.push('cycle_identity_mismatch');
  }
  if (preparedProjection.accountFingerprint !== snapshot.accountFingerprint) {
    reasons.push('account_fingerprint_mismatch');
  }
  if (preparedProjection.accountObservationId !== snapshot.account.accountObservationId) {
    reasons.push('account_observation_mismatch');
  }
  if (
    membershipIdentity(
      preparedProjection.positions,
      (value) => value.assetFingerprint,
      (value) => value.observationId,
    ) !==
    membershipIdentity(
      snapshot.positions,
      (value) => value.assetFingerprint,
      (value) => value.positionObservationId,
    )
  ) {
    reasons.push('position_membership_mismatch');
  }
  if (
    membershipIdentity(
      preparedProjection.orders,
      (value) => value.orderFingerprint,
      (value) => value.observationId,
    ) !==
    membershipIdentity(
      snapshot.orders,
      (value) => value.orderFingerprint,
      (value) => value.orderObservationId,
    )
  ) {
    reasons.push('order_membership_mismatch');
  }
  if (
    membershipIdentity(
      preparedProjection.fills,
      (value) => value.fillFingerprint,
      (value) => value.observationId,
    ) !==
    membershipIdentity(
      snapshot.fills,
      (value) => value.fillFingerprint,
      (value) => value.fillObservationId,
    )
  ) {
    reasons.push('fill_membership_mismatch');
  }
  if (
    supportIdentity(
      preparedProjection.positions,
      (value) => value.assetFingerprint,
      (value) => value.support,
    ) !==
      supportIdentity(
        snapshot.positions,
        (value) => value.assetFingerprint,
        (value) => value.support,
      ) ||
    supportIdentity(
      preparedProjection.orders,
      (value) => value.orderFingerprint,
      (value) => value.support,
    ) !==
      supportIdentity(
        snapshot.orders,
        (value) => value.orderFingerprint,
        (value) => value.support,
      )
  ) {
    reasons.push('support_classification_mismatch');
  }
  if (preparedProjection.portfolioResultId !== expectedResult) {
    reasons.push('portfolio_result_mismatch');
  }
  return createReconciliation(
    snapshot,
    preparedProjection,
    expectedResult,
    reasons.length === 0 ? 'converged' : 'drift',
    reasons,
  );
}

export function serializePortfolioPreparedProjection(value: PortfolioPreparedProjection): string {
  if (
    runtimeSchemaVersion(value) !== PORTFOLIO_PREPARED_PROJECTION_SCHEMA_VERSION ||
    hashPortfolioCanonical(JSON.stringify(preparedPortfolioProjectionContent(value))) !==
      value.preparedProjectionId
  ) {
    throw new PortfolioError('serialization_invalid');
  }
  return JSON.stringify({
    ...preparedPortfolioProjectionContent(value),
    preparedProjectionId: value.preparedProjectionId,
  });
}

export function serializePortfolioSnapshotDelta(value: PortfolioSnapshotDelta): string {
  if (
    runtimeSchemaVersion(value) !== PORTFOLIO_SNAPSHOT_DELTA_SCHEMA_VERSION ||
    hashPortfolioCanonical(JSON.stringify(snapshotDeltaContent(value))) !== value.deltaId
  ) {
    throw new PortfolioError('serialization_invalid');
  }
  return JSON.stringify({ ...snapshotDeltaContent(value), deltaId: value.deltaId });
}

export function serializePortfolioReconciliation(value: PortfolioReconciliation): string {
  if (
    runtimeSchemaVersion(value) !== PORTFOLIO_RECONCILIATION_SCHEMA_VERSION ||
    hashPortfolioCanonical(JSON.stringify(reconciliationContent(value))) !== value.reconciliationId
  ) {
    throw new PortfolioError('serialization_invalid');
  }
  return JSON.stringify({
    ...reconciliationContent(value),
    reconciliationId: value.reconciliationId,
  });
}
