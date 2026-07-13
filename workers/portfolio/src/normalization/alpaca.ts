import { createInstrumentId, type InstrumentId } from '@daily-trader/domain';
import {
  addPortfolioDecimals,
  comparePortfolioDecimals,
  createPortfolioAccountObservation,
  createPortfolioFillObservation,
  createPortfolioOrderObservation,
  createPortfolioPositionObservation,
  createPortfolioSyncSnapshot,
  fingerprintPortfolioSourceIdentifier,
  normalizePortfolioDecimalLexeme,
  type PortfolioDecimal,
  type PortfolioFillObservation,
  type PortfolioFingerprint,
  type PortfolioHoldingSupport,
  type PortfolioOrderObservation,
  type PortfolioOrderState,
  type PortfolioPositionObservation,
  type PortfolioSyncSnapshot,
} from '@daily-trader/portfolio';

import { AlpacaPaperApiError } from '../providers/alpaca/errors.js';
import type {
  AlpacaRawCapture,
  AlpacaRawResponse,
  AlpacaResponseMetadata,
} from '../providers/alpaca/types.js';

type JsonRecord = Readonly<Record<string, unknown>>;

const MAX_PROVIDER_TEXT_LENGTH = 512;
const MAX_ORDER_LEGS = 16;
const ZERO = normalizePortfolioDecimalLexeme('0');

const EXCHANGE_TO_MIC = Object.freeze({
  AMEX: 'XASE',
  ARCA: 'ARCX',
  BATS: 'BATS',
  NASDAQ: 'XNAS',
  NYSE: 'XNYS',
  NYSEARCA: 'ARCX',
} as const);

const OPEN_ORDER_STATUSES = new Set([
  'accepted',
  'accepted_for_bidding',
  'done_for_day',
  'held',
  'new',
  'partially_filled',
  'pending_cancel',
  'pending_new',
  'pending_replace',
  'stopped',
  'suspended',
]);
const TERMINAL_ORDER_STATUSES = new Set(['canceled', 'expired', 'filled', 'rejected', 'replaced']);
const ORDER_TYPES = new Set(['limit', 'market', 'stop', 'stop_limit', 'trailing_stop']);
const ORDER_CLASSES = new Set(['', 'bracket', 'mleg', 'oco', 'oto', 'simple']);
const POSITION_INTENTS = new Set(['buy_to_close', 'buy_to_open', 'sell_to_close', 'sell_to_open']);
const TIME_IN_FORCE_VALUES = new Set(['cls', 'day', 'fok', 'gtc', 'ioc', 'opg']);

function malformed(code: string): AlpacaPaperApiError {
  return new AlpacaPaperApiError({ classification: 'malformed_response', code });
}

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed('ALPACA_PAYLOAD_INVALID');
  }
  return value as JsonRecord;
}

function providerText(value: unknown, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > MAX_PROVIDER_TEXT_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw malformed('ALPACA_TEXT_INVALID');
  }
  return value;
}

function requiredText(value: JsonRecord, key: string): string {
  return providerText(value[key]);
}

function nullableText(value: JsonRecord, key: string, allowEmpty = false): string | null {
  const candidate = value[key];
  return candidate === null ? null : providerText(candidate, allowEmpty);
}

function boolean(value: JsonRecord, key: string): boolean {
  const candidate = value[key];
  if (typeof candidate !== 'boolean') throw malformed('ALPACA_BOOLEAN_INVALID');
  return candidate;
}

function decimal(value: JsonRecord, key: string): PortfolioDecimal {
  try {
    return normalizePortfolioDecimalLexeme(value[key]);
  } catch {
    throw malformed('ALPACA_DECIMAL_INVALID');
  }
}

function nullableDecimal(value: JsonRecord, key: string): PortfolioDecimal | null {
  return value[key] === null ? null : decimal(value, key);
}

