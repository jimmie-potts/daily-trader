import {
  createInstrumentId,
  createUtcTimestamp,
  type InstrumentId,
  type UtcTimestamp,
} from '@daily-trader/domain';

import {
  comparePortfolioDecimals,
  createPortfolioDecimal,
  type PortfolioDecimal,
} from './arithmetic.js';
import { PortfolioError } from './errors.js';
import {
  createPortfolioFingerprint,
  hashPortfolioCanonical,
  type PortfolioFingerprint,
} from './identity.js';
import {
  normalizePortfolioProviderTimestamp,
  type PortfolioProviderTimestamp,
} from './provider-timestamp.js';

export const PORTFOLIO_ACCOUNT_SCHEMA_VERSION =
  'daily-trader.portfolio.account-observation.v1' as const;
export const PORTFOLIO_POSITION_SCHEMA_VERSION =
  'daily-trader.portfolio.position-observation.v1' as const;
export const PORTFOLIO_ORDER_SCHEMA_VERSION =
  'daily-trader.portfolio.order-observation.v1' as const;
export const PORTFOLIO_FILL_SCHEMA_VERSION = 'daily-trader.portfolio.fill-observation.v1' as const;
export const PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION =
  'daily-trader.portfolio.sync-snapshot.v1' as const;
export const PORTFOLIO_PROVIDER = 'alpaca' as const;
export const PORTFOLIO_BROKER_ENVIRONMENT = 'paper' as const;
export const PORTFOLIO_MARK_SOURCE = 'broker_mark' as const;
export const PORTFOLIO_POSITION_CURRENCY_SOURCE = 'account' as const;

export type PortfolioPositionSide = 'long' | 'short';
export type PortfolioOrderSide = 'buy' | 'sell';
export type PortfolioOrderState = 'open' | 'terminal' | 'unknown';
export type PortfolioFillType = 'fill' | 'partial_fill';
export type PortfolioHoldingSupportReason =
  'missing_instrument' | 'unsupported_asset_class' | 'unsupported_currency' | 'unsupported_venue';

export type PortfolioHoldingSupport =
  | Readonly<{ state: 'supported'; reason: null }>
  | Readonly<{ state: 'unsupported'; reason: PortfolioHoldingSupportReason }>;

export interface PortfolioObservationContext {
  readonly provider: typeof PORTFOLIO_PROVIDER;
  readonly brokerEnvironment: typeof PORTFOLIO_BROKER_ENVIRONMENT;
  readonly accountFingerprint: PortfolioFingerprint;
  readonly sourceRequestFingerprint: PortfolioFingerprint;
  readonly observedAt: UtcTimestamp;
}

export interface PortfolioAccountObservation extends PortfolioObservationContext {
  readonly schemaVersion: typeof PORTFOLIO_ACCOUNT_SCHEMA_VERSION;
  readonly accountObservationId: PortfolioFingerprint;
  readonly status: string;
  readonly currency: string;
  readonly createdAt: PortfolioProviderTimestamp;
  readonly cash: PortfolioDecimal;
  readonly equity: PortfolioDecimal;
  readonly lastEquity: PortfolioDecimal;
  readonly portfolioValue: PortfolioDecimal;
  readonly longMarketValue: PortfolioDecimal;
  readonly shortMarketValue: PortfolioDecimal;
  readonly buyingPower: PortfolioDecimal | null;
  readonly nonMarginableBuyingPower: PortfolioDecimal | null;
  readonly regtBuyingPower: PortfolioDecimal | null;
  readonly initialMargin: PortfolioDecimal | null;
  readonly maintenanceMargin: PortfolioDecimal | null;
  readonly lastMaintenanceMargin: PortfolioDecimal | null;
  readonly accruedFees: PortfolioDecimal | null;
  readonly pendingTransferIn: PortfolioDecimal | null;
  readonly pendingTransferOut: PortfolioDecimal | null;
  readonly multiplier: PortfolioDecimal | null;
  readonly tradingBlocked: boolean;
  readonly transfersBlocked: boolean;
  readonly accountBlocked: boolean;
  readonly tradeSuspendedByUser: boolean;
  readonly shortingEnabled: boolean;
}

export interface CreatePortfolioAccountObservationInput {
  readonly accountFingerprint: unknown;
  readonly sourceRequestFingerprint: unknown;
  readonly observedAt: unknown;
  readonly status: unknown;
  readonly currency: unknown;
  readonly createdAt: unknown;
  readonly cash: unknown;
  readonly equity: unknown;
  readonly lastEquity: unknown;
  readonly portfolioValue: unknown;
  readonly longMarketValue: unknown;
  readonly shortMarketValue: unknown;
  readonly buyingPower: unknown;
  readonly nonMarginableBuyingPower: unknown;
  readonly regtBuyingPower: unknown;
  readonly initialMargin: unknown;
  readonly maintenanceMargin: unknown;
  readonly lastMaintenanceMargin: unknown;
  readonly accruedFees: unknown;
  readonly pendingTransferIn: unknown;
  readonly pendingTransferOut: unknown;
  readonly multiplier: unknown;
  readonly tradingBlocked: unknown;
  readonly transfersBlocked: unknown;
  readonly accountBlocked: unknown;
  readonly tradeSuspendedByUser: unknown;
  readonly shortingEnabled: unknown;
}

