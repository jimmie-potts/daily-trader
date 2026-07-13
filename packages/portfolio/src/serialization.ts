import {
  PORTFOLIO_ACCOUNT_SCHEMA_VERSION,
  PORTFOLIO_BROKER_ENVIRONMENT,
  PORTFOLIO_FILL_SCHEMA_VERSION,
  PORTFOLIO_MARK_SOURCE,
  PORTFOLIO_ORDER_SCHEMA_VERSION,
  PORTFOLIO_ORDER_SCHEMA_VERSION_V1,
  PORTFOLIO_POSITION_SCHEMA_VERSION,
  PORTFOLIO_PROVIDER,
  PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION,
  PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION_V1,
  accountObservationContent,
  createPortfolioAccountObservation,
  createPortfolioFillObservation,
  createPortfolioOrderObservationForSchema,
  createPortfolioPositionObservation,
  createPortfolioSyncSnapshotForSchema,
  fillObservationContent,
  observationIdentityContent,
  orderObservationContent,
  positionObservationContent,
  syncSnapshotContent,
  type PortfolioAccountObservation,
  type PortfolioFillObservation,
  type PortfolioOrderObservation,
  type PortfolioOrderSchemaVersion,
  type PortfolioPositionObservation,
  type PortfolioSyncSnapshot,
  type PortfolioSyncSnapshotSchemaVersion,
} from './contracts.js';
import { PortfolioError } from './errors.js';
import { hashPortfolioCanonical } from './identity.js';
import {
  PORTFOLIO_PROJECTION_SCHEMA_VERSION,
  portfolioProjectionContent,
  type PortfolioProjection,
} from './projection.js';

const ACCOUNT_OBSERVATION_KEYS = [
  'schemaVersion',
  'provider',
  'brokerEnvironment',
  'accountFingerprint',
  'sourceRequestFingerprint',
  'observedAt',
  'status',
  'currency',
  'createdAt',
  'cash',
  'equity',
  'lastEquity',
  'portfolioValue',
  'longMarketValue',
  'shortMarketValue',
  'buyingPower',
  'nonMarginableBuyingPower',
  'regtBuyingPower',
  'initialMargin',
  'maintenanceMargin',
  'lastMaintenanceMargin',
  'accruedFees',
  'pendingTransferIn',
  'pendingTransferOut',
  'multiplier',
  'tradingBlocked',
  'transfersBlocked',
  'accountBlocked',
  'tradeSuspendedByUser',
  'shortingEnabled',
  'accountObservationId',
] as const;

const POSITION_OBSERVATION_KEYS = [
  'schemaVersion',
  'provider',
  'brokerEnvironment',
  'accountFingerprint',
  'sourceRequestFingerprint',
  'observedAt',
  'assetFingerprint',
  'symbol',
  'instrument',
  'providerAssetClass',
  'providerExchange',
  'currency',
  'currencySource',
  'side',
  'quantity',
  'quantityAvailable',
  'averageEntryPrice',
  'currentPrice',
  'marketValue',
  'costBasis',
  'providerUnrealizedProfitLoss',
  'providerUnrealizedProfitLossPercent',
  'unrealizedIntradayProfitLoss',
  'unrealizedIntradayProfitLossPercent',
  'lastDayPrice',
  'changeToday',
  'assetMarginable',
  'support',
  'markSource',
  'positionObservationId',
] as const;

const ORDER_OBSERVATION_KEYS = [
  'schemaVersion',
  'provider',
  'brokerEnvironment',
  'accountFingerprint',
  'sourceRequestFingerprint',
  'observedAt',
  'orderFingerprint',
  'clientOrderFingerprint',
  'assetFingerprint',
  'symbol',
  'instrument',
  'providerAssetClass',
  'side',
  'orderType',
  'orderClass',
  'positionIntent',
  'timeInForce',
  'providerStatus',
  'state',
  'support',
  'extendedHours',
  'quantity',
  'notional',
  'filledQuantity',
  'filledAveragePrice',
  'limitPrice',
  'stopPrice',
  'commission',
  'trailPercent',
  'trailPrice',
  'highWaterMark',
  'replacedByFingerprint',
  'replacesFingerprint',
  'createdAt',
  'submittedAt',
  'updatedAt',
  'filledAt',
  'canceledAt',
  'failedAt',
  'replacedAt',
  'expiredAt',
  'orderObservationId',
] as const;