function sourceFingerprint(
  kind: 'account' | 'asset' | 'client_order' | 'fill' | 'order' | 'request',
  value: unknown,
): PortfolioFingerprint {
  try {
    return fingerprintPortfolioSourceIdentifier(kind, providerText(value));
  } catch {
    throw malformed('ALPACA_SOURCE_ID_INVALID');
  }
}

function nullableSourceFingerprint(
  kind: 'asset' | 'order',
  value: unknown,
): PortfolioFingerprint | null {
  return value === null ? null : sourceFingerprint(kind, value);
}

function requestFingerprint(metadata: AlpacaResponseMetadata): PortfolioFingerprint {
  return sourceFingerprint('request', metadata.requestId);
}

interface InstrumentMapping {
  readonly instrument: InstrumentId | null;
  readonly missingReason: 'missing_instrument' | 'unsupported_venue';
}

function micForExchange(providerExchange: string): string | null {
  switch (providerExchange) {
    case 'AMEX':
      return EXCHANGE_TO_MIC.AMEX;
    case 'ARCA':
    case 'NYSEARCA':
      return EXCHANGE_TO_MIC.ARCA;
    case 'BATS':
      return EXCHANGE_TO_MIC.BATS;
    case 'NASDAQ':
      return EXCHANGE_TO_MIC.NASDAQ;
    case 'NYSE':
      return EXCHANGE_TO_MIC.NYSE;
    default:
      return null;
  }
}

function instrumentForPosition(
  symbol: string,
  providerAssetClass: string,
  providerExchange: string,
): InstrumentMapping {
  if (providerAssetClass !== 'us_equity') {
    return Object.freeze({ instrument: null, missingReason: 'missing_instrument' });
  }
  const mic = micForExchange(providerExchange);
  if (mic === null) {
    return Object.freeze({ instrument: null, missingReason: 'unsupported_venue' });
  }
  try {
    return Object.freeze({
      instrument: createInstrumentId(symbol, mic),
      missingReason: 'missing_instrument',
    });
  } catch {
    return Object.freeze({ instrument: null, missingReason: 'missing_instrument' });
  }
}

function holdingSupport(
  providerAssetClass: string,
  currency: string,
  instrument: InstrumentId | null,
  missingReason: 'missing_instrument' | 'unsupported_venue',
): PortfolioHoldingSupport {
  if (providerAssetClass !== 'us_equity') {
    return Object.freeze({ state: 'unsupported', reason: 'unsupported_asset_class' });
  }
  if (currency !== 'USD') {
    return Object.freeze({ state: 'unsupported', reason: 'unsupported_currency' });
  }
  if (instrument === null) return Object.freeze({ state: 'unsupported', reason: missingReason });
  return Object.freeze({ state: 'supported', reason: null });
}

function orderState(providerStatus: string): PortfolioOrderState {
  if (OPEN_ORDER_STATUSES.has(providerStatus)) return 'open';
  if (TERMINAL_ORDER_STATUSES.has(providerStatus)) return 'terminal';
  if (providerStatus === 'calculated') return 'unknown';
  throw malformed('ALPACA_ORDER_STATUS_UNSUPPORTED');
}

function enumValue(value: string, supported: ReadonlySet<string>, code: string): string {
  if (!supported.has(value)) throw malformed(code);
  return value;
}