export interface PortfolioPositionObservation extends PortfolioObservationContext {
  readonly schemaVersion: typeof PORTFOLIO_POSITION_SCHEMA_VERSION;
  readonly positionObservationId: PortfolioFingerprint;
  readonly assetFingerprint: PortfolioFingerprint;
  readonly symbol: string;
  readonly instrument: InstrumentId | null;
  readonly providerAssetClass: string;
  readonly providerExchange: string;
  readonly currency: string;
  readonly currencySource: typeof PORTFOLIO_POSITION_CURRENCY_SOURCE;
  readonly side: PortfolioPositionSide;
  readonly quantity: PortfolioDecimal;
  readonly quantityAvailable: PortfolioDecimal | null;
  readonly averageEntryPrice: PortfolioDecimal | null;
  readonly currentPrice: PortfolioDecimal | null;
  readonly marketValue: PortfolioDecimal | null;
  readonly costBasis: PortfolioDecimal | null;
  readonly providerUnrealizedProfitLoss: PortfolioDecimal | null;
  readonly providerUnrealizedProfitLossPercent: PortfolioDecimal | null;
  readonly unrealizedIntradayProfitLoss: PortfolioDecimal | null;
  readonly unrealizedIntradayProfitLossPercent: PortfolioDecimal | null;
  readonly lastDayPrice: PortfolioDecimal | null;
  readonly changeToday: PortfolioDecimal | null;
  readonly assetMarginable: boolean;
  readonly support: PortfolioHoldingSupport;
  readonly markSource: typeof PORTFOLIO_MARK_SOURCE;
}

export interface CreatePortfolioPositionObservationInput {
  readonly accountFingerprint: unknown;
  readonly sourceRequestFingerprint: unknown;
  readonly observedAt: unknown;
  readonly assetFingerprint: unknown;
  readonly symbol: unknown;
  readonly instrument: unknown;
  readonly providerAssetClass: unknown;
  readonly providerExchange: unknown;
  readonly currency: unknown;
  readonly side: unknown;
  readonly quantity: unknown;
  readonly quantityAvailable: unknown;
  readonly averageEntryPrice: unknown;
  readonly currentPrice: unknown;
  readonly marketValue: unknown;
  readonly costBasis: unknown;
  readonly providerUnrealizedProfitLoss: unknown;
  readonly providerUnrealizedProfitLossPercent: unknown;
  readonly unrealizedIntradayProfitLoss: unknown;
  readonly unrealizedIntradayProfitLossPercent: unknown;
  readonly lastDayPrice: unknown;
  readonly changeToday: unknown;
  readonly assetMarginable: unknown;
  readonly support: unknown;
}

export interface PortfolioOrderObservation extends PortfolioObservationContext {
  readonly schemaVersion: typeof PORTFOLIO_ORDER_SCHEMA_VERSION;
  readonly orderObservationId: PortfolioFingerprint;
  readonly orderFingerprint: PortfolioFingerprint;
  readonly clientOrderFingerprint: PortfolioFingerprint;
  readonly assetFingerprint: PortfolioFingerprint | null;
  readonly symbol: string;
  readonly instrument: InstrumentId | null;
  readonly providerAssetClass: string;
  readonly side: PortfolioOrderSide;
  readonly orderType: string;
  readonly orderClass: string | null;
  readonly positionIntent: string | null;
  readonly timeInForce: string;
  readonly providerStatus: string;
  readonly state: PortfolioOrderState;
  readonly support: PortfolioHoldingSupport;
  readonly extendedHours: boolean;
  readonly quantity: PortfolioDecimal | null;
  readonly notional: PortfolioDecimal | null;
  readonly filledQuantity: PortfolioDecimal;
  readonly filledAveragePrice: PortfolioDecimal | null;
  readonly limitPrice: PortfolioDecimal | null;
  readonly stopPrice: PortfolioDecimal | null;
  readonly commission: PortfolioDecimal | null;
  readonly trailPercent: PortfolioDecimal | null;
  readonly trailPrice: PortfolioDecimal | null;
  readonly highWaterMark: PortfolioDecimal | null;
  readonly replacedByFingerprint: PortfolioFingerprint | null;
  readonly replacesFingerprint: PortfolioFingerprint | null;
  readonly createdAt: PortfolioProviderTimestamp;
  readonly updatedAt: PortfolioProviderTimestamp | null;
  readonly submittedAt: PortfolioProviderTimestamp | null;
  readonly filledAt: PortfolioProviderTimestamp | null;
  readonly canceledAt: PortfolioProviderTimestamp | null;
  readonly failedAt: PortfolioProviderTimestamp | null;
  readonly replacedAt: PortfolioProviderTimestamp | null;
  readonly expiredAt: PortfolioProviderTimestamp | null;
}

