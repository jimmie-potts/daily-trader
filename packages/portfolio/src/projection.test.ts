import { describe, expect, it } from 'vitest';

import type { PortfolioSyncSnapshot } from './contracts.js';
import { PortfolioError } from './errors.js';
import { projectPortfolioSnapshot, type PortfolioProjection } from './projection.js';
import { preparePortfolioProjection, reconcilePortfolioProjection } from './reconciliation.js';
import { serializePortfolioProjection } from './serialization.js';
import {
  accountObservation,
  convergedReconciliation,
  positionObservation,
  shortPositionObservation,
  syncSnapshot,
} from './test-helpers.js';

function project(snapshot: PortfolioSyncSnapshot): PortfolioProjection {
  return projectPortfolioSnapshot(snapshot, convergedReconciliation(snapshot));
}

describe('exact portfolio projection', () => {
  it('calculates signed exposure, provider P&L, gross allocation, and concentration', () => {
    const snapshot = syncSnapshot();
    const value = project(snapshot);
    expect(value).toMatchObject({
      state: 'complete',
      snapshotId: snapshot.snapshotId,
      accountFingerprint: snapshot.accountFingerprint,
      arithmeticPolicyVersion: 'daily-trader.portfolio.arithmetic.bigjs.v1',
      valuationPolicyVersion: 'daily-trader.portfolio.valuation.alpaca-paper-broker-mark.v1',
      markSource: 'broker_mark',
      knowledgeInterval: snapshot.knowledgeInterval,
      metrics: {
        currency: 'USD',
        cash: '40',
        equity: '100',
        portfolioValue: '100',
        dailyProfitLoss: '10',
        dailyProfitLossPercent: '11.111111',
        totalUnrealizedProfitLoss: '5',
        longExposure: '80',
        shortExposure: '20',
        grossExposure: '100',
        netExposure: '60',
        grossExposurePercent: '100',
        netExposurePercent: '60',
        largestPositionConcentrationPercent: '80',
      },
    });
    expect(value.positions).toHaveLength(2);
    expect(
      value.positions.map((position) => [position.symbol, position.allocationPercent]),
    ).toEqual([
      ['AAPL', '80'],
      ['SPY', '20'],
    ]);
    expect(value.positions.map((position) => position.unrealizedProfitLoss)).toEqual(['10', '-5']);
  });

  it('uses provider unrealized P&L directly and does not require cost basis', () => {
    const snapshot = syncSnapshot({
      positions: [positionObservation({ costBasis: null, providerUnrealizedProfitLoss: '7.25' })],
      account: accountObservation({
        longMarketValue: '80',
        shortMarketValue: '0',
      }),
    });
    const value = project(snapshot);
    expect(value.state).toBe('complete');
    if (value.state !== 'complete') throw new TypeError('expected complete fixture');
    expect(value.metrics.totalUnrealizedProfitLoss).toBe('7.25');
    expect(value.positions[0]?.costBasis).toBeNull();
  });

  it('produces exact empty-account zeros and unavailable concentration', () => {
    const snapshot = syncSnapshot({
      account: accountObservation({
        cash: '100',
        equity: '100',
        lastEquity: '100',
        portfolioValue: '100',
        longMarketValue: '0',
        shortMarketValue: '0',
      }),
      positions: [],
      orders: [],
      fills: [],
    });
    const value = project(snapshot);
    expect(value.state).toBe('complete');
    if (value.state !== 'complete') throw new TypeError('expected complete fixture');
    expect(value.positions).toEqual([]);
    expect(value.metrics).toMatchObject({
      totalUnrealizedProfitLoss: '0',
      longExposure: '0',
      shortExposure: '0',
      grossExposure: '0',
      netExposure: '0',
      largestPositionConcentrationPercent: null,
    });
  });

  it('leaves percentages unavailable when their exact denominator is not positive', () => {
    const snapshot = syncSnapshot({
      account: accountObservation({
        equity: '0',
        lastEquity: '0',
        portfolioValue: '0',
      }),
    });
    const value = project(snapshot);
    expect(value.state).toBe('complete');
    if (value.state !== 'complete') throw new TypeError('expected complete fixture');
    expect(value.metrics.dailyProfitLossPercent).toBeNull();
    expect(value.metrics.grossExposurePercent).toBeNull();
    expect(value.metrics.netExposurePercent).toBeNull();
    expect(value.positions.map((position) => position.allocationPercent)).toEqual(['80', '20']);
  });

  it('retains nonempty zero-gross holdings but never fabricates allocation or concentration', () => {
    const snapshot = syncSnapshot({
      account: accountObservation({
        longMarketValue: '0',
        shortMarketValue: '0',
      }),
      positions: [
        positionObservation({
          currentPrice: '1',
          marketValue: '0',
          providerUnrealizedProfitLoss: '0',
        }),
      ],
    });
    const value = project(snapshot);
    expect(value.state).toBe('complete');
    if (value.state !== 'complete') throw new TypeError('expected complete fixture');
    expect(value.metrics.grossExposure).toBe('0');
    expect(value.metrics.largestPositionConcentrationPercent).toBeNull();
    expect(value.positions[0]?.allocationPercent).toBeNull();
  });

  it('withholds every aggregate for a non-USD account while preserving its evidence', () => {
    const snapshot = syncSnapshot({
      account: accountObservation({ currency: 'EUR' }),
      positions: [],
    });
    const value = project(snapshot);
    expect(value.state).toBe('incomplete');
    expect(value.metrics).toBeNull();
    expect(value.incompleteReasons).toContainEqual({
      code: 'unsupported_account_currency',
      assetFingerprint: null,
    });
    expect(snapshot.account.currency).toBe('EUR');
  });

  it('withholds aggregates but retains unsupported holdings', () => {
    const unsupported = positionObservation({
      instrument: null,
      support: { state: 'unsupported', reason: 'missing_instrument' },
    });
    const snapshot = syncSnapshot({ positions: [unsupported] });
    const value = project(snapshot);
    expect(value.state).toBe('incomplete');
    expect(value.metrics).toBeNull();
    expect(value.positions).toHaveLength(1);
    expect(value.positions[0]).toMatchObject({
      assetFingerprint: unsupported.assetFingerprint,
      state: 'incomplete',
      reasons: ['unsupported_holding'],
      marketValue: '80',
    });
  });

  it.each([
    ['currentPrice', null, 'missing_current_price'],
    ['marketValue', null, 'missing_market_value'],
    ['providerUnrealizedProfitLoss', null, 'missing_unrealized_profit_loss'],
  ] as const)('suppresses a holding with null %s', (field, missing, reason) => {
    const holding = positionObservation({ [field]: missing });
    const value = project(syncSnapshot({ positions: [holding] }));
    expect(value.state).toBe('incomplete');
    expect(value.metrics).toBeNull();
    expect(value.incompleteReasons).toContainEqual({
      code: reason,
      assetFingerprint: holding.assetFingerprint,
    });
  });

  it('suppresses a broker side and signed-market-value mismatch', () => {
    const holding = positionObservation({ marketValue: '-80' });
    const value = project(syncSnapshot({ positions: [holding] }));
    expect(value.state).toBe('incomplete');
    expect(value.incompleteReasons).toContainEqual({
      code: 'side_market_value_mismatch',
      assetFingerprint: holding.assetFingerprint,
    });
  });

  it('requires converged integrity for the exact same snapshot', () => {
    const snapshot = syncSnapshot();
    const unavailable = reconcilePortfolioProjection(snapshot, null);
    const value = projectPortfolioSnapshot(snapshot, unavailable);
    expect(value.state).toBe('incomplete');
    expect(value.incompleteReasons).toContainEqual({
      code: 'unreconciled_input',
      assetFingerprint: null,
    });

    const other = syncSnapshot({ captureCompletedAt: '2026-07-13T14:30:05.000Z' });
    const otherReconciliation = reconcilePortfolioProjection(
      other,
      preparePortfolioProjection(other, null),
    );
    const mismatched = projectPortfolioSnapshot(snapshot, otherReconciliation);
    expect(mismatched.state).toBe('incomplete');
    expect(mismatched.incompleteReasons).toContainEqual({
      code: 'unreconciled_input',
      assetFingerprint: null,
    });
  });

  it('suppresses exact arithmetic overflow instead of rounding or clamping', () => {
    const maximum = '9'.repeat(48);
    const snapshot = syncSnapshot({
      account: accountObservation({
        equity: maximum,
        lastEquity: `-${maximum}`,
        portfolioValue: maximum,
      }),
    });
    const value = project(snapshot);
    expect(value.state).toBe('incomplete');
    expect(value.metrics).toBeNull();
    expect(value.incompleteReasons).toContainEqual({
      code: 'arithmetic_failure',
      assetFingerprint: null,
    });
  });

  it('is deterministic and binds reconciliation, arithmetic, valuation, and broker evidence', () => {
    const snapshot = syncSnapshot();
    const reconciliation = convergedReconciliation(snapshot);
    const first = projectPortfolioSnapshot(snapshot, reconciliation);
    const second = projectPortfolioSnapshot(snapshot, reconciliation);
    expect(second.projectionId).toBe(first.projectionId);
    expect(serializePortfolioProjection(second)).toBe(serializePortfolioProjection(first));

    const changed = syncSnapshot({
      positions: [
        positionObservation({ providerUnrealizedProfitLoss: '10.000001' }),
        shortPositionObservation(),
      ],
    });
    expect(project(changed).projectionId).not.toBe(first.projectionId);
  });

  it('rejects tampered projection serialization', () => {
    const value = project(syncSnapshot());
    const tampered = {
      ...value,
      reconciliationId: '0'.repeat(64),
    } as PortfolioProjection;
    expect(() => serializePortfolioProjection(tampered)).toThrowError(PortfolioError);
  });
});