function normalizeAccount(response: AlpacaRawResponse<unknown>): {
  readonly accountFingerprint: ReturnType<typeof sourceFingerprint>;
  readonly currency: string;
  readonly observation: ReturnType<typeof createPortfolioAccountObservation>;
} {
  const payload = record(response.payload);
  const accountFingerprint = sourceFingerprint('account', payload.id);
  const currency = requiredText(payload, 'currency');
  const observation = createPortfolioAccountObservation({
    accountFingerprint,
    sourceRequestFingerprint: requestFingerprint(response.metadata),
    observedAt: response.metadata.receivedAt,
    status: requiredText(payload, 'status'),
    currency,
    createdAt: requiredText(payload, 'created_at'),
    cash: decimal(payload, 'cash'),
    equity: decimal(payload, 'equity'),
    lastEquity: decimal(payload, 'last_equity'),
    portfolioValue: decimal(payload, 'portfolio_value'),
    longMarketValue: decimal(payload, 'long_market_value'),
    shortMarketValue: decimal(payload, 'short_market_value'),
    buyingPower: nullableDecimal(payload, 'buying_power'),
    nonMarginableBuyingPower: nullableDecimal(payload, 'non_marginable_buying_power'),
    regtBuyingPower: nullableDecimal(payload, 'regt_buying_power'),
    initialMargin: nullableDecimal(payload, 'initial_margin'),
    maintenanceMargin: nullableDecimal(payload, 'maintenance_margin'),
    lastMaintenanceMargin: nullableDecimal(payload, 'last_maintenance_margin'),
    accruedFees: nullableDecimal(payload, 'accrued_fees'),
    pendingTransferIn: nullableDecimal(payload, 'pending_transfer_in'),
    pendingTransferOut: nullableDecimal(payload, 'pending_transfer_out'),
    multiplier: nullableDecimal(payload, 'multiplier'),
    tradingBlocked: boolean(payload, 'trading_blocked'),
    transfersBlocked: boolean(payload, 'transfers_blocked'),
    accountBlocked: boolean(payload, 'account_blocked'),
    tradeSuspendedByUser: boolean(payload, 'trade_suspended_by_user'),
    shortingEnabled: boolean(payload, 'shorting_enabled'),
  });
  return Object.freeze({ accountFingerprint, currency, observation });
}

interface NormalizedPosition {
  readonly rawAssetId: string;
  readonly observation: PortfolioPositionObservation;
}

function normalizePosition(
  payload: unknown,
  metadata: AlpacaResponseMetadata,
  accountFingerprint: ReturnType<typeof sourceFingerprint>,
  accountCurrency: string,
): NormalizedPosition {
  const source = record(payload);
  const rawAssetId = requiredText(source, 'asset_id');
  const symbol = requiredText(source, 'symbol');
  const providerAssetClass = requiredText(source, 'asset_class');
  const providerExchange = providerText(source.exchange, true);
  const instrumentMapping = instrumentForPosition(symbol, providerAssetClass, providerExchange);
  const observation = createPortfolioPositionObservation({
    accountFingerprint,
    sourceRequestFingerprint: requestFingerprint(metadata),
    observedAt: metadata.receivedAt,
    assetFingerprint: sourceFingerprint('asset', rawAssetId),
    symbol,
    instrument: instrumentMapping.instrument,
    providerAssetClass,
    providerExchange,
    currency: accountCurrency,
    side: requiredText(source, 'side'),
    quantity: decimal(source, 'qty'),
    quantityAvailable: nullableDecimal(source, 'qty_available'),
    averageEntryPrice: nullableDecimal(source, 'avg_entry_price'),
    currentPrice: nullableDecimal(source, 'current_price'),
    marketValue: nullableDecimal(source, 'market_value'),
    costBasis: nullableDecimal(source, 'cost_basis'),
    providerUnrealizedProfitLoss: nullableDecimal(source, 'unrealized_pl'),
    providerUnrealizedProfitLossPercent: nullableDecimal(source, 'unrealized_plpc'),
    unrealizedIntradayProfitLoss: nullableDecimal(source, 'unrealized_intraday_pl'),
    unrealizedIntradayProfitLossPercent: nullableDecimal(source, 'unrealized_intraday_plpc'),
    lastDayPrice: nullableDecimal(source, 'lastday_price'),
    changeToday: nullableDecimal(source, 'change_today'),
    assetMarginable: boolean(source, 'asset_marginable'),
    support: holdingSupport(
      providerAssetClass,
      accountCurrency,
      instrumentMapping.instrument,
      instrumentMapping.missingReason,
    ),
  });
  return Object.freeze({ rawAssetId, observation });
}

interface RawOrder {
  readonly metadata: AlpacaResponseMetadata;
  readonly payload: JsonRecord;
}