export interface CreatePortfolioOrderObservationInput {
  readonly accountFingerprint: unknown;
  readonly sourceRequestFingerprint: unknown;
  readonly observedAt: unknown;
  readonly orderFingerprint: unknown;
  readonly clientOrderFingerprint: unknown;
  readonly assetFingerprint: unknown;
  readonly symbol: unknown;
  readonly instrument: unknown;
  readonly providerAssetClass: unknown;
  readonly side: unknown;
  readonly orderType: unknown;
  readonly orderClass: unknown;
  readonly positionIntent: unknown;
  readonly timeInForce: unknown;
  readonly providerStatus: unknown;
  readonly state: unknown;
  readonly support: unknown;
  readonly extendedHours: unknown;
  readonly quantity: unknown;
  readonly notional: unknown;
  readonly filledQuantity: unknown;
  readonly filledAveragePrice: unknown;
  readonly limitPrice: unknown;
  readonly stopPrice: unknown;
  readonly commission: unknown;
  readonly trailPercent: unknown;
  readonly trailPrice: unknown;
  readonly highWaterMark: unknown;
  readonly replacedByFingerprint: unknown;
  readonly replacesFingerprint: unknown;
  readonly createdAt: unknown;
  readonly submittedAt: unknown;
  readonly updatedAt: unknown;
  readonly filledAt: unknown;
  readonly canceledAt: unknown;
  readonly failedAt: unknown;
  readonly replacedAt: unknown;
  readonly expiredAt: unknown;
}

export interface PortfolioFillObservation extends PortfolioObservationContext {
  readonly schemaVersion: typeof PORTFOLIO_FILL_SCHEMA_VERSION;
  readonly fillObservationId: PortfolioFingerprint;
  readonly fillFingerprint: PortfolioFingerprint;
  readonly orderFingerprint: PortfolioFingerprint;
  readonly assetFingerprint: PortfolioFingerprint | null;
  readonly symbol: string;
  readonly instrument: InstrumentId | null;
  readonly side: PortfolioOrderSide;
  readonly type: PortfolioFillType;
  readonly quantity: PortfolioDecimal;
  readonly price: PortfolioDecimal;
  readonly cumulativeQuantity: PortfolioDecimal;
  readonly leavesQuantity: PortfolioDecimal;
  readonly transactionAt: PortfolioProviderTimestamp;
}

export interface CreatePortfolioFillObservationInput {
  readonly accountFingerprint: unknown;
  readonly sourceRequestFingerprint: unknown;
  readonly observedAt: unknown;
  readonly fillFingerprint: unknown;
  readonly orderFingerprint: unknown;
  readonly assetFingerprint: unknown;
  readonly symbol: unknown;
  readonly instrument: unknown;
  readonly side: unknown;
  readonly type: unknown;
  readonly quantity: unknown;
  readonly price: unknown;
  readonly cumulativeQuantity: unknown;
  readonly leavesQuantity: unknown;
  readonly transactionAt: unknown;
}

export interface PortfolioSnapshotCoverage {
  readonly positionsComplete: boolean;
  readonly ordersComplete: boolean;
  /**
   * True when every page for the provider's bounded activity-creation query was read.
   * This does not claim complete fill execution history by `transactionAt`.
   */
  readonly fillsComplete: boolean;
  /** True only when this is the first bounded fill-activity query for the local account view. */
  readonly activityBaselineOnly: boolean;
  /**
   * Exclusive lower `after` bound applied by the provider to activity creation time.
   * The bounded overlap may predate the prior cutover.
   */
  readonly activityWindowStartedAt: UtcTimestamp;
  /** Exclusive upper `until` bound applied by the provider to activity creation time. */
  readonly activityCutoverAt: UtcTimestamp;
}

export interface PortfolioSyncSnapshot {
  readonly schemaVersion: typeof PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION;
  readonly snapshotId: PortfolioFingerprint;
  readonly provider: typeof PORTFOLIO_PROVIDER;
  readonly brokerEnvironment: typeof PORTFOLIO_BROKER_ENVIRONMENT;
  readonly accountFingerprint: PortfolioFingerprint;
  readonly markSource: typeof PORTFOLIO_MARK_SOURCE;
  readonly sourceRequestFingerprints: readonly PortfolioFingerprint[];
  readonly knowledgeInterval: Readonly<{
    captureStartedAt: UtcTimestamp;
    captureCompletedAt: UtcTimestamp;
  }>;
  readonly coverage: PortfolioSnapshotCoverage;
  readonly account: PortfolioAccountObservation;
  readonly positions: readonly PortfolioPositionObservation[];
  readonly orders: readonly PortfolioOrderObservation[];
  readonly fills: readonly PortfolioFillObservation[];
}

export interface CreatePortfolioSyncSnapshotInput {
  readonly captureStartedAt: unknown;
  readonly captureCompletedAt: unknown;
  readonly activityBaselineOnly: unknown;
  readonly activityWindowStartedAt: unknown;
  readonly activityCutoverAt: unknown;
  readonly positionsComplete: unknown;
  readonly ordersComplete: unknown;
  readonly fillsComplete: unknown;
  readonly sourceRequestFingerprints: readonly unknown[];
  readonly account: PortfolioAccountObservation;
  readonly positions: readonly PortfolioPositionObservation[];
  readonly orders: readonly PortfolioOrderObservation[];
  readonly fills: readonly PortfolioFillObservation[];
}