const FILL_OBSERVATION_KEYS = [
  'schemaVersion',
  'provider',
  'brokerEnvironment',
  'accountFingerprint',
  'sourceRequestFingerprint',
  'observedAt',
  'fillFingerprint',
  'orderFingerprint',
  'assetFingerprint',
  'symbol',
  'instrument',
  'side',
  'type',
  'quantity',
  'price',
  'cumulativeQuantity',
  'leavesQuantity',
  'transactionAt',
  'fillObservationId',
] as const;

const SYNC_SNAPSHOT_KEYS = [
  'schemaVersion',
  'provider',
  'brokerEnvironment',
  'accountFingerprint',
  'markSource',
  'sourceRequestFingerprints',
  'knowledgeInterval',
  'coverage',
  'account',
  'positions',
  'orders',
  'fills',
  'snapshotId',
] as const;

function invalidSerialization(cause?: unknown): never {
  throw new PortfolioError('serialization_invalid', { cause });
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidSerialization();
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidSerialization();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return invalidSerialization();
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return invalidSerialization();
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return invalidSerialization();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
    return invalidSerialization();
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return invalidSerialization();
    }
  }
  return value;
}

function instrument(value: unknown): unknown {
  return value === null ? null : exactRecord(value, ['symbol', 'venue']);
}

function support(value: unknown): unknown {
  return exactRecord(value, ['state', 'reason']);
}

function providerTimestampOriginal(value: unknown): unknown {
  const record = exactRecord(value, ['original', 'utc']);
  if (typeof record.original !== 'string' || typeof record.utc !== 'string') {
    return invalidSerialization();
  }
  return record.original;
}

function optionalProviderTimestampOriginal(value: unknown): unknown {
  return value === null ? null : providerTimestampOriginal(value);
}

function assertStoredId(stored: unknown, reconstructed: string): void {
  if (stored !== reconstructed) invalidSerialization();
}

function parseAccountObservation(value: unknown): PortfolioAccountObservation {
  const record = exactRecord(value, ACCOUNT_OBSERVATION_KEYS);
  const observation = createPortfolioAccountObservation({
    accountFingerprint: record.accountFingerprint,
    sourceRequestFingerprint: record.sourceRequestFingerprint,
    observedAt: record.observedAt,
    status: record.status,
    currency: record.currency,
    createdAt: providerTimestampOriginal(record.createdAt),
    cash: record.cash,
    equity: record.equity,
    lastEquity: record.lastEquity,
    portfolioValue: record.portfolioValue,
    longMarketValue: record.longMarketValue,
    shortMarketValue: record.shortMarketValue,
    buyingPower: record.buyingPower,
    nonMarginableBuyingPower: record.nonMarginableBuyingPower,
    regtBuyingPower: record.regtBuyingPower,
    initialMargin: record.initialMargin,
    maintenanceMargin: record.maintenanceMargin,
    lastMaintenanceMargin: record.lastMaintenanceMargin,
    accruedFees: record.accruedFees,
    pendingTransferIn: record.pendingTransferIn,
    pendingTransferOut: record.pendingTransferOut,
    multiplier: record.multiplier,
    tradingBlocked: record.tradingBlocked,
    transfersBlocked: record.transfersBlocked,
    accountBlocked: record.accountBlocked,
    tradeSuspendedByUser: record.tradeSuspendedByUser,
    shortingEnabled: record.shortingEnabled,
  });
  assertStoredId(record.accountObservationId, observation.accountObservationId);
  return observation;
}

function parsePositionObservation(value: unknown): PortfolioPositionObservation {
  const record = exactRecord(value, POSITION_OBSERVATION_KEYS);
  const observation = createPortfolioPositionObservation({
    accountFingerprint: record.accountFingerprint,
    sourceRequestFingerprint: record.sourceRequestFingerprint,
    observedAt: record.observedAt,
    assetFingerprint: record.assetFingerprint,
    symbol: record.symbol,
    instrument: instrument(record.instrument),
    providerAssetClass: record.providerAssetClass,
    providerExchange: record.providerExchange,
    currency: record.currency,
    side: record.side,
    quantity: record.quantity,
    quantityAvailable: record.quantityAvailable,
    averageEntryPrice: record.averageEntryPrice,
    currentPrice: record.currentPrice,
    marketValue: record.marketValue,
    costBasis: record.costBasis,
    providerUnrealizedProfitLoss: record.providerUnrealizedProfitLoss,
    providerUnrealizedProfitLossPercent: record.providerUnrealizedProfitLossPercent,
    unrealizedIntradayProfitLoss: record.unrealizedIntradayProfitLoss,
    unrealizedIntradayProfitLossPercent: record.unrealizedIntradayProfitLossPercent,
    lastDayPrice: record.lastDayPrice,
    changeToday: record.changeToday,
    assetMarginable: record.assetMarginable,
    support: support(record.support),
  });
  assertStoredId(record.positionObservationId, observation.positionObservationId);
  return observation;
}

