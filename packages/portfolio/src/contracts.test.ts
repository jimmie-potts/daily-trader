import { describe, expect, it } from 'vitest';

import {
  createPortfolioAccountObservation,
  createPortfolioFillObservation,
  createPortfolioOrderObservation,
  createPortfolioPositionObservation,
  createPortfolioSyncSnapshot,
  type PortfolioAccountObservation,
  type PortfolioPositionObservation,
} from './contracts.js';
import { PortfolioError } from './errors.js';
import { createPortfolioFingerprint, fingerprintPortfolioSourceIdentifier } from './identity.js';
import {
  serializePortfolioAccountObservation,
  serializePortfolioFillObservation,
  serializePortfolioOrderObservation,
  serializePortfolioPositionObservation,
  serializePortfolioSyncSnapshot,
} from './serialization.js';
import {
  ACCOUNT_FINGERPRINT,
  ACCOUNT_REQUEST_FINGERPRINT,
  ACTIVITY_WINDOW_STARTED_AT,
  CAPTURE_COMPLETED_AT,
  CAPTURE_STARTED_AT,
  FILL_REQUEST_FINGERPRINT,
  ORDER_REQUEST_FINGERPRINT,
  POSITION_REQUEST_FINGERPRINT,
  accountObservation,
  fillObservation,
  orderObservation,
  positionObservation,
  shortPositionObservation,
  sourceFingerprint,
  syncSnapshot,
} from './test-helpers.js';

describe('portfolio source fingerprints', () => {
  it('is deterministic and separates provider identifier kinds', () => {
    const account = fingerprintPortfolioSourceIdentifier('account', 'same-provider-id');
    expect(account).toBe(fingerprintPortfolioSourceIdentifier('account', 'same-provider-id'));
    expect(account).not.toBe(fingerprintPortfolioSourceIdentifier('asset', 'same-provider-id'));
    expect(account).not.toBe(fingerprintPortfolioSourceIdentifier('request', 'same-provider-id'));
    expect(account).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    ['', 'account'],
    [' leading-space', 'account'],
    ['trailing-space ', 'account'],
    ['control\u0000', 'account'],
    ['valid', 'unknown'],
  ])('rejects unsafe source identifier %j or kind %j', (value, kind) => {
    expect(() =>
      fingerprintPortfolioSourceIdentifier(
        kind as Parameters<typeof fingerprintPortfolioSourceIdentifier>[0],
        value,
      ),
    ).toThrowError(PortfolioError);
  });

  it('rejects non-canonical fingerprints at normalized boundaries', () => {
    expect(() => createPortfolioFingerprint('A'.repeat(64))).toThrowError(PortfolioError);
    expect(() => createPortfolioFingerprint('a'.repeat(63))).toThrowError(PortfolioError);
  });
});