const BOUNDED_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SYMBOL = /^[A-Z0-9][A-Z0-9./-]{0,31}$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const ZERO = createPortfolioDecimal('0');

function boundedIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !BOUNDED_IDENTIFIER.test(value)) {
    throw new PortfolioError('contract_invalid');
  }
  return value;
}

function boundedProviderText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 127 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new PortfolioError('contract_invalid');
  }
  return value;
}

function optionalProviderText(value: unknown): string | null {
  return value === null ? null : boundedProviderText(value);
}

function symbol(value: unknown): string {
  if (typeof value !== 'string' || !SYMBOL.test(value)) {
    throw new PortfolioError('contract_invalid');
  }
  return value;
}

function currency(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY.test(value)) {
    throw new PortfolioError('contract_invalid');
  }
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new PortfolioError('contract_invalid');
  return value;
}

function optionalDecimal(value: unknown): PortfolioDecimal | null {
  return value === null ? null : createPortfolioDecimal(value);
}

function optionalTimestamp(value: unknown): UtcTimestamp | null {
  if (value === null) return null;
  try {
    return createUtcTimestamp(value);
  } catch {
    throw new PortfolioError('contract_invalid');
  }
}

function optionalProviderTimestamp(value: unknown): PortfolioProviderTimestamp | null {
  return value === null ? null : normalizePortfolioProviderTimestamp(value);
}

function timestamp(value: unknown): UtcTimestamp {
  const result = optionalTimestamp(value);
  if (result === null) throw new PortfolioError('contract_invalid');
  return result;
}

function fingerprint(value: unknown): PortfolioFingerprint {
  return createPortfolioFingerprint(value);
}

function optionalFingerprint(value: unknown): PortfolioFingerprint | null {
  return value === null ? null : fingerprint(value);
}

function instrument(value: unknown, expectedSymbol: string): InstrumentId | null {
  if (value === null) return null;
  if (typeof value !== 'object') throw new PortfolioError('contract_invalid');
  const record = value as Readonly<Record<string, unknown>>;
  let result: InstrumentId;
  try {
    result = createInstrumentId(record.symbol, record.venue);
  } catch {
    throw new PortfolioError('contract_invalid');
  }
  if (result.symbol !== expectedSymbol) throw new PortfolioError('contract_invalid');
  return result;
}

function support(value: unknown): PortfolioHoldingSupport {
  if (typeof value !== 'object' || value === null) throw new PortfolioError('contract_invalid');
  const record = value as Readonly<Record<string, unknown>>;
  if (record.state === 'supported' && (record.reason === null || record.reason === undefined)) {
    return Object.freeze({ state: 'supported', reason: null });
  }
  const reasons: readonly PortfolioHoldingSupportReason[] = [
    'missing_instrument',
    'unsupported_asset_class',
    'unsupported_currency',
    'unsupported_venue',
  ];
  if (record.state === 'unsupported' && reasons.includes(record.reason as never)) {
    return Object.freeze({
      state: 'unsupported',
      reason: record.reason as PortfolioHoldingSupportReason,
    });
  }
  throw new PortfolioError('contract_invalid');
}

function positive(value: PortfolioDecimal): void {
  if (comparePortfolioDecimals(value, ZERO) <= 0) throw new PortfolioError('contract_invalid');
}

function nonnegative(value: PortfolioDecimal): void {
  if (comparePortfolioDecimals(value, ZERO) < 0) throw new PortfolioError('contract_invalid');
}

function context(
  accountFingerprint: unknown,
  sourceRequestFingerprint: unknown,
  observedAt: unknown,
): PortfolioObservationContext {
  return Object.freeze({
    provider: PORTFOLIO_PROVIDER,
    brokerEnvironment: PORTFOLIO_BROKER_ENVIRONMENT,
    accountFingerprint: fingerprint(accountFingerprint),
    sourceRequestFingerprint: fingerprint(sourceRequestFingerprint),
    observedAt: timestamp(observedAt),
  });
}

export function observationIdentityContent(
  content: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(content).filter(
      ([name]) => name !== 'observedAt' && name !== 'sourceRequestFingerprint',
    ),
  );
}

export function accountObservationContent(
  observation: Omit<PortfolioAccountObservation, 'accountObservationId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: observation.schemaVersion,
    provider: observation.provider,
    brokerEnvironment: observation.brokerEnvironment,
    accountFingerprint: observation.accountFingerprint,
    sourceRequestFingerprint: observation.sourceRequestFingerprint,
    observedAt: observation.observedAt,
    status: observation.status,
    currency: observation.currency,
    createdAt: observation.createdAt,
    cash: observation.cash,
    equity: observation.equity,
    lastEquity: observation.lastEquity,
    portfolioValue: observation.portfolioValue,
    longMarketValue: observation.longMarketValue,
    shortMarketValue: observation.shortMarketValue,
    buyingPower: observation.buyingPower,
    nonMarginableBuyingPower: observation.nonMarginableBuyingPower,
    regtBuyingPower: observation.regtBuyingPower,
    initialMargin: observation.initialMargin,
    maintenanceMargin: observation.maintenanceMargin,
    lastMaintenanceMargin: observation.lastMaintenanceMargin,
    accruedFees: observation.accruedFees,
    pendingTransferIn: observation.pendingTransferIn,
    pendingTransferOut: observation.pendingTransferOut,
    multiplier: observation.multiplier,
    tradingBlocked: observation.tradingBlocked,
    transfersBlocked: observation.transfersBlocked,
    accountBlocked: observation.accountBlocked,
    tradeSuspendedByUser: observation.tradeSuspendedByUser,
    shortingEnabled: observation.shortingEnabled,
  };
}