function orderSchemaVersion(value: unknown): PortfolioOrderSchemaVersion {
  if (value === PORTFOLIO_ORDER_SCHEMA_VERSION_V1) {
    return PORTFOLIO_ORDER_SCHEMA_VERSION_V1;
  }
  if (value === PORTFOLIO_ORDER_SCHEMA_VERSION) return PORTFOLIO_ORDER_SCHEMA_VERSION;
  return invalidSerialization();
}

function snapshotSchemaVersion(value: unknown): PortfolioSyncSnapshotSchemaVersion {
  if (value === PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION_V1) {
    return PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION_V1;
  }
  if (value === PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION) {
    return PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION;
  }
  return invalidSerialization();
}

function parseOrderObservation(value: unknown): PortfolioOrderObservation {
  const record = exactRecord(value, ORDER_OBSERVATION_KEYS);
  const observation = createPortfolioOrderObservationForSchema(
    {
      accountFingerprint: record.accountFingerprint,
      sourceRequestFingerprint: record.sourceRequestFingerprint,
      observedAt: record.observedAt,
      orderFingerprint: record.orderFingerprint,
      clientOrderFingerprint: record.clientOrderFingerprint,
      assetFingerprint: record.assetFingerprint,
      symbol: record.symbol,
      instrument: instrument(record.instrument),
      providerAssetClass: record.providerAssetClass,
      side: record.side,
      orderType: record.orderType,
      orderClass: record.orderClass,
      positionIntent: record.positionIntent,
      timeInForce: record.timeInForce,
      providerStatus: record.providerStatus,
      state: record.state,
      support: support(record.support),
      extendedHours: record.extendedHours,
      quantity: record.quantity,
      notional: record.notional,
      filledQuantity: record.filledQuantity,
      filledAveragePrice: record.filledAveragePrice,
      limitPrice: record.limitPrice,
      stopPrice: record.stopPrice,
      commission: record.commission,
      trailPercent: record.trailPercent,
      trailPrice: record.trailPrice,
      highWaterMark: record.highWaterMark,
      replacedByFingerprint: record.replacedByFingerprint,
      replacesFingerprint: record.replacesFingerprint,
      createdAt: providerTimestampOriginal(record.createdAt),
      submittedAt: optionalProviderTimestampOriginal(record.submittedAt),
      updatedAt: optionalProviderTimestampOriginal(record.updatedAt),
      filledAt: optionalProviderTimestampOriginal(record.filledAt),
      canceledAt: optionalProviderTimestampOriginal(record.canceledAt),
      failedAt: optionalProviderTimestampOriginal(record.failedAt),
      replacedAt: optionalProviderTimestampOriginal(record.replacedAt),
      expiredAt: optionalProviderTimestampOriginal(record.expiredAt),
    },
    orderSchemaVersion(record.schemaVersion),
  );
  assertStoredId(record.orderObservationId, observation.orderObservationId);
  return observation;
}

function parseFillObservation(value: unknown): PortfolioFillObservation {
  const record = exactRecord(value, FILL_OBSERVATION_KEYS);
  const observation = createPortfolioFillObservation({
    accountFingerprint: record.accountFingerprint,
    sourceRequestFingerprint: record.sourceRequestFingerprint,
    observedAt: record.observedAt,
    fillFingerprint: record.fillFingerprint,
    orderFingerprint: record.orderFingerprint,
    assetFingerprint: record.assetFingerprint,
    symbol: record.symbol,
    instrument: instrument(record.instrument),
    side: record.side,
    type: record.type,
    quantity: record.quantity,
    price: record.price,
    cumulativeQuantity: record.cumulativeQuantity,
    leavesQuantity: record.leavesQuantity,
    transactionAt: providerTimestampOriginal(record.transactionAt),
  });
  assertStoredId(record.fillObservationId, observation.fillObservationId);
  return observation;
}

