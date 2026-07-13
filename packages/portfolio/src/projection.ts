import type { InstrumentId, UtcTimestamp } from '@daily-trader/domain';

import {
  PORTFOLIO_ARITHMETIC_POLICY_VERSION,
  absolutePortfolioDecimal,
  addPortfolioDecimals,
  comparePortfolioDecimals,
  createPortfolioDecimal,
  portfolioPercentage,
  subtractPortfolioDecimals,
  type PortfolioDecimal,
} from './arithmetic.js';
import {
  PORTFOLIO_MARK_SOURCE,
  type PortfolioPositionObservation,
  type PortfolioPositionSide,
  type PortfolioSyncSnapshot,
} from './contracts.js';
import { hashPortfolioCanonical, type PortfolioFingerprint } from './identity.js';
import type { PortfolioReconciliation } from './reconciliation.js';

export const PORTFOLIO_PROJECTION_SCHEMA_VERSION = 'daily-trader.portfolio.projection.v1' as const;
export const PORTFOLIO_VALUATION_POLICY_VERSION =
  'daily-trader.portfolio.valuation.alpaca-paper-broker-mark.v1' as const;

export type PortfolioProjectionIncompleteReasonCode =
  | 'arithmetic_failure'
  | 'missing_current_price'
  | 'missing_market_value'
  | 'missing_unrealized_profit_loss'
  | 'position_snapshot_incomplete'
  | 'side_market_value_mismatch'
  | 'unreconciled_input'
  | 'unsupported_account_currency'
  | 'unsupported_holding';

export interface PortfolioProjectionIncompleteReason {
  readonly code: PortfolioProjectionIncompleteReasonCode;
  readonly assetFingerprint: PortfolioFingerprint | null;
}

export interface PortfolioPositionProjection {
  readonly assetFingerprint: PortfolioFingerprint;
  readonly positionObservationId: PortfolioFingerprint;
  readonly symbol: string;
  readonly instrument: InstrumentId | null;
  readonly side: PortfolioPositionSide;
  readonly state: 'complete' | 'incomplete';
  readonly reasons: readonly PortfolioProjectionIncompleteReasonCode[];
  readonly quantity: PortfolioDecimal;
  readonly currentPrice: PortfolioDecimal | null;
  readonly marketValue: PortfolioDecimal | null;
  readonly costBasis: PortfolioDecimal | null;
  readonly unrealizedProfitLoss: PortfolioDecimal | null;
  readonly allocationPercent: PortfolioDecimal | null;
  readonly markSource: typeof PORTFOLIO_MARK_SOURCE;
}

export interface PortfolioAggregateMetrics {
  readonly currency: 'USD';
  readonly cash: PortfolioDecimal;
  readonly equity: PortfolioDecimal;
  readonly portfolioValue: PortfolioDecimal;
  readonly dailyProfitLoss: PortfolioDecimal;
  readonly dailyProfitLossPercent: PortfolioDecimal | null;
  readonly totalUnrealizedProfitLoss: PortfolioDecimal;
  readonly longExposure: PortfolioDecimal;
  readonly shortExposure: PortfolioDecimal;
  readonly grossExposure: PortfolioDecimal;
  readonly netExposure: PortfolioDecimal;
  readonly grossExposurePercent: PortfolioDecimal | null;
  readonly netExposurePercent: PortfolioDecimal | null;
  readonly largestPositionConcentrationPercent: PortfolioDecimal | null;
}

interface PortfolioProjectionBase {
  readonly schemaVersion: typeof PORTFOLIO_PROJECTION_SCHEMA_VERSION;
  readonly arithmeticPolicyVersion: typeof PORTFOLIO_ARITHMETIC_POLICY_VERSION;
  readonly valuationPolicyVersion: typeof PORTFOLIO_VALUATION_POLICY_VERSION;
  readonly projectionId: PortfolioFingerprint;
  readonly snapshotId: PortfolioFingerprint;
  readonly reconciliationId: PortfolioFingerprint;
  readonly accountFingerprint: PortfolioFingerprint;
  readonly observedAt: UtcTimestamp;
  readonly markSource: typeof PORTFOLIO_MARK_SOURCE;
  readonly knowledgeInterval: PortfolioSyncSnapshot['knowledgeInterval'];
  readonly positions: readonly PortfolioPositionProjection[];
}

export interface CompletePortfolioProjection extends PortfolioProjectionBase {
  readonly state: 'complete';
  readonly incompleteReasons: readonly [];
  readonly metrics: PortfolioAggregateMetrics;
}

export interface IncompletePortfolioProjection extends PortfolioProjectionBase {
  readonly state: 'incomplete';
  readonly incompleteReasons: readonly PortfolioProjectionIncompleteReason[];
  readonly metrics: null;
}

export type PortfolioProjection = CompletePortfolioProjection | IncompletePortfolioProjection;

const ZERO = createPortfolioDecimal('0');
const NO_INCOMPLETE_REASONS: readonly [] = Object.freeze([]);