export function createPortfolioAccountObservation(
  input: CreatePortfolioAccountObservationInput,
): PortfolioAccountObservation {
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_ACCOUNT_SCHEMA_VERSION,
    ...context(input.accountFingerprint, input.sourceRequestFingerprint, input.observedAt),
    status: boundedIdentifier(input.status),
    currency: currency(input.currency),
    createdAt: normalizePortfolioProviderTimestamp(input.createdAt),
    cash: createPortfolioDecimal(input.cash),
    equity: createPortfolioDecimal(input.equity),
    lastEquity: createPortfolioDecimal(input.lastEquity),
    portfolioValue: createPortfolioDecimal(input.portfolioValue),
    longMarketValue: createPortfolioDecimal(input.longMarketValue),
    shortMarketValue: createPortfolioDecimal(input.shortMarketValue),
    buyingPower: optionalDecimal(input.buyingPower),
    nonMarginableBuyingPower: optionalDecimal(input.nonMarginableBuyingPower),
    regtBuyingPower: optionalDecimal(input.regtBuyingPower),
    initialMargin: optionalDecimal(input.initialMargin),
    maintenanceMargin: optionalDecimal(input.maintenanceMargin),
    lastMaintenanceMargin: optionalDecimal(input.lastMaintenanceMargin),
    accruedFees: optionalDecimal(input.accruedFees),
    pendingTransferIn: optionalDecimal(input.pendingTransferIn),
    pendingTransferOut: optionalDecimal(input.pendingTransferOut),
    multiplier: optionalDecimal(input.multiplier),
    tradingBlocked: bool(input.tradingBlocked),
    transfersBlocked: bool(input.transfersBlocked),
    accountBlocked: bool(input.accountBlocked),
    tradeSuspendedByUser: bool(input.tradeSuspendedByUser),
    shortingEnabled: bool(input.shortingEnabled),
  });
  return Object.freeze({
    ...unsigned,
    accountObservationId: hashPortfolioCanonical(
      JSON.stringify(observationIdentityContent(accountObservationContent(unsigned))),
    ),
  });
}

export function positionObservationContent(
  observation: Omit<PortfolioPositionObservation, 'positionObservationId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: observation.schemaVersion,
    provider: observation.provider,
    brokerEnvironment: observation.brokerEnvironment,
    accountFingerprint: observation.accountFingerprint,
    sourceRequestFingerprint: observation.sourceRequestFingerprint,
    observedAt: observation.observedAt,
    assetFingerprint: observation.assetFingerprint,
    symbol: observation.symbol,
    instrument: observation.instrument,
    providerAssetClass: observation.providerAssetClass,
    providerExchange: observation.providerExchange,
    currency: observation.currency,
    currencySource: observation.currencySource,
    side: observation.side,
    quantity: observation.quantity,
    quantityAvailable: observation.quantityAvailable,
    averageEntryPrice: observation.averageEntryPrice,
    currentPrice: observation.currentPrice,
    marketValue: observation.marketValue,
    costBasis: observation.costBasis,
    providerUnrealizedProfitLoss: observation.providerUnrealizedProfitLoss,
    providerUnrealizedProfitLossPercent: observation.providerUnrealizedProfitLossPercent,
    unrealizedIntradayProfitLoss: observation.unrealizedIntradayProfitLoss,
    unrealizedIntradayProfitLossPercent: observation.unrealizedIntradayProfitLossPercent,
    lastDayPrice: observation.lastDayPrice,
    changeToday: observation.changeToday,
    assetMarginable: observation.assetMarginable,
    support: observation.support,
    markSource: observation.markSource,
  };
}