describe('portfolio observation contracts', () => {
  it('constructs an immutable account observation with exact and provider-time evidence', () => {
    const value = accountObservation();
    expect(value).toMatchObject({
      provider: 'alpaca',
      brokerEnvironment: 'paper',
      accountFingerprint: ACCOUNT_FINGERPRINT,
      currency: 'USD',
      cash: '40',
      equity: '100',
      lastEquity: '90',
      portfolioValue: '100',
      longMarketValue: '80',
      shortMarketValue: '-20',
      tradingBlocked: false,
      shortingEnabled: true,
    });
    expect(value.createdAt).toEqual({
      original: '2024-01-02T03:04:05.123456789-05:00',
      utc: '2024-01-02T08:04:05.123Z',
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.createdAt)).toBe(true);
  });

  it('preserves a valid non-USD account rather than filtering it', () => {
    const value = accountObservation({ currency: 'EUR' });
    expect(value.currency).toBe('EUR');
  });

  it('excludes receipt and request metadata from observation identity', () => {
    const first = accountObservation();
    const second = accountObservation({
      sourceRequestFingerprint: sourceFingerprint('request', 'later-account-request'),
      observedAt: '2026-07-13T14:30:03.000Z',
    });
    expect(second.accountObservationId).toBe(first.accountObservationId);
    expect(serializePortfolioAccountObservation(second)).not.toBe(
      serializePortfolioAccountObservation(first),
    );
  });

  it('binds business and provider-as-of facts into observation identity', () => {
    expect(accountObservation({ cash: '41' }).accountObservationId).not.toBe(
      accountObservation().accountObservationId,
    );
    expect(
      accountObservation({ createdAt: '2024-01-02T03:04:06.123456789-05:00' }).accountObservationId,
    ).not.toBe(accountObservation().accountObservationId);
  });

  it('constructs supported long and signed short position observations', () => {
    const long = positionObservation();
    const short = shortPositionObservation();
    expect(long).toMatchObject({
      instrument: { symbol: 'AAPL', venue: 'XNAS' },
      quantity: '2',
      currencySource: 'account',
      support: { state: 'supported', reason: null },
      markSource: 'broker_mark',
    });
    expect(short).toMatchObject({
      instrument: { symbol: 'SPY', venue: 'ARCX' },
      side: 'short',
      quantity: '-1',
      quantityAvailable: '-1',
      marketValue: '-20',
    });
  });

  it('keeps unsupported and null-valued holdings visible', () => {
    const value = positionObservation({
      symbol: 'BTCUSD',
      instrument: null,
      providerAssetClass: 'crypto',
      providerExchange: '',
      currency: 'USD',
      currentPrice: null,
      marketValue: null,
      costBasis: null,
      providerUnrealizedProfitLoss: null,
      support: { state: 'unsupported', reason: 'unsupported_asset_class' },
    });
    expect(value).toMatchObject({
      symbol: 'BTCUSD',
      instrument: null,
      providerExchange: '',
      currentPrice: null,
      marketValue: null,
      support: { state: 'unsupported', reason: 'unsupported_asset_class' },
    });
  });

  it.each([
    { side: 'long', quantity: '0' },
    { side: 'long', quantity: '-1' },
    { side: 'short', quantity: '1' },
    { side: 'short', quantity: '0' },
    { side: 'short', quantity: '-1', quantityAvailable: '1' },
  ])('rejects inconsistent signed position quantity %#', (override) => {
    expect(() => positionObservation(override)).toThrowError(PortfolioError);
  });

  it('rejects supported classification without eligible normalized semantics', () => {
    expect(() =>
      positionObservation({
        instrument: null,
        support: { state: 'supported', reason: null },
      }),
    ).toThrowError(PortfolioError);
    expect(() => positionObservation({ currency: 'EUR' })).toThrowError(PortfolioError);
    expect(() => positionObservation({ providerAssetClass: 'crypto' })).toThrowError(
      PortfolioError,
    );
  });

  it('constructs observed broker orders without executable behavior', () => {
    const value = orderObservation();
    expect(value).toMatchObject({
      providerStatus: 'partially_filled',
      state: 'open',
      orderClass: '',
      quantity: '2',
      filledQuantity: '1',
      support: { state: 'supported', reason: null },
    });
    expect(value.createdAt.original).toBe('2026-07-13T10:29:50.000000-04:00');
    expect('submit' in value).toBe(false);
    expect('approve' in value).toBe(false);
    expect('cancel' in value).toBe(false);
  });

  it('rejects orders without quantity or notional and invalid filled quantities', () => {
    expect(() => orderObservation({ quantity: null, notional: null })).toThrowError(PortfolioError);
    expect(() => orderObservation({ filledQuantity: '-1' })).toThrowError(PortfolioError);
    expect(() => orderObservation({ quantity: '1', filledQuantity: '2' })).toThrowError(
      PortfolioError,
    );
  });

  it('preserves a zero after-hours filled-average price as a valid provider fact', () => {
    expect(orderObservation({ filledAveragePrice: '0' }).filledAveragePrice).toBe('0');
  });

  it('constructs immutable observed fills with exact source relationships', () => {
    const value = fillObservation();
    expect(value).toMatchObject({
      side: 'buy',
      type: 'partial_fill',
      quantity: '1',
      price: '39.5',
      cumulativeQuantity: '1',
      leavesQuantity: '1',
    });
    expect(value.transactionAt.utc).toBe('2026-07-13T14:29:59.123Z');
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each([
    { quantity: '0' },
    { price: '0' },
    { cumulativeQuantity: '-1' },
    { quantity: '2', cumulativeQuantity: '1' },
    { leavesQuantity: '-1' },
  ])('rejects invalid fill arithmetic evidence %#', (override) => {
    expect(() => fillObservation(override)).toThrowError(PortfolioError);
  });

  it('rejects number-typed exact financial values at every constructor boundary', () => {
    expect(() => accountObservation({ cash: 40 })).toThrowError(PortfolioError);
    expect(() => positionObservation({ quantity: 2 })).toThrowError(PortfolioError);
    expect(() => orderObservation({ limitPrice: 40 })).toThrowError(PortfolioError);
    expect(() => fillObservation({ price: 39.5 })).toThrowError(PortfolioError);
  });

  it('rejects raw source identifiers instead of accepting them as normalized fingerprints', () => {
    expect(() => accountObservation({ accountFingerprint: 'raw-account-id' })).toThrowError(
      PortfolioError,
    );
    expect(() => positionObservation({ assetFingerprint: 'raw-asset-id' })).toThrowError(
      PortfolioError,
    );
  });
});

describe('portfolio synchronization snapshot', () => {
  it('sorts complete membership and binds a bounded broker-mark knowledge interval', () => {
    const firstPosition = positionObservation();
    const secondPosition = shortPositionObservation();
    const value = syncSnapshot({ positions: [secondPosition, firstPosition] });
    expect(value.positions.map((position) => position.assetFingerprint)).toEqual(
      [firstPosition.assetFingerprint, secondPosition.assetFingerprint].sort(),
    );
    expect(value.knowledgeInterval).toEqual({
      captureStartedAt: CAPTURE_STARTED_AT,
      captureCompletedAt: CAPTURE_COMPLETED_AT,
    });
    expect(value.coverage).toEqual({
      positionsComplete: true,
      ordersComplete: true,
      fillsComplete: true,
      activityBaselineOnly: true,
      activityWindowStartedAt: ACTIVITY_WINDOW_STARTED_AT,
      activityCutoverAt: CAPTURE_STARTED_AT,
    });
    expect(value.markSource).toBe('broker_mark');
    expect(Object.isFrozen(value.positions)).toBe(true);
  });

  it('has stable canonical identity independent of input ordering', () => {
    const firstPosition = positionObservation();
    const secondPosition = shortPositionObservation();
    const first = syncSnapshot({ positions: [firstPosition, secondPosition] });
    const second = syncSnapshot({ positions: [secondPosition, firstPosition] });
    expect(first.snapshotId).toBe(second.snapshotId);
    expect(serializePortfolioSyncSnapshot(first)).toBe(serializePortfolioSyncSnapshot(second));
  });

  it('permits empty complete collections without synthesizing rows', () => {
    const value = syncSnapshot({ positions: [], orders: [], fills: [] });
    expect(value.positions).toEqual([]);
    expect(value.orders).toEqual([]);
    expect(value.fills).toEqual([]);
  });

  it('rejects duplicate source membership', () => {
    const position = positionObservation();
    expect(() => syncSnapshot({ positions: [position, position] })).toThrowError(PortfolioError);
    const order = orderObservation();
    expect(() => syncSnapshot({ orders: [order, order] })).toThrowError(PortfolioError);
    const fill = fillObservation();
    expect(() => syncSnapshot({ fills: [fill, fill] })).toThrowError(PortfolioError);
  });

  it('rejects account mismatches, missing request membership, and receipt times outside capture', () => {
    const differentAccount = sourceFingerprint('account', 'different-account');
    expect(() =>
      syncSnapshot({ positions: [positionObservation({ accountFingerprint: differentAccount })] }),
    ).toThrowError(PortfolioError);
    expect(() =>
      createPortfolioSyncSnapshot({
        captureStartedAt: CAPTURE_STARTED_AT,
        captureCompletedAt: CAPTURE_COMPLETED_AT,
        activityBaselineOnly: true,
        activityWindowStartedAt: ACTIVITY_WINDOW_STARTED_AT,
        activityCutoverAt: CAPTURE_STARTED_AT,
        positionsComplete: true,
        ordersComplete: true,
        fillsComplete: true,
        sourceRequestFingerprints: [ACCOUNT_REQUEST_FINGERPRINT],
        account: accountObservation(),
        positions: [positionObservation()],
        orders: [],
        fills: [],
      }),
    ).toThrowError(PortfolioError);
    expect(() =>
      syncSnapshot({
        account: accountObservation({ observedAt: '2026-07-13T14:29:59.999Z' }),
      }),
    ).toThrowError(PortfolioError);
    expect(() => syncSnapshot({ account: accountObservation({ currency: 'EUR' }) })).toThrowError(
      PortfolioError,
    );
  });

  it('retains distinct initial-baseline and subsequent activity-query evidence', () => {
    const baseline = syncSnapshot();
    const subsequent = syncSnapshot({
      activityBaselineOnly: false,
      activityWindowStartedAt: '2026-07-13T14:28:30.000Z',
    });

    expect(subsequent.coverage).toEqual({
      positionsComplete: true,
      ordersComplete: true,
      fillsComplete: true,
      activityBaselineOnly: false,
      activityWindowStartedAt: '2026-07-13T14:28:30.000Z',
      activityCutoverAt: CAPTURE_STARTED_AT,
    });
    expect(subsequent.snapshotId).not.toBe(baseline.snapshotId);
    expect(serializePortfolioSyncSnapshot(subsequent)).not.toBe(
      serializePortfolioSyncSnapshot(baseline),
    );
  });

  it('rejects malformed capture and activity-query ranges', () => {
    expect(() =>
      syncSnapshot({
        captureStartedAt: CAPTURE_COMPLETED_AT,
        captureCompletedAt: CAPTURE_STARTED_AT,
      }),
    ).toThrowError(PortfolioError);
    expect(() => syncSnapshot({ activityCutoverAt: '2026-07-13T14:30:04.001Z' })).toThrowError(
      PortfolioError,
    );
    expect(() => syncSnapshot({ activityCutoverAt: '2026-07-13T14:29:59.999Z' })).toThrowError(
      PortfolioError,
    );
    expect(() =>
      syncSnapshot({ activityWindowStartedAt: '2026-07-13T14:30:00.001Z' }),
    ).toThrowError(PortfolioError);
    expect(() => syncSnapshot({ activityBaselineOnly: 'true' })).toThrowError(PortfolioError);
  });

  it('keeps fill execution time independent from provider activity-creation coverage', () => {
    const transactionTimes = [
      '2026-07-13T10:28:59.999-04:00',
      '2026-07-13T10:29:00.000-04:00',
      '2026-07-13T10:30:00.000-04:00',
      '2026-07-13T10:30:00.001-04:00',
    ] as const;

    for (const transactionAt of transactionTimes) {
      expect(
        syncSnapshot({ fills: [fillObservation({ transactionAt })] }).fills[0]?.transactionAt
          .original,
      ).toBe(transactionAt);
    }
  });
});

describe('canonical portfolio serialization', () => {
  it('serializes every normalized resource without raw provider identifiers', () => {
    const serialized = [
      serializePortfolioAccountObservation(accountObservation()),
      serializePortfolioPositionObservation(positionObservation()),
      serializePortfolioOrderObservation(orderObservation()),
      serializePortfolioFillObservation(fillObservation()),
      serializePortfolioSyncSnapshot(syncSnapshot()),
    ];
    for (const value of serialized) {
      expect(JSON.parse(value)).toBeTypeOf('object');
      expect(value).not.toContain('paper-account-fixture');
      expect(value).not.toContain('aapl-asset');
      expect(value).not.toContain('order-1');
      expect(value).not.toContain('fill-1');
    }
  });

  it('rejects tampered observation and snapshot content', () => {
    const account = accountObservation();
    const tamperedAccount = { ...account, cash: '999' } as PortfolioAccountObservation;
    expect(() => serializePortfolioAccountObservation(tamperedAccount)).toThrowError(
      PortfolioError,
    );

    const position = positionObservation();
    const tamperedPosition = {
      ...position,
      providerExchange: 'NYSE',
    } as PortfolioPositionObservation;
    expect(() => serializePortfolioPositionObservation(tamperedPosition)).toThrowError(
      PortfolioError,
    );

    const snapshot = syncSnapshot();
    expect(() => serializePortfolioSyncSnapshot({ ...snapshot, positions: [] })).toThrowError(
      PortfolioError,
    );
  });
});

describe('constructor rejection of unnormalized shapes', () => {
  it('requires every account field instead of filling missing values with zero', () => {
    const valid = accountObservation();
    expect(() =>
      createPortfolioAccountObservation({
        ...valid,
        cash: undefined,
      }),
    ).toThrowError(PortfolioError);
  });

  it('requires normalized support unions rather than provider booleans', () => {
    const valid = positionObservation();
    expect(() =>
      createPortfolioPositionObservation({
        ...valid,
        support: true,
      }),
    ).toThrowError(PortfolioError);
  });

  it('rejects provider-shaped order and fill values', () => {
    expect(() =>
      createPortfolioOrderObservation({
        ...orderObservation(),
        orderFingerprint: 'raw-order',
      }),
    ).toThrowError(PortfolioError);
    expect(() =>
      createPortfolioFillObservation({
        ...fillObservation(),
        transactionAt: { timestamp: '2026-07-13T14:30:03Z' },
      }),
    ).toThrowError(PortfolioError);
  });

  it('retains all request fingerprints required by complete membership', () => {
    const value = syncSnapshot();
    expect(value.sourceRequestFingerprints).toEqual(
      [
        ACCOUNT_REQUEST_FINGERPRINT,
        POSITION_REQUEST_FINGERPRINT,
        ORDER_REQUEST_FINGERPRINT,
        FILL_REQUEST_FINGERPRINT,
      ].sort(),
    );
  });
});
