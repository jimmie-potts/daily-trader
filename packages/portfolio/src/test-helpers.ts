import {
  createPortfolioAccountObservation,
  createPortfolioFillObservation,
  createPortfolioOrderObservation,
  createPortfolioPositionObservation,
  createPortfolioSyncSnapshot,
  type CreatePortfolioAccountObservationInput,
  type CreatePortfolioFillObservationInput,
  type CreatePortfolioOrderObservationInput,
  type CreatePortfolioPositionObservationInput,
  type CreatePortfolioSyncSnapshotInput,
  type PortfolioAccountObservation,
  type PortfolioFillObservation,
  type PortfolioOrderObservation,
  type PortfolioPositionObservation,
  type PortfolioSyncSnapshot,
} from './contracts.js';
import {
  fingerprintPortfolioSourceIdentifier,
  type PortfolioFingerprint,
  type PortfolioSourceIdentifierKind,
} from './identity.js';
import {
  preparePortfolioProjection,
  reconcilePortfolioProjection,
  type PortfolioReconciliation,
} from './reconciliation.js';

export const CAPTURE_STARTED_AT = '2026-07-13T14:30:00.000Z';
export const CAPTURE_COMPLETED_AT = '2026-07-13T14:30:04.000Z';
export const ACTIVITY_WINDOW_STARTED_AT = '2026-07-13T14:29:00.000Z';

export function sourceFingerprint(
  kind: PortfolioSourceIdentifierKind,
  value: string,
): PortfolioFingerprint {
  return fingerprintPortfolioSourceIdentifier(kind, value);
}

export const ACCOUNT_FINGERPRINT = sourceFingerprint('account', 'paper-account-fixture');
export const ACCOUNT_REQUEST_FINGERPRINT = sourceFingerprint('request', 'account-request');
export const POSITION_REQUEST_FINGERPRINT = sourceFingerprint('request', 'position-request');
export const ORDER_REQUEST_FINGERPRINT = sourceFingerprint('request', 'order-request');
export const FILL_REQUEST_FINGERPRINT = sourceFingerprint('request', 'fill-request');

export function accountObservation(
  overrides: Partial<CreatePortfolioAccountObservationInput> = {},
): PortfolioAccountObservation {
  return createPortfolioAccountObservation({
    accountFingerprint: ACCOUNT_FINGERPRINT,
    sourceRequestFingerprint: ACCOUNT_REQUEST_FINGERPRINT,
    observedAt: '2026-07-13T14:30:00.500Z',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: '2024-01-02T03:04:05.123456789-05:00',
    cash: '40',
    equity: '100',
    lastEquity: '90',
    portfolioValue: '100',
    longMarketValue: '80',
    shortMarketValue: '-20',
    buyingPower: '80',
    nonMarginableBuyingPower: '40',
    regtBuyingPower: '80',
    initialMargin: '10',
    maintenanceMargin: '8',
    lastMaintenanceMargin: '7',
    accruedFees: '0.1',
    pendingTransferIn: null,
    pendingTransferOut: null,
    multiplier: '2',
    tradingBlocked: false,
    transfersBlocked: false,
    accountBlocked: false,
    tradeSuspendedByUser: false,
    shortingEnabled: true,
    ...overrides,
  });
}

export function positionObservation(
  overrides: Partial<CreatePortfolioPositionObservationInput> = {},
): PortfolioPositionObservation {
  return createPortfolioPositionObservation({
    accountFingerprint: ACCOUNT_FINGERPRINT,
    sourceRequestFingerprint: POSITION_REQUEST_FINGERPRINT,
    observedAt: '2026-07-13T14:30:01.500Z',
    assetFingerprint: sourceFingerprint('asset', 'aapl-asset'),
    symbol: 'AAPL',
    instrument: { symbol: 'AAPL', venue: 'XNAS' },
    providerAssetClass: 'us_equity',
    providerExchange: 'NASDAQ',
    currency: 'USD',
    side: 'long',
    quantity: '2',
    quantityAvailable: '2',
    averageEntryPrice: '35',
    currentPrice: '40',
    marketValue: '80',
    costBasis: '70',
    providerUnrealizedProfitLoss: '10',
    providerUnrealizedProfitLossPercent: '0.142857',
    unrealizedIntradayProfitLoss: '4',
    unrealizedIntradayProfitLossPercent: '0.052632',
    lastDayPrice: '38',
    changeToday: '0.052632',
    assetMarginable: true,
    support: { state: 'supported', reason: null },
    ...overrides,
  });
}

export function shortPositionObservation(
  overrides: Partial<CreatePortfolioPositionObservationInput> = {},
): PortfolioPositionObservation {
  return positionObservation({
    assetFingerprint: sourceFingerprint('asset', 'spy-asset'),
    symbol: 'SPY',
    instrument: { symbol: 'SPY', venue: 'ARCX' },
    providerExchange: 'ARCA',
    side: 'short',
    quantity: '-1',
    quantityAvailable: '-1',
    averageEntryPrice: '15',
    currentPrice: '20',
    marketValue: '-20',
    costBasis: '-15',
    providerUnrealizedProfitLoss: '-5',
    providerUnrealizedProfitLossPercent: '-0.333333',
    unrealizedIntradayProfitLoss: '-1',
    unrealizedIntradayProfitLossPercent: '-0.052632',
    lastDayPrice: '19',
    changeToday: '0.052632',
    ...overrides,
  });
}