export function createPortfolioPositionObservation(
  input: CreatePortfolioPositionObservationInput,
): PortfolioPositionObservation {
  const normalizedSymbol = symbol(input.symbol);
  const normalizedInstrument = instrument(input.instrument, normalizedSymbol);
  const normalizedSupport = support(input.support);
  const providerAssetClass = boundedIdentifier(input.providerAssetClass);
  const normalizedCurrency = currency(input.currency);
  if (
    normalizedSupport.state === 'supported' &&
    (providerAssetClass !== 'us_equity' ||
      normalizedCurrency !== 'USD' ||
      normalizedInstrument === null)
  ) {
    throw new PortfolioError('contract_invalid');
  }
  const side = input.side;
  if (side !== 'long' && side !== 'short') throw new PortfolioError('contract_invalid');
  const quantity = createPortfolioDecimal(input.quantity);
  const quantitySign = comparePortfolioDecimals(quantity, ZERO);
  if ((side === 'long' && quantitySign <= 0) || (side === 'short' && quantitySign >= 0)) {
    throw new PortfolioError('contract_invalid');
  }
  const averageEntryPrice = optionalDecimal(input.averageEntryPrice);
  const currentPrice = optionalDecimal(input.currentPrice);
  const quantityAvailable = optionalDecimal(input.quantityAvailable);
  const lastDayPrice = optionalDecimal(input.lastDayPrice);
  if (averageEntryPrice !== null) positive(averageEntryPrice);
  if (currentPrice !== null) positive(currentPrice);
  if (quantityAvailable !== null) {
    const availableSign = comparePortfolioDecimals(quantityAvailable, ZERO);
    if ((side === 'long' && availableSign < 0) || (side === 'short' && availableSign > 0)) {
      throw new PortfolioError('contract_invalid');
    }
  }
  if (lastDayPrice !== null) positive(lastDayPrice);
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_POSITION_SCHEMA_VERSION,
    ...context(input.accountFingerprint, input.sourceRequestFingerprint, input.observedAt),
    assetFingerprint: fingerprint(input.assetFingerprint),
    symbol: normalizedSymbol,
    instrument: normalizedInstrument,
    providerAssetClass,
    providerExchange: boundedProviderText(input.providerExchange),
    currency: normalizedCurrency,
    currencySource: PORTFOLIO_POSITION_CURRENCY_SOURCE,
    side,
    quantity,
    quantityAvailable,
    averageEntryPrice,
    currentPrice,
    marketValue: optionalDecimal(input.marketValue),
    costBasis: optionalDecimal(input.costBasis),
    providerUnrealizedProfitLoss: optionalDecimal(input.providerUnrealizedProfitLoss),
    providerUnrealizedProfitLossPercent: optionalDecimal(input.providerUnrealizedProfitLossPercent),
    unrealizedIntradayProfitLoss: optionalDecimal(input.unrealizedIntradayProfitLoss),
    unrealizedIntradayProfitLossPercent: optionalDecimal(input.unrealizedIntradayProfitLossPercent),
    lastDayPrice,
    changeToday: optionalDecimal(input.changeToday),
    assetMarginable: bool(input.assetMarginable),
    support: normalizedSupport,
    markSource: PORTFOLIO_MARK_SOURCE,
  });
  return Object.freeze({
    ...unsigned,
    positionObservationId: hashPortfolioCanonical(
      JSON.stringify(observationIdentityContent(positionObservationContent(unsigned))),
    ),
  });
}

export function orderObservationContent(
  observation: Omit<PortfolioOrderObservation, 'orderObservationId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: observation.schemaVersion,
    provider: observation.provider,
    brokerEnvironment: observation.brokerEnvironment,
    accountFingerprint: observation.accountFingerprint,
    sourceRequestFingerprint: observation.sourceRequestFingerprint,
    observedAt: observation.observedAt,
    orderFingerprint: observation.orderFingerprint,
    clientOrderFingerprint: observation.clientOrderFingerprint,
    assetFingerprint: observation.assetFingerprint,
    symbol: observation.symbol,
    instrument: observation.instrument,
    providerAssetClass: observation.providerAssetClass,
    side: observation.side,
    orderType: observation.orderType,
    orderClass: observation.orderClass,
    positionIntent: observation.positionIntent,
    timeInForce: observation.timeInForce,
    providerStatus: observation.providerStatus,
    state: observation.state,
    support: observation.support,
    extendedHours: observation.extendedHours,
    quantity: observation.quantity,
    notional: observation.notional,
    filledQuantity: observation.filledQuantity,
    filledAveragePrice: observation.filledAveragePrice,
    limitPrice: observation.limitPrice,
    stopPrice: observation.stopPrice,
    commission: observation.commission,
    trailPercent: observation.trailPercent,
    trailPrice: observation.trailPrice,
    highWaterMark: observation.highWaterMark,
    replacedByFingerprint: observation.replacedByFingerprint,
    replacesFingerprint: observation.replacesFingerprint,
    createdAt: observation.createdAt,
    submittedAt: observation.submittedAt,
    updatedAt: observation.updatedAt,
    filledAt: observation.filledAt,
    canceledAt: observation.canceledAt,
    failedAt: observation.failedAt,
    replacedAt: observation.replacedAt,
    expiredAt: observation.expiredAt,
  };
}