function flattenOrders(capture: AlpacaRawCapture): readonly RawOrder[] {
  const orders: RawOrder[] = [];
  for (const page of capture.orders) {
    for (const item of page.payload) {
      const parent = record(item);
      orders.push(Object.freeze({ metadata: page.metadata, payload: parent }));
      const legs = parent.legs;
      if (legs === null) continue;
      if (!Array.isArray(legs) || legs.length > MAX_ORDER_LEGS) {
        throw malformed('ALPACA_ORDER_LEGS_INVALID');
      }
      for (const leg of legs) {
        const child = record(leg);
        if (
          child.legs !== null &&
          child.legs !== undefined &&
          !(Array.isArray(child.legs) && child.legs.length === 0)
        ) {
          throw malformed('ALPACA_ORDER_LEGS_NESTED');
        }
        orders.push(Object.freeze({ metadata: page.metadata, payload: child }));
      }
    }
  }
  return Object.freeze(orders);
}

interface NormalizedOrder {
  readonly rawOrderId: string;
  readonly observation: PortfolioOrderObservation;
}

function normalizeOrder(
  source: JsonRecord,
  metadata: AlpacaResponseMetadata,
  accountFingerprint: ReturnType<typeof sourceFingerprint>,
  accountCurrency: string,
  positionsByAsset: ReadonlyMap<string, PortfolioPositionObservation>,
): NormalizedOrder {
  const rawOrderId = requiredText(source, 'id');
  const rawAssetId = nullableText(source, 'asset_id');
  const symbol = requiredText(source, 'symbol');
  const providerAssetClass = requiredText(source, 'asset_class');
  const linkedPosition = rawAssetId === null ? undefined : positionsByAsset.get(rawAssetId);
  if (
    linkedPosition !== undefined &&
    (linkedPosition.symbol !== symbol || linkedPosition.providerAssetClass !== providerAssetClass)
  ) {
    throw malformed('ALPACA_ORDER_ASSET_INCONSISTENT');
  }
  const instrument = linkedPosition?.instrument ?? null;
  const providerStatus = requiredText(source, 'status');
  const state = orderState(providerStatus);
  const orderType = enumValue(
    requiredText(source, 'type'),
    ORDER_TYPES,
    'ALPACA_ORDER_TYPE_UNSUPPORTED',
  );
  const orderClass = nullableText(source, 'order_class', true);
  if (orderClass !== null) {
    enumValue(orderClass, ORDER_CLASSES, 'ALPACA_ORDER_CLASS_UNSUPPORTED');
  }
  const positionIntent = nullableText(source, 'position_intent', true);
  if (positionIntent !== null && positionIntent !== '') {
    enumValue(positionIntent, POSITION_INTENTS, 'ALPACA_POSITION_INTENT_UNSUPPORTED');
  }
  const timeInForce = enumValue(
    requiredText(source, 'time_in_force'),
    TIME_IN_FORCE_VALUES,
    'ALPACA_TIME_IN_FORCE_UNSUPPORTED',
  );
  const quantity = nullableDecimal(source, 'qty');
  const notional = nullableDecimal(source, 'notional');
  const filledQuantity = decimal(source, 'filled_qty');
  if (quantity !== null && comparePortfolioDecimals(filledQuantity, quantity) > 0) {
    throw malformed('ALPACA_ORDER_QUANTITY_INCONSISTENT');
  }
  const filledAveragePrice = nullableDecimal(source, 'filled_avg_price');
  const filledAt = nullableText(source, 'filled_at');
  if (
    providerStatus === 'partially_filled' &&
    (comparePortfolioDecimals(filledQuantity, ZERO) <= 0 ||
      (quantity !== null && comparePortfolioDecimals(filledQuantity, quantity) >= 0))
  ) {
    throw malformed('ALPACA_ORDER_PARTIAL_FILL_INCONSISTENT');
  }
  if (
    providerStatus === 'filled' &&
    (comparePortfolioDecimals(filledQuantity, ZERO) <= 0 ||
      filledAveragePrice === null ||
      filledAt === null)
  ) {
    throw malformed('ALPACA_ORDER_FILL_INCONSISTENT');
  }
  const observation = createPortfolioOrderObservation({
    accountFingerprint,
    sourceRequestFingerprint: requestFingerprint(metadata),
    observedAt: metadata.receivedAt,
    orderFingerprint: sourceFingerprint('order', rawOrderId),
    clientOrderFingerprint: sourceFingerprint(
      'client_order',
      requiredText(source, 'client_order_id'),
    ),
    assetFingerprint: nullableSourceFingerprint('asset', rawAssetId),
    symbol,
    instrument,
    providerAssetClass,
    support:
      linkedPosition?.support ??
      holdingSupport(providerAssetClass, accountCurrency, instrument, 'missing_instrument'),
    side: requiredText(source, 'side'),
    orderType,
    orderClass,
    positionIntent,
    timeInForce,
    providerStatus,
    state,
    extendedHours: boolean(source, 'extended_hours'),
    quantity,
    notional,
    filledQuantity,
    filledAveragePrice,
    limitPrice: nullableDecimal(source, 'limit_price'),
    stopPrice: nullableDecimal(source, 'stop_price'),
    commission: nullableDecimal(source, 'commission'),
    trailPercent: nullableDecimal(source, 'trail_percent'),
    trailPrice: nullableDecimal(source, 'trail_price'),
    highWaterMark: nullableDecimal(source, 'hwm'),
    replacedByFingerprint: nullableSourceFingerprint('order', source.replaced_by),
    replacesFingerprint: nullableSourceFingerprint('order', source.replaces),
    createdAt: requiredText(source, 'created_at'),
    updatedAt: nullableText(source, 'updated_at'),
    submittedAt: nullableText(source, 'submitted_at'),
    filledAt,
    canceledAt: nullableText(source, 'canceled_at'),
    failedAt: nullableText(source, 'failed_at'),
    replacedAt: nullableText(source, 'replaced_at'),
    expiredAt: nullableText(source, 'expired_at'),
  });
  return Object.freeze({ rawOrderId, observation });
}