function checkedSerialization(
  schemaMatches: boolean,
  content: Readonly<Record<string, unknown>>,
  expectedId: string,
  idField: string,
  identityContent: Readonly<Record<string, unknown>> = content,
): string {
  if (!schemaMatches || hashPortfolioCanonical(JSON.stringify(identityContent)) !== expectedId) {
    throw new PortfolioError('serialization_invalid');
  }
  return JSON.stringify({ ...content, [idField]: expectedId });
}

function matchesExpectedLiteral(value: unknown, expected: string): boolean {
  return value === expected;
}

export function serializePortfolioAccountObservation(value: PortfolioAccountObservation): string {
  return checkedSerialization(
    matchesExpectedLiteral(value.schemaVersion, PORTFOLIO_ACCOUNT_SCHEMA_VERSION) &&
      matchesExpectedLiteral(value.provider, PORTFOLIO_PROVIDER) &&
      matchesExpectedLiteral(value.brokerEnvironment, PORTFOLIO_BROKER_ENVIRONMENT),
    accountObservationContent(value),
    value.accountObservationId,
    'accountObservationId',
    observationIdentityContent(accountObservationContent(value)),
  );
}

export function serializePortfolioPositionObservation(value: PortfolioPositionObservation): string {
  return checkedSerialization(
    matchesExpectedLiteral(value.schemaVersion, PORTFOLIO_POSITION_SCHEMA_VERSION) &&
      matchesExpectedLiteral(value.provider, PORTFOLIO_PROVIDER) &&
      matchesExpectedLiteral(value.brokerEnvironment, PORTFOLIO_BROKER_ENVIRONMENT) &&
      matchesExpectedLiteral(value.markSource, PORTFOLIO_MARK_SOURCE),
    positionObservationContent(value),
    value.positionObservationId,
    'positionObservationId',
    observationIdentityContent(positionObservationContent(value)),
  );
}

export function serializePortfolioOrderObservation(value: PortfolioOrderObservation): string {
  try {
    const observation = parseOrderObservation(value);
    return checkedSerialization(
      (matchesExpectedLiteral(observation.schemaVersion, PORTFOLIO_ORDER_SCHEMA_VERSION_V1) ||
        matchesExpectedLiteral(observation.schemaVersion, PORTFOLIO_ORDER_SCHEMA_VERSION)) &&
        matchesExpectedLiteral(observation.provider, PORTFOLIO_PROVIDER) &&
        matchesExpectedLiteral(observation.brokerEnvironment, PORTFOLIO_BROKER_ENVIRONMENT),
      orderObservationContent(observation),
      observation.orderObservationId,
      'orderObservationId',
      observationIdentityContent(orderObservationContent(observation)),
    );
  } catch (error) {
    if (error instanceof PortfolioError && error.code === 'serialization_invalid') throw error;
    return invalidSerialization(error);
  }
}

export function serializePortfolioFillObservation(value: PortfolioFillObservation): string {
  return checkedSerialization(
    matchesExpectedLiteral(value.schemaVersion, PORTFOLIO_FILL_SCHEMA_VERSION) &&
      matchesExpectedLiteral(value.provider, PORTFOLIO_PROVIDER) &&
      matchesExpectedLiteral(value.brokerEnvironment, PORTFOLIO_BROKER_ENVIRONMENT),
    fillObservationContent(value),
    value.fillObservationId,
    'fillObservationId',
    observationIdentityContent(fillObservationContent(value)),
  );
}