export function createPortfolioOrderObservation(
  input: CreatePortfolioOrderObservationInput,
): PortfolioOrderObservation {
  const normalizedSymbol = symbol(input.symbol);
  const side = input.side;
  if (side !== 'buy' && side !== 'sell') throw new PortfolioError('contract_invalid');
  const state = input.state;
  if (state !== 'open' && state !== 'terminal' && state !== 'unknown') {
    throw new PortfolioError('contract_invalid');
  }
  const normalizedSupport = support(input.support);
  const normalizedInstrument = instrument(input.instrument, normalizedSymbol);
  const providerAssetClass = boundedIdentifier(input.providerAssetClass);
  if (
    normalizedSupport.state === 'supported' &&
    (providerAssetClass !== 'us_equity' || normalizedInstrument === null)
  ) {
    throw new PortfolioError('contract_invalid');
  }
  const quantity = optionalDecimal(input.quantity);
  const notional = optionalDecimal(input.notional);
  if (quantity === null && notional === null) throw new PortfolioError('contract_invalid');
  if (quantity !== null) positive(quantity);
  if (notional !== null) positive(notional);
  const filledQuantity = createPortfolioDecimal(input.filledQuantity);
  nonnegative(filledQuantity);
  if (quantity !== null && comparePortfolioDecimals(filledQuantity, quantity) > 0) {
    throw new PortfolioError('contract_invalid');
  }
  const filledAveragePrice = optionalDecimal(input.filledAveragePrice);
  const limitPrice = optionalDecimal(input.limitPrice);
  const stopPrice = optionalDecimal(input.stopPrice);
  if (filledAveragePrice !== null) nonnegative(filledAveragePrice);
  if (limitPrice !== null) positive(limitPrice);
  if (stopPrice !== null) positive(stopPrice);
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_ORDER_SCHEMA_VERSION,
    ...context(input.accountFingerprint, input.sourceRequestFingerprint, input.observedAt),
    orderFingerprint: fingerprint(input.orderFingerprint),
    clientOrderFingerprint: fingerprint(input.clientOrderFingerprint),
    assetFingerprint: optionalFingerprint(input.assetFingerprint),
    symbol: normalizedSymbol,
    instrument: normalizedInstrument,
    providerAssetClass,
    side,
    orderType: boundedIdentifier(input.orderType),
    orderClass: optionalProviderText(input.orderClass),
    positionIntent: optionalProviderText(input.positionIntent),
    timeInForce: boundedIdentifier(input.timeInForce),
    providerStatus: boundedIdentifier(input.providerStatus),
    state,
    support: normalizedSupport,
    extendedHours: bool(input.extendedHours),
    quantity,
    notional,
    filledQuantity,
    filledAveragePrice,
    limitPrice,
    stopPrice,
    commission: optionalDecimal(input.commission),
    trailPercent: optionalDecimal(input.trailPercent),
    trailPrice: optionalDecimal(input.trailPrice),
    highWaterMark: optionalDecimal(input.highWaterMark),
    replacedByFingerprint: optionalFingerprint(input.replacedByFingerprint),
    replacesFingerprint: optionalFingerprint(input.replacesFingerprint),
    createdAt: normalizePortfolioProviderTimestamp(input.createdAt),
    updatedAt: optionalProviderTimestamp(input.updatedAt),
    submittedAt: optionalProviderTimestamp(input.submittedAt),
    filledAt: optionalProviderTimestamp(input.filledAt),
    canceledAt: optionalProviderTimestamp(input.canceledAt),
    failedAt: optionalProviderTimestamp(input.failedAt),
    replacedAt: optionalProviderTimestamp(input.replacedAt),
    expiredAt: optionalProviderTimestamp(input.expiredAt),
  });
  return Object.freeze({
    ...unsigned,
    orderObservationId: hashPortfolioCanonical(
      JSON.stringify(observationIdentityContent(orderObservationContent(unsigned))),
    ),
  });
}

export function fillObservationContent(
  observation: Omit<PortfolioFillObservation, 'fillObservationId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: observation.schemaVersion,
    provider: observation.provider,
    brokerEnvironment: observation.brokerEnvironment,
    accountFingerprint: observation.accountFingerprint,
    sourceRequestFingerprint: observation.sourceRequestFingerprint,
    observedAt: observation.observedAt,
    fillFingerprint: observation.fillFingerprint,
    orderFingerprint: observation.orderFingerprint,
    assetFingerprint: observation.assetFingerprint,
    symbol: observation.symbol,
    instrument: observation.instrument,
    side: observation.side,
    type: observation.type,
    quantity: observation.quantity,
    price: observation.price,
    cumulativeQuantity: observation.cumulativeQuantity,
    leavesQuantity: observation.leavesQuantity,
    transactionAt: observation.transactionAt,
  };
}

export function createPortfolioFillObservation(
  input: CreatePortfolioFillObservationInput,
): PortfolioFillObservation {
  const normalizedSymbol = symbol(input.symbol);
  if (input.side !== 'buy' && input.side !== 'sell') throw new PortfolioError('contract_invalid');
  if (input.type !== 'fill' && input.type !== 'partial_fill') {
    throw new PortfolioError('contract_invalid');
  }
  const quantity = createPortfolioDecimal(input.quantity);
  const price = createPortfolioDecimal(input.price);
  const cumulativeQuantity = createPortfolioDecimal(input.cumulativeQuantity);
  const leavesQuantity = createPortfolioDecimal(input.leavesQuantity);
  positive(quantity);
  positive(price);
  positive(cumulativeQuantity);
  nonnegative(leavesQuantity);
  if (comparePortfolioDecimals(cumulativeQuantity, quantity) < 0) {
    throw new PortfolioError('contract_invalid');
  }
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_FILL_SCHEMA_VERSION,
    ...context(input.accountFingerprint, input.sourceRequestFingerprint, input.observedAt),
    fillFingerprint: fingerprint(input.fillFingerprint),
    orderFingerprint: fingerprint(input.orderFingerprint),
    assetFingerprint: optionalFingerprint(input.assetFingerprint),
    symbol: normalizedSymbol,
    instrument: instrument(input.instrument, normalizedSymbol),
    side: input.side,
    type: input.type,
    quantity,
    price,
    cumulativeQuantity,
    leavesQuantity,
    transactionAt: normalizePortfolioProviderTimestamp(input.transactionAt),
  });
  return Object.freeze({
    ...unsigned,
    fillObservationId: hashPortfolioCanonical(
      JSON.stringify(observationIdentityContent(fillObservationContent(unsigned))),
    ),
  });
}