function normalizeFill(
  payload: unknown,
  metadata: AlpacaResponseMetadata,
  accountFingerprint: ReturnType<typeof sourceFingerprint>,
  ordersById: ReadonlyMap<string, PortfolioOrderObservation>,
): PortfolioFillObservation {
  const source = record(payload);
  if (requiredText(source, 'activity_type') !== 'FILL') {
    throw malformed('ALPACA_ACTIVITY_TYPE_UNSUPPORTED');
  }
  const rawOrderId = requiredText(source, 'order_id');
  const linkedOrder = ordersById.get(rawOrderId);
  const symbol = requiredText(source, 'symbol');
  const side = requiredText(source, 'side');
  if (linkedOrder !== undefined && (linkedOrder.symbol !== symbol || linkedOrder.side !== side)) {
    throw malformed('ALPACA_FILL_ORDER_INCONSISTENT');
  }
  const type = requiredText(source, 'type');
  if (type !== 'fill' && type !== 'partial_fill') {
    throw malformed('ALPACA_FILL_TYPE_UNSUPPORTED');
  }
  const quantity = decimal(source, 'qty');
  const cumulativeQuantity = decimal(source, 'cum_qty');
  const leavesQuantity = decimal(source, 'leaves_qty');
  if (comparePortfolioDecimals(cumulativeQuantity, quantity) < 0) {
    throw malformed('ALPACA_FILL_QUANTITY_INCONSISTENT');
  }
  if (
    (type === 'fill' && comparePortfolioDecimals(leavesQuantity, ZERO) !== 0) ||
    (type === 'partial_fill' && comparePortfolioDecimals(leavesQuantity, ZERO) <= 0)
  ) {
    throw malformed('ALPACA_FILL_LEAVES_INCONSISTENT');
  }
  if (
    linkedOrder?.quantity !== null &&
    linkedOrder?.quantity !== undefined &&
    comparePortfolioDecimals(
      addPortfolioDecimals([cumulativeQuantity, leavesQuantity]),
      linkedOrder.quantity,
    ) !== 0
  ) {
    throw malformed('ALPACA_FILL_ORDER_QUANTITY_INCONSISTENT');
  }
  const explicitAssetId = source.asset_id;
  const assetFingerprint =
    explicitAssetId === undefined
      ? (linkedOrder?.assetFingerprint ?? null)
      : nullableSourceFingerprint('asset', explicitAssetId);
  // Alpaca selected this response by an unreturned activity `created_at`.
  // `transaction_time` is the separate execution fact and cannot validate the
  // provider-created query interval.
  return createPortfolioFillObservation({
    accountFingerprint,
    sourceRequestFingerprint: requestFingerprint(metadata),
    observedAt: metadata.receivedAt,
    fillFingerprint: sourceFingerprint('fill', source.id),
    orderFingerprint: sourceFingerprint('order', rawOrderId),
    assetFingerprint,
    symbol,
    instrument: linkedOrder?.instrument ?? null,
    side,
    type,
    quantity,
    price: decimal(source, 'price'),
    cumulativeQuantity,
    leavesQuantity,
    transactionAt: requiredText(source, 'transaction_time'),
  });
}