interface MutablePositionProjection {
  readonly observation: PortfolioPositionObservation;
  readonly reasons: PortfolioProjectionIncompleteReasonCode[];
  allocationPercent: PortfolioDecimal | null;
}

function projectPosition(observation: PortfolioPositionObservation): MutablePositionProjection {
  const reasons: PortfolioProjectionIncompleteReasonCode[] = [];
  if (observation.support.state === 'unsupported') reasons.push('unsupported_holding');
  if (observation.currentPrice === null) reasons.push('missing_current_price');
  if (observation.marketValue === null) reasons.push('missing_market_value');
  if (observation.providerUnrealizedProfitLoss === null) {
    reasons.push('missing_unrealized_profit_loss');
  }
  if (observation.marketValue !== null) {
    const sign = comparePortfolioDecimals(observation.marketValue, ZERO);
    if ((observation.side === 'long' && sign < 0) || (observation.side === 'short' && sign > 0)) {
      reasons.push('side_market_value_mismatch');
    }
  }
  return { observation, reasons, allocationPercent: null };
}

function immutablePosition(value: MutablePositionProjection): PortfolioPositionProjection {
  return Object.freeze({
    assetFingerprint: value.observation.assetFingerprint,
    positionObservationId: value.observation.positionObservationId,
    symbol: value.observation.symbol,
    instrument: value.observation.instrument,
    side: value.observation.side,
    state: value.reasons.length === 0 ? 'complete' : 'incomplete',
    reasons: Object.freeze([...new Set(value.reasons)].sort()),
    quantity: value.observation.quantity,
    currentPrice: value.observation.currentPrice,
    marketValue: value.observation.marketValue,
    costBasis: value.observation.costBasis,
    unrealizedProfitLoss: value.observation.providerUnrealizedProfitLoss,
    allocationPercent: value.allocationPercent,
    markSource: PORTFOLIO_MARK_SOURCE,
  });
}

export function portfolioProjectionContent(
  projection: Omit<PortfolioProjection, 'projectionId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: projection.schemaVersion,
    arithmeticPolicyVersion: projection.arithmeticPolicyVersion,
    valuationPolicyVersion: projection.valuationPolicyVersion,
    state: projection.state,
    snapshotId: projection.snapshotId,
    reconciliationId: projection.reconciliationId,
    accountFingerprint: projection.accountFingerprint,
    observedAt: projection.observedAt,
    markSource: projection.markSource,
    knowledgeInterval: projection.knowledgeInterval,
    incompleteReasons: projection.incompleteReasons,
    metrics: projection.metrics,
    positions: projection.positions,
  };
}

function incompleteProjection(
  snapshot: PortfolioSyncSnapshot,
  reconciliation: PortfolioReconciliation,
  positions: readonly MutablePositionProjection[],
  additionalReasons: readonly PortfolioProjectionIncompleteReason[],
): IncompletePortfolioProjection {
  const reasons = [
    ...additionalReasons,
    ...positions.flatMap((position) =>
      position.reasons.map((code) => ({
        code,
        assetFingerprint: position.observation.assetFingerprint,
      })),
    ),
  ]
    .filter(
      (value, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.code === value.code && candidate.assetFingerprint === value.assetFingerprint,
        ) === index,
    )
    .sort(
      (left, right) =>
        (left.assetFingerprint ?? '').localeCompare(right.assetFingerprint ?? '') ||
        left.code.localeCompare(right.code),
    );
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_PROJECTION_SCHEMA_VERSION,
    arithmeticPolicyVersion: PORTFOLIO_ARITHMETIC_POLICY_VERSION,
    valuationPolicyVersion: PORTFOLIO_VALUATION_POLICY_VERSION,
    state: 'incomplete' as const,
    snapshotId: snapshot.snapshotId,
    reconciliationId: reconciliation.reconciliationId,
    accountFingerprint: snapshot.accountFingerprint,
    observedAt: snapshot.knowledgeInterval.captureCompletedAt,
    markSource: PORTFOLIO_MARK_SOURCE,
    knowledgeInterval: snapshot.knowledgeInterval,
    incompleteReasons: Object.freeze(reasons),
    metrics: null,
    positions: Object.freeze(positions.map(immutablePosition)),
  });
  return Object.freeze({
    ...unsigned,
    projectionId: hashPortfolioCanonical(JSON.stringify(portfolioProjectionContent(unsigned))),
  });
}

/**
 * Calculates one already-reconciled broker-mark snapshot. Aggregate values are
 * withheld whenever one holding is unsupported, unvalued, internally
 * inconsistent, or the positions response was incomplete.
 */