function assertObservationInterval(
  observedAt: UtcTimestamp,
  start: UtcTimestamp,
  end: UtcTimestamp,
): void {
  if (observedAt < start || observedAt > end) throw new PortfolioError('contract_invalid');
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): void {
  const keys = new Set<string>();
  for (const value of values) {
    const current = key(value);
    if (keys.has(current)) throw new PortfolioError('contract_invalid');
    keys.add(current);
  }
}

export function syncSnapshotContent(
  snapshot: Omit<PortfolioSyncSnapshot, 'snapshotId'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: snapshot.schemaVersion,
    provider: snapshot.provider,
    brokerEnvironment: snapshot.brokerEnvironment,
    accountFingerprint: snapshot.accountFingerprint,
    markSource: snapshot.markSource,
    sourceRequestFingerprints: snapshot.sourceRequestFingerprints,
    knowledgeInterval: snapshot.knowledgeInterval,
    coverage: snapshot.coverage,
    account: snapshot.account,
    positions: snapshot.positions,
    orders: snapshot.orders,
    fills: snapshot.fills,
  };
}

export function createPortfolioSyncSnapshot(
  input: CreatePortfolioSyncSnapshotInput,
): PortfolioSyncSnapshot {
  const captureStartedAt = timestamp(input.captureStartedAt);
  const captureCompletedAt = timestamp(input.captureCompletedAt);
  const activityWindowStartedAt = timestamp(input.activityWindowStartedAt);
  const activityCutoverAt = timestamp(input.activityCutoverAt);
  if (
    captureCompletedAt < captureStartedAt ||
    activityWindowStartedAt > activityCutoverAt ||
    activityCutoverAt < captureStartedAt ||
    activityCutoverAt > captureCompletedAt
  ) {
    throw new PortfolioError('contract_invalid');
  }
  const positionsComplete = bool(input.positionsComplete);
  const ordersComplete = bool(input.ordersComplete);
  const fillsComplete = bool(input.fillsComplete);
  const accountFingerprint = createPortfolioFingerprint(input.account.accountFingerprint);
  const positions = [...input.positions].sort((left, right) =>
    left.assetFingerprint.localeCompare(right.assetFingerprint),
  );
  const orders = [...input.orders].sort((left, right) =>
    left.orderFingerprint.localeCompare(right.orderFingerprint),
  );
  const fills = [...input.fills].sort(
    (left, right) =>
      left.transactionAt.utc.localeCompare(right.transactionAt.utc) ||
      left.fillFingerprint.localeCompare(right.fillFingerprint),
  );
  const sourceRequestFingerprints = [...input.sourceRequestFingerprints]
    .map((value) => fingerprint(value))
    .sort();
  if (sourceRequestFingerprints.length === 0) throw new PortfolioError('contract_invalid');
  uniqueBy(sourceRequestFingerprints, (value) => value);
  uniqueBy(positions, (value) => value.assetFingerprint);
  uniqueBy(orders, (value) => value.orderFingerprint);
  uniqueBy(fills, (value) => value.fillFingerprint);
  for (const observation of [input.account, ...positions, ...orders, ...fills]) {
    if (observation.accountFingerprint !== accountFingerprint) {
      throw new PortfolioError('contract_invalid');
    }
    if (!sourceRequestFingerprints.includes(observation.sourceRequestFingerprint)) {
      throw new PortfolioError('contract_invalid');
    }
    assertObservationInterval(observation.observedAt, captureStartedAt, captureCompletedAt);
  }
  for (const position of positions) {
    if (position.currency !== input.account.currency) {
      throw new PortfolioError('contract_invalid');
    }
  }
  const unsigned = Object.freeze({
    schemaVersion: PORTFOLIO_SYNC_SNAPSHOT_SCHEMA_VERSION,
    provider: PORTFOLIO_PROVIDER,
    brokerEnvironment: PORTFOLIO_BROKER_ENVIRONMENT,
    accountFingerprint,
    markSource: PORTFOLIO_MARK_SOURCE,
    sourceRequestFingerprints: Object.freeze(sourceRequestFingerprints),
    knowledgeInterval: Object.freeze({ captureStartedAt, captureCompletedAt }),
    coverage: Object.freeze({
      positionsComplete,
      ordersComplete,
      fillsComplete,
      activityBaselineOnly: bool(input.activityBaselineOnly),
      activityWindowStartedAt,
      activityCutoverAt,
    }),
    account: input.account,
    positions: Object.freeze(positions),
    orders: Object.freeze(orders),
    fills: Object.freeze(fills),
  });
  return Object.freeze({
    ...unsigned,
    snapshotId: hashPortfolioCanonical(JSON.stringify(syncSnapshotContent(unsigned))),
  });
}