function allResponseMetadata(capture: AlpacaRawCapture): readonly AlpacaResponseMetadata[] {
  return Object.freeze([
    capture.account.metadata,
    capture.positions.metadata,
    ...capture.orders.map((page) => page.metadata),
    ...capture.fills.map((page) => page.metadata),
  ]);
}

/** Revalidates a complete private Alpaca capture into one application-owned snapshot. */
export function normalizeAlpacaCapture(capture: AlpacaRawCapture): PortfolioSyncSnapshot {
  try {
    const account = normalizeAccount(capture.account);
    const normalizedPositions = capture.positions.payload.map((payload) =>
      normalizePosition(
        payload,
        capture.positions.metadata,
        account.accountFingerprint,
        account.currency,
      ),
    );
    const positionsByAsset = new Map(
      normalizedPositions.map(({ rawAssetId, observation }) => [rawAssetId, observation]),
    );
    if (positionsByAsset.size !== normalizedPositions.length) {
      throw malformed('ALPACA_POSITION_DUPLICATED');
    }
    const normalizedOrders = flattenOrders(capture).map(({ metadata, payload }) =>
      normalizeOrder(
        payload,
        metadata,
        account.accountFingerprint,
        account.currency,
        positionsByAsset,
      ),
    );
    const ordersById = new Map(
      normalizedOrders.map(({ rawOrderId, observation }) => [rawOrderId, observation]),
    );
    if (ordersById.size !== normalizedOrders.length) {
      throw malformed('ALPACA_ORDER_DUPLICATED');
    }
    const fills = capture.fills.flatMap((page) =>
      page.payload.map((payload) =>
        normalizeFill(payload, page.metadata, account.accountFingerprint, ordersById),
      ),
    );
    return createPortfolioSyncSnapshot({
      captureStartedAt: capture.captureStartedAt,
      captureCompletedAt: capture.captureCompletedAt,
      activityBaselineOnly: capture.activityBaselineOnly,
      activityWindowStartedAt: capture.activityWindowStartedAt,
      activityCutoverAt: capture.activityCutoverAt,
      positionsComplete: true,
      ordersComplete: true,
      fillsComplete: true,
      sourceRequestFingerprints: allResponseMetadata(capture).map(requestFingerprint),
      account: account.observation,
      positions: normalizedPositions.map(({ observation }) => observation),
      orders: normalizedOrders.map(({ observation }) => observation),
      fills,
    });
  } catch (error) {
    if (error instanceof AlpacaPaperApiError) throw error;
    throw malformed('ALPACA_PAYLOAD_INVALID');
  }
}