export function serializePortfolioSyncSnapshot(value: PortfolioSyncSnapshot): string {
  try {
    const schemaVersion = snapshotSchemaVersion(value.schemaVersion);
    const expectedOrderSchemaVersion =
      schemaVersion === PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION_V1
        ? PORTFOLIO_ORDER_SCHEMA_VERSION_V1
        : PORTFOLIO_ORDER_SCHEMA_VERSION;
    for (const item of value.positions) serializePortfolioPositionObservation(item);
    for (const item of value.orders) {
      if (item.schemaVersion !== expectedOrderSchemaVersion) invalidSerialization();
      serializePortfolioOrderObservation(item);
    }
    for (const item of value.fills) serializePortfolioFillObservation(item);
    serializePortfolioAccountObservation(value.account);
    const snapshot = createPortfolioSyncSnapshotForSchema(
      {
        captureStartedAt: value.knowledgeInterval.captureStartedAt,
        captureCompletedAt: value.knowledgeInterval.captureCompletedAt,
        activityBaselineOnly: value.coverage.activityBaselineOnly,
        activityWindowStartedAt: value.coverage.activityWindowStartedAt,
        activityCutoverAt: value.coverage.activityCutoverAt,
        positionsComplete: value.coverage.positionsComplete,
        ordersComplete: value.coverage.ordersComplete,
        fillsComplete: value.coverage.fillsComplete,
        sourceRequestFingerprints: value.sourceRequestFingerprints,
        account: value.account,
        positions: value.positions,
        orders: value.orders,
        fills: value.fills,
      },
      schemaVersion,
    );
    if (
      JSON.stringify(syncSnapshotContent(snapshot)) !== JSON.stringify(syncSnapshotContent(value))
    ) {
      invalidSerialization();
    }
    return checkedSerialization(
      (matchesExpectedLiteral(schemaVersion, PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION_V1) ||
        matchesExpectedLiteral(schemaVersion, PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION)) &&
        matchesExpectedLiteral(snapshot.provider, PORTFOLIO_PROVIDER) &&
        matchesExpectedLiteral(snapshot.brokerEnvironment, PORTFOLIO_BROKER_ENVIRONMENT) &&
        matchesExpectedLiteral(snapshot.markSource, PORTFOLIO_MARK_SOURCE),
      syncSnapshotContent(snapshot),
      value.snapshotId,
      'snapshotId',
    );
  } catch (error) {
    if (error instanceof PortfolioError && error.code === 'serialization_invalid') throw error;
    return invalidSerialization(error);
  }
}

/**
 * Reconstructs a stored canonical snapshot through the same normalized
 * constructors used at ingestion. The stored bytes, nested identifiers, and
 * snapshot identifier must all agree with that reconstruction.
 */
export function parsePortfolioSyncSnapshot(input: unknown): PortfolioSyncSnapshot {
  try {
    let decoded: unknown = input;
    let sourceText: string | null = null;
    if (typeof input === 'string') {
      sourceText = input;
      decoded = JSON.parse(input) as unknown;
    }

    const record = exactRecord(decoded, SYNC_SNAPSHOT_KEYS);
    const knowledgeInterval = exactRecord(record.knowledgeInterval, [
      'captureStartedAt',
      'captureCompletedAt',
    ]);
    const coverage = exactRecord(record.coverage, [
      'positionsComplete',
      'ordersComplete',
      'fillsComplete',
      'activityBaselineOnly',
      'activityWindowStartedAt',
      'activityCutoverAt',
    ]);
    const sourceRequestFingerprints = exactArray(record.sourceRequestFingerprints);
    const positions = exactArray(record.positions).map(parsePositionObservation);
    const orders = exactArray(record.orders).map(parseOrderObservation);
    const fills = exactArray(record.fills).map(parseFillObservation);
    const snapshot = createPortfolioSyncSnapshotForSchema(
      {
        captureStartedAt: knowledgeInterval.captureStartedAt,
        captureCompletedAt: knowledgeInterval.captureCompletedAt,
        activityBaselineOnly: coverage.activityBaselineOnly,
        activityWindowStartedAt: coverage.activityWindowStartedAt,
        activityCutoverAt: coverage.activityCutoverAt,
        positionsComplete: coverage.positionsComplete,
        ordersComplete: coverage.ordersComplete,
        fillsComplete: coverage.fillsComplete,
        sourceRequestFingerprints,
        account: parseAccountObservation(record.account),
        positions,
        orders,
        fills,
      },
      snapshotSchemaVersion(record.schemaVersion),
    );
    assertStoredId(record.snapshotId, snapshot.snapshotId);

    const reconstructed = serializePortfolioSyncSnapshot(snapshot);
    const canonicalSource = sourceText ?? JSON.stringify(decoded);
    if (canonicalSource !== reconstructed) invalidSerialization();
    return snapshot;
  } catch (error) {
    if (error instanceof PortfolioError && error.code === 'serialization_invalid') throw error;
    return invalidSerialization(error);
  }
}

export function serializePortfolioProjection(value: PortfolioProjection): string {
  return checkedSerialization(
    matchesExpectedLiteral(value.schemaVersion, PORTFOLIO_PROJECTION_SCHEMA_VERSION),
    portfolioProjectionContent(value),
    value.projectionId,
    'projectionId',
  );
}