export function orderObservation(
  overrides: Partial<CreatePortfolioOrderObservationInput> = {},
): PortfolioOrderObservation {
  return createPortfolioOrderObservation({
    accountFingerprint: ACCOUNT_FINGERPRINT,
    sourceRequestFingerprint: ORDER_REQUEST_FINGERPRINT,
    observedAt: '2026-07-13T14:30:02.500Z',
    orderFingerprint: sourceFingerprint('order', 'order-1'),
    clientOrderFingerprint: sourceFingerprint('client_order', 'client-order-1'),
    assetFingerprint: sourceFingerprint('asset', 'aapl-asset'),
    symbol: 'AAPL',
    instrument: { symbol: 'AAPL', venue: 'XNAS' },
    providerAssetClass: 'us_equity',
    side: 'buy',
    orderType: 'limit',
    orderClass: '',
    positionIntent: 'buy_to_open',
    timeInForce: 'day',
    providerStatus: 'partially_filled',
    state: 'open',
    support: { state: 'supported', reason: null },
    extendedHours: false,
    quantity: '2',
    notional: null,
    filledQuantity: '1',
    filledAveragePrice: '39.5',
    limitPrice: '40',
    stopPrice: null,
    commission: '0',
    trailPercent: null,
    trailPrice: null,
    highWaterMark: null,
    replacedByFingerprint: null,
    replacesFingerprint: null,
    createdAt: '2026-07-13T10:29:50.000000-04:00',
    updatedAt: '2026-07-13T10:30:02.000000-04:00',
    submittedAt: '2026-07-13T10:29:51.000000-04:00',
    filledAt: null,
    canceledAt: null,
    failedAt: null,
    replacedAt: null,
    expiredAt: null,
    ...overrides,
  });
}

export function mlegParentOrderObservation(
  overrides: Partial<CreatePortfolioOrderObservationInput> = {},
): PortfolioOrderObservation {
  return orderObservation({
    orderFingerprint: sourceFingerprint('order', 'mleg-parent-order'),
    clientOrderFingerprint: sourceFingerprint('client_order', 'mleg-parent-client-order'),
    assetFingerprint: null,
    symbol: null,
    instrument: null,
    providerAssetClass: null,
    side: null,
    orderClass: 'mleg',
    positionIntent: null,
    support: { state: 'unsupported', reason: 'unsupported_order_structure' },
    ...overrides,
  });
}

export function fillObservation(
  overrides: Partial<CreatePortfolioFillObservationInput> = {},
): PortfolioFillObservation {
  return createPortfolioFillObservation({
    accountFingerprint: ACCOUNT_FINGERPRINT,
    sourceRequestFingerprint: FILL_REQUEST_FINGERPRINT,
    observedAt: '2026-07-13T14:30:03.500Z',
    fillFingerprint: sourceFingerprint('fill', 'fill-1'),
    orderFingerprint: sourceFingerprint('order', 'order-1'),
    assetFingerprint: sourceFingerprint('asset', 'aapl-asset'),
    symbol: 'AAPL',
    instrument: { symbol: 'AAPL', venue: 'XNAS' },
    side: 'buy',
    type: 'partial_fill',
    quantity: '1',
    price: '39.5',
    cumulativeQuantity: '1',
    leavesQuantity: '1',
    transactionAt: '2026-07-13T10:29:59.123456789-04:00',
    ...overrides,
  });
}

export function syncSnapshot(
  overrides: Partial<CreatePortfolioSyncSnapshotInput> = {},
): PortfolioSyncSnapshot {
  const account = overrides.account ?? accountObservation();
  const positions = overrides.positions ?? [positionObservation(), shortPositionObservation()];
  const orders = overrides.orders ?? [orderObservation()];
  const fills = overrides.fills ?? [fillObservation()];
  const sourceRequestFingerprints = overrides.sourceRequestFingerprints ?? [
    ...new Set(
      [account, ...positions, ...orders, ...fills].map((item) => item.sourceRequestFingerprint),
    ),
  ];
  return createPortfolioSyncSnapshot({
    captureStartedAt: CAPTURE_STARTED_AT,
    captureCompletedAt: CAPTURE_COMPLETED_AT,
    activityBaselineOnly: true,
    activityWindowStartedAt: ACTIVITY_WINDOW_STARTED_AT,
    activityCutoverAt: CAPTURE_STARTED_AT,
    positionsComplete: true,
    ordersComplete: true,
    fillsComplete: true,
    ...overrides,
    sourceRequestFingerprints,
    account,
    positions,
    orders,
    fills,
  });
}

export function convergedReconciliation(snapshot: PortfolioSyncSnapshot): PortfolioReconciliation {
  return reconcilePortfolioProjection(snapshot, preparePortfolioProjection(snapshot, null));
}