export function projectPortfolioSnapshot(
  snapshot: PortfolioSyncSnapshot,
  reconciliation: PortfolioReconciliation,
): PortfolioProjection {
  const positions = snapshot.positions.map(projectPosition);
  const additionalReasons: PortfolioProjectionIncompleteReason[] = [];
  if (reconciliation.status !== 'converged' || reconciliation.snapshotId !== snapshot.snapshotId) {
    additionalReasons.push({ code: 'unreconciled_input', assetFingerprint: null });
  }
  if (!snapshot.coverage.positionsComplete) {
    additionalReasons.push({ code: 'position_snapshot_incomplete', assetFingerprint: null });
  }
  if (snapshot.account.currency !== 'USD') {
    additionalReasons.push({ code: 'unsupported_account_currency', assetFingerprint: null });
  }
  if (positions.some((position) => position.reasons.length > 0) || additionalReasons.length > 0) {
    return incompleteProjection(snapshot, reconciliation, positions, additionalReasons);
  }

  try {
    const marketValues = positions.map((position) => position.observation.marketValue);
    const unrealizedValues = positions.map(
      (position) => position.observation.providerUnrealizedProfitLoss,
    );
    if (
      marketValues.some((value) => value === null) ||
      unrealizedValues.some((value) => value === null)
    ) {
      return incompleteProjection(snapshot, reconciliation, positions, [
        { code: 'arithmetic_failure', assetFingerprint: null },
      ]);
    }
    const valuedMarketValues = marketValues as PortfolioDecimal[];
    const valuedUnrealized = unrealizedValues as PortfolioDecimal[];
    const longValues = valuedMarketValues.filter(
      (value) => comparePortfolioDecimals(value, ZERO) >= 0,
    );
    const shortValues = valuedMarketValues
      .filter((value) => comparePortfolioDecimals(value, ZERO) < 0)
      .map(absolutePortfolioDecimal);
    const longExposure = addPortfolioDecimals(longValues);
    const shortExposure = addPortfolioDecimals(shortValues);
    const grossExposure = addPortfolioDecimals([longExposure, shortExposure]);
    const netExposure = addPortfolioDecimals(valuedMarketValues);
    const grossPositive = comparePortfolioDecimals(grossExposure, ZERO) > 0;
    const equityPositive = comparePortfolioDecimals(snapshot.account.equity, ZERO) > 0;

    for (const position of positions) {
      const marketValue = position.observation.marketValue;
      if (marketValue === null) {
        return incompleteProjection(snapshot, reconciliation, positions, [
          { code: 'arithmetic_failure', assetFingerprint: null },
        ]);
      }
      position.allocationPercent = grossPositive
        ? portfolioPercentage(absolutePortfolioDecimal(marketValue), grossExposure)
        : null;
    }

    const dailyProfitLoss = subtractPortfolioDecimals(
      snapshot.account.equity,
      snapshot.account.lastEquity,
    );
    const lastEquityPositive = comparePortfolioDecimals(snapshot.account.lastEquity, ZERO) > 0;
    const dailyProfitLossPercent = lastEquityPositive
      ? portfolioPercentage(dailyProfitLoss, snapshot.account.lastEquity)
      : null;
    const largestPositionConcentrationPercent = grossPositive
      ? positions.reduce<PortfolioDecimal | null>((largest, position) => {
          const allocation = position.allocationPercent;
          if (allocation === null) return largest;
          return largest === null || comparePortfolioDecimals(allocation, largest) > 0
            ? allocation
            : largest;
        }, null)
      : null;
    const metrics: PortfolioAggregateMetrics = Object.freeze({
      currency: 'USD',
      cash: snapshot.account.cash,
      equity: snapshot.account.equity,
      portfolioValue: snapshot.account.portfolioValue,
      dailyProfitLoss,
      dailyProfitLossPercent,
      totalUnrealizedProfitLoss: addPortfolioDecimals(valuedUnrealized),
      longExposure,
      shortExposure,
      grossExposure,
      netExposure,
      grossExposurePercent: equityPositive
        ? portfolioPercentage(grossExposure, snapshot.account.equity)
        : null,
      netExposurePercent: equityPositive
        ? portfolioPercentage(netExposure, snapshot.account.equity)
        : null,
      largestPositionConcentrationPercent,
    });
    const unsigned = Object.freeze({
      schemaVersion: PORTFOLIO_PROJECTION_SCHEMA_VERSION,
      arithmeticPolicyVersion: PORTFOLIO_ARITHMETIC_POLICY_VERSION,
      valuationPolicyVersion: PORTFOLIO_VALUATION_POLICY_VERSION,
      state: 'complete' as const,
      snapshotId: snapshot.snapshotId,
      reconciliationId: reconciliation.reconciliationId,
      accountFingerprint: snapshot.accountFingerprint,
      observedAt: snapshot.knowledgeInterval.captureCompletedAt,
      markSource: PORTFOLIO_MARK_SOURCE,
      knowledgeInterval: snapshot.knowledgeInterval,
      incompleteReasons: NO_INCOMPLETE_REASONS,
      metrics,
      positions: Object.freeze(positions.map(immutablePosition)),
    });
    return Object.freeze({
      ...unsigned,
      projectionId: hashPortfolioCanonical(JSON.stringify(portfolioProjectionContent(unsigned))),
    });
  } catch {
    return incompleteProjection(snapshot, reconciliation, positions, [
      { code: 'arithmetic_failure', assetFingerprint: null },
    ]);
  }
}
