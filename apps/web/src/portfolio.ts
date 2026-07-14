export interface PortfolioDashboardSnapshot {
  readonly schemaVersion: 'daily-trader.portfolio.api.v1';
  readonly access: 'read_only';
  readonly environment: 'paper';
  readonly executionEnabled: false;
  readonly valuationAuthority: 'alpaca_paper_broker_mark';
  readonly health: {
    readonly state: 'degraded' | 'fresh' | 'no_snapshot' | 'stale';
    readonly observedAt: string;
    readonly snapshotAsOf: string | null;
    readonly ageMilliseconds: number | null;
    readonly knowledgeStartAt: string | null;
    readonly knowledgeEndAt: string | null;
    readonly workerLifecycle:
      'degraded' | 'disabled' | 'failed' | 'running' | 'starting' | 'stopped' | 'stopping';
    readonly lastFailureCode: string | null;
    readonly reconciliation: 'converged' | 'drift' | 'unavailable' | null;
    readonly change: 'baseline' | 'changed' | 'unchanged' | null;
    readonly projection: 'complete' | 'incomplete' | null;
    readonly incompleteReason: string | null;
  };
  readonly account: null | {
    readonly currency: string;
    readonly cash: string;
    readonly equity: string;
    readonly buyingPower: string | null;
  };
  readonly metrics: null | {
    readonly currency: string;
    readonly dayProfitLoss: string;
    readonly unrealizedProfitLoss: string | null;
    readonly grossExposure: string | null;
    readonly netExposure: string | null;
    readonly grossExposurePercent: string | null;
    readonly netExposurePercent: string | null;
    readonly concentrationPercent: string | null;
  };
  readonly positions: readonly {
    readonly symbol: string;
    readonly venue: string | null;
    readonly providerExchange: string;
    readonly assetClass: string;
    readonly currency: string;
    readonly side: 'long' | 'short';
    readonly quantity: string;
    readonly quantityAvailable: string | null;
    readonly averageEntryPrice: string | null;
    readonly currentPrice: string | null;
    readonly marketValue: string | null;
    readonly costBasis: string | null;
    readonly unrealizedProfitLoss: string | null;
    readonly allocationPercent: string | null;
    readonly projectionSupport: 'supported' | 'unsupported';
    readonly unsupportedReason: string | null;
    readonly calculationState: 'complete' | 'incomplete' | 'unavailable';
    readonly calculationUnavailableReason: string | null;
    readonly markSource: 'broker_mark';
  }[];
  readonly observedOrders: {
    readonly count: number;
    readonly byStatus: Readonly<Record<string, number>>;
  };
  readonly observedFills: {
    readonly count: number;
    readonly selectionBasis: 'provider_created_at';
    readonly createdAfterExclusive: string | null;
    readonly createdBeforeExclusive: string | null;
    readonly latestTransactionAt: string | null;
    readonly initialBaseline: boolean | null;
  };
}

export type PortfolioDashboardResult =
  | { readonly state: 'available'; readonly snapshot: PortfolioDashboardSnapshot }
  | { readonly state: 'unavailable' };

export type PortfolioFetch = (
  input: string,
  init: Readonly<{ cache: 'no-store'; signal: AbortSignal }>,
) => Promise<Readonly<{ ok: boolean; json(): Promise<unknown> }>>;

type DashboardHealth = PortfolioDashboardSnapshot['health'];
type DashboardAccount = NonNullable<PortfolioDashboardSnapshot['account']>;
type DashboardMetrics = NonNullable<PortfolioDashboardSnapshot['metrics']>;
type DashboardPosition = PortfolioDashboardSnapshot['positions'][number];
type DashboardObservedOrders = PortfolioDashboardSnapshot['observedOrders'];
type DashboardObservedFills = PortfolioDashboardSnapshot['observedFills'];

const MAX_POSITIONS = 10_000;
const MAX_ORDER_STATUS_BUCKETS = 32;
const MAX_OBSERVATION_COUNT = 50_000;
const MAX_PROVIDER_TEXT_LENGTH = 127;
const MAX_REASON_TEXT_LENGTH = 512;
const MAX_DECIMAL_PRECISION = 48;
const MAX_DECIMAL_SCALE = 18;

const CANONICAL_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;
const UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SYMBOL = /^[A-Z0-9][A-Z0-9./-]{0,31}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const VENUE = /^[A-Z0-9]{4}$/u;
const FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

const HEALTH_STATES = ['degraded', 'fresh', 'no_snapshot', 'stale'] as const;
const WORKER_LIFECYCLES = [
  'degraded',
  'disabled',
  'failed',
  'running',
  'starting',
  'stopped',
  'stopping',
] as const;
const RECONCILIATION_STATES = ['converged', 'drift', 'unavailable'] as const;
const CHANGE_STATES = ['baseline', 'changed', 'unchanged'] as const;
const PROJECTION_STATES = ['complete', 'incomplete'] as const;
const POSITION_SIDES = ['long', 'short'] as const;
const PROJECTION_SUPPORT_STATES = ['supported', 'unsupported'] as const;
const CALCULATION_STATES = ['complete', 'incomplete', 'unavailable'] as const;
const HOLDING_SUPPORT_REASONS = [
  'missing_instrument',
  'unsupported_asset_class',
  'unsupported_currency',
  'unsupported_venue',
] as const;
const CALCULATION_REASON_CODES = [
  'arithmetic_failure',
  'missing_current_price',
  'missing_market_value',
  'missing_unrealized_profit_loss',
  'position_snapshot_incomplete',
  'side_market_value_mismatch',
  'unreconciled_input',
  'unsupported_account_currency',
  'unsupported_holding',
] as const;

const SNAPSHOT_KEYS = [
  'schemaVersion',
  'access',
  'environment',
  'executionEnabled',
  'valuationAuthority',
  'health',
  'account',
  'metrics',
  'positions',
  'observedOrders',
  'observedFills',
] as const;
const HEALTH_KEYS = [
  'state',
  'observedAt',
  'snapshotAsOf',
  'ageMilliseconds',
  'knowledgeStartAt',
  'knowledgeEndAt',
  'workerLifecycle',
  'lastFailureCode',
  'reconciliation',
  'change',
  'projection',
  'incompleteReason',
] as const;
const ACCOUNT_KEYS = ['currency', 'cash', 'equity', 'buyingPower'] as const;
const METRICS_KEYS = [
  'currency',
  'dayProfitLoss',
  'unrealizedProfitLoss',
  'grossExposure',
  'netExposure',
  'grossExposurePercent',
  'netExposurePercent',
  'concentrationPercent',
] as const;
const POSITION_KEYS = [
  'symbol',
  'venue',
  'providerExchange',
  'assetClass',
  'currency',
  'side',
  'quantity',
  'quantityAvailable',
  'averageEntryPrice',
  'currentPrice',
  'marketValue',
  'costBasis',
  'unrealizedProfitLoss',
  'allocationPercent',
  'projectionSupport',
  'unsupportedReason',
  'calculationState',
  'calculationUnavailableReason',
  'markSource',
] as const;
const OBSERVED_ORDER_KEYS = ['count', 'byStatus'] as const;
const OBSERVED_FILL_KEYS = [
  'count',
  'selectionBasis',
  'createdAfterExclusive',
  'createdBeforeExclusive',
  'latestTransactionAt',
  'initialBaseline',
] as const;

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(record) as unknown;
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(record).length !== 0 ||
    Object.keys(record).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(record, key))
  ) {
    return null;
  }
  return record;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] | null {
  return typeof value === 'string' && values.includes(value) ? value : null;
}

function isBoundedText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximum &&
    !CONTROL_CHARACTER.test(value)
  );
}

function isCanonicalDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || value === '-0' || !CANONICAL_DECIMAL.test(value)) return false;
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer = '', fraction = ''] = unsigned.split('.');
  const significantInteger = integer.replace(/^0+/u, '');
  const precision =
    significantInteger.length > 0
      ? significantInteger.length + fraction.length
      : fraction.replace(/^0+/u, '').length;
  return Math.max(precision, 1) <= MAX_DECIMAL_PRECISION && fraction.length <= MAX_DECIMAL_SCALE;
}

function isNullableDecimal(value: unknown): value is string | null {
  return value === null || isCanonicalDecimal(value);
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_MILLISECONDS.test(value)) return false;
  const epochMilliseconds = Date.parse(value);
  return Number.isFinite(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === value;
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isUtcTimestamp(value);
}

function isNullableEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): boolean {
  return value === null || enumValue(value, values) !== null;
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_OBSERVATION_COUNT
  );
}

function isCalculationReason(value: unknown): value is string {
  if (!isBoundedText(value, MAX_REASON_TEXT_LENGTH)) return false;
  if (value === 'projection_unavailable') return true;
  const reasons = value.split(',');
  return (
    reasons.length > 0 &&
    reasons.every((reason) => enumValue(reason, CALCULATION_REASON_CODES) !== null)
  );
}

function decodeHealth(value: unknown): DashboardHealth | null {
  const record = exactRecord(value, HEALTH_KEYS);
  if (record === null) return null;
  const state = enumValue(record.state, HEALTH_STATES);
  const workerLifecycle = enumValue(record.workerLifecycle, WORKER_LIFECYCLES);
  if (
    state === null ||
    !isUtcTimestamp(record.observedAt) ||
    !isNullableTimestamp(record.snapshotAsOf) ||
    !(
      record.ageMilliseconds === null ||
      (typeof record.ageMilliseconds === 'number' && Number.isSafeInteger(record.ageMilliseconds))
    ) ||
    !isNullableTimestamp(record.knowledgeStartAt) ||
    !isNullableTimestamp(record.knowledgeEndAt) ||
    workerLifecycle === null ||
    !(
      record.lastFailureCode === null ||
      (typeof record.lastFailureCode === 'string' && FAILURE_CODE.test(record.lastFailureCode))
    ) ||
    !isNullableEnum(record.reconciliation, RECONCILIATION_STATES) ||
    !isNullableEnum(record.change, CHANGE_STATES) ||
    !isNullableEnum(record.projection, PROJECTION_STATES) ||
    !(record.incompleteReason === null || isCalculationReason(record.incompleteReason))
  ) {
    return null;
  }
  return Object.freeze({
    state,
    observedAt: record.observedAt,
    snapshotAsOf: record.snapshotAsOf,
    ageMilliseconds: record.ageMilliseconds,
    knowledgeStartAt: record.knowledgeStartAt,
    knowledgeEndAt: record.knowledgeEndAt,
    workerLifecycle,
    lastFailureCode: record.lastFailureCode,
    reconciliation: record.reconciliation as DashboardHealth['reconciliation'],
    change: record.change as DashboardHealth['change'],
    projection: record.projection as DashboardHealth['projection'],
    incompleteReason: record.incompleteReason,
  });
}

function decodeAccount(value: unknown): DashboardAccount | null {
  const record = exactRecord(value, ACCOUNT_KEYS);
  if (
    record === null ||
    typeof record.currency !== 'string' ||
    !CURRENCY.test(record.currency) ||
    !isCanonicalDecimal(record.cash) ||
    !isCanonicalDecimal(record.equity) ||
    !isNullableDecimal(record.buyingPower)
  ) {
    return null;
  }
  return Object.freeze({
    currency: record.currency,
    cash: record.cash,
    equity: record.equity,
    buyingPower: record.buyingPower,
  });
}

function decodeMetrics(value: unknown): DashboardMetrics | null {
  const record = exactRecord(value, METRICS_KEYS);
  if (
    record === null ||
    typeof record.currency !== 'string' ||
    !CURRENCY.test(record.currency) ||
    !isCanonicalDecimal(record.dayProfitLoss) ||
    !isNullableDecimal(record.unrealizedProfitLoss) ||
    !isNullableDecimal(record.grossExposure) ||
    !isNullableDecimal(record.netExposure) ||
    !isNullableDecimal(record.grossExposurePercent) ||
    !isNullableDecimal(record.netExposurePercent) ||
    !isNullableDecimal(record.concentrationPercent)
  ) {
    return null;
  }
  return Object.freeze({
    currency: record.currency,
    dayProfitLoss: record.dayProfitLoss,
    unrealizedProfitLoss: record.unrealizedProfitLoss,
    grossExposure: record.grossExposure,
    netExposure: record.netExposure,
    grossExposurePercent: record.grossExposurePercent,
    netExposurePercent: record.netExposurePercent,
    concentrationPercent: record.concentrationPercent,
  });
}

function decodePosition(value: unknown): DashboardPosition | null {
  const record = exactRecord(value, POSITION_KEYS);
  const side = record === null ? null : enumValue(record.side, POSITION_SIDES);
  const projectionSupport =
    record === null ? null : enumValue(record.projectionSupport, PROJECTION_SUPPORT_STATES);
  const calculationState =
    record === null ? null : enumValue(record.calculationState, CALCULATION_STATES);
  const unsupportedReason =
    record === null || record.unsupportedReason === null
      ? null
      : enumValue(record.unsupportedReason, HOLDING_SUPPORT_REASONS);
  if (
    record === null ||
    typeof record.symbol !== 'string' ||
    !SYMBOL.test(record.symbol) ||
    !(record.venue === null || (typeof record.venue === 'string' && VENUE.test(record.venue))) ||
    !isBoundedText(record.providerExchange, MAX_PROVIDER_TEXT_LENGTH, true) ||
    typeof record.assetClass !== 'string' ||
    !IDENTIFIER.test(record.assetClass) ||
    typeof record.currency !== 'string' ||
    !CURRENCY.test(record.currency) ||
    side === null ||
    !isCanonicalDecimal(record.quantity) ||
    !isNullableDecimal(record.quantityAvailable) ||
    !isNullableDecimal(record.averageEntryPrice) ||
    !isNullableDecimal(record.currentPrice) ||
    !isNullableDecimal(record.marketValue) ||
    !isNullableDecimal(record.costBasis) ||
    !isNullableDecimal(record.unrealizedProfitLoss) ||
    !isNullableDecimal(record.allocationPercent) ||
    projectionSupport === null ||
    (record.unsupportedReason !== null && unsupportedReason === null) ||
    (projectionSupport === 'supported' && record.unsupportedReason !== null) ||
    (projectionSupport === 'unsupported' && unsupportedReason === null) ||
    calculationState === null ||
    !(
      record.calculationUnavailableReason === null ||
      isCalculationReason(record.calculationUnavailableReason)
    ) ||
    (calculationState === 'complete' && record.calculationUnavailableReason !== null) ||
    (calculationState !== 'complete' && record.calculationUnavailableReason === null) ||
    record.markSource !== 'broker_mark'
  ) {
    return null;
  }
  return Object.freeze({
    symbol: record.symbol,
    venue: record.venue,
    providerExchange: record.providerExchange,
    assetClass: record.assetClass,
    currency: record.currency,
    side,
    quantity: record.quantity,
    quantityAvailable: record.quantityAvailable,
    averageEntryPrice: record.averageEntryPrice,
    currentPrice: record.currentPrice,
    marketValue: record.marketValue,
    costBasis: record.costBasis,
    unrealizedProfitLoss: record.unrealizedProfitLoss,
    allocationPercent: record.allocationPercent,
    projectionSupport,
    unsupportedReason,
    calculationState,
    calculationUnavailableReason: record.calculationUnavailableReason,
    markSource: 'broker_mark',
  });
}

function decodePositions(value: unknown): readonly DashboardPosition[] | null {
  if (!Array.isArray(value) || value.length > MAX_POSITIONS) return null;
  const decoded: DashboardPosition[] = [];
  for (const candidate of value) {
    const position = decodePosition(candidate);
    if (position === null) return null;
    decoded.push(position);
  }
  return Object.freeze(decoded);
}

function decodeObservedOrders(value: unknown): DashboardObservedOrders | null {
  const record = exactRecord(value, OBSERVED_ORDER_KEYS);
  if (record === null || !isSafeCount(record.count)) return null;
  if (
    record.byStatus === null ||
    typeof record.byStatus !== 'object' ||
    Array.isArray(record.byStatus)
  ) {
    return null;
  }
  const statusRecord = record.byStatus as Record<string, unknown>;
  const statusPrototype = Object.getPrototypeOf(statusRecord) as unknown;
  const entries = Object.entries(statusRecord);
  if (
    (statusPrototype !== Object.prototype && statusPrototype !== null) ||
    Object.getOwnPropertySymbols(statusRecord).length !== 0 ||
    entries.length > MAX_ORDER_STATUS_BUCKETS
  ) {
    return null;
  }
  let total = 0;
  const decodedEntries: [string, number][] = [];
  for (const [status, count] of entries) {
    if (!IDENTIFIER.test(status) || !isSafeCount(count)) return null;
    total += count;
    if (!Number.isSafeInteger(total) || total > MAX_OBSERVATION_COUNT) return null;
    decodedEntries.push([status, count]);
  }
  if (total !== record.count) return null;
  return Object.freeze({
    count: record.count,
    byStatus: Object.freeze(Object.fromEntries(decodedEntries)),
  });
}

function decodeObservedFills(value: unknown): DashboardObservedFills | null {
  const record = exactRecord(value, OBSERVED_FILL_KEYS);
  if (
    record === null ||
    !isSafeCount(record.count) ||
    record.selectionBasis !== 'provider_created_at' ||
    !isNullableTimestamp(record.createdAfterExclusive) ||
    !isNullableTimestamp(record.createdBeforeExclusive) ||
    !isNullableTimestamp(record.latestTransactionAt) ||
    !(record.initialBaseline === null || typeof record.initialBaseline === 'boolean')
  ) {
    return null;
  }
  const hasNoCoverage =
    record.createdAfterExclusive === null &&
    record.createdBeforeExclusive === null &&
    record.initialBaseline === null;
  const hasCompleteCoverage =
    record.createdAfterExclusive !== null &&
    record.createdBeforeExclusive !== null &&
    typeof record.initialBaseline === 'boolean' &&
    Date.parse(record.createdAfterExclusive) < Date.parse(record.createdBeforeExclusive);
  if (
    (!hasNoCoverage && !hasCompleteCoverage) ||
    (record.count === 0) !== (record.latestTransactionAt === null)
  ) {
    return null;
  }
  return Object.freeze({
    count: record.count,
    selectionBasis: 'provider_created_at',
    createdAfterExclusive: record.createdAfterExclusive,
    createdBeforeExclusive: record.createdBeforeExclusive,
    latestTransactionAt: record.latestTransactionAt,
    initialBaseline: record.initialBaseline,
  });
}

/**
 * Decodes the versioned read model into an immutable application-owned value.
 * Unknown keys, unbounded collections, malformed nested values, and contradictory
 * cross-field state fail closed.
 */
export function decodePortfolioDashboardSnapshot(
  value: unknown,
): PortfolioDashboardSnapshot | null {
  const record = exactRecord(value, SNAPSHOT_KEYS);
  if (
    record === null ||
    record.schemaVersion !== 'daily-trader.portfolio.api.v1' ||
    record.access !== 'read_only' ||
    record.environment !== 'paper' ||
    record.executionEnabled !== false ||
    record.valuationAuthority !== 'alpaca_paper_broker_mark'
  ) {
    return null;
  }
  const health = decodeHealth(record.health);
  const account = record.account === null ? null : decodeAccount(record.account);
  const metrics = record.metrics === null ? null : decodeMetrics(record.metrics);
  const positions = decodePositions(record.positions);
  const observedOrders = decodeObservedOrders(record.observedOrders);
  const observedFills = decodeObservedFills(record.observedFills);
  if (
    health === null ||
    (record.account !== null && account === null) ||
    (record.metrics !== null && metrics === null) ||
    positions === null ||
    observedOrders === null ||
    observedFills === null
  ) {
    return null;
  }
  const hasSnapshotHealthEvidence =
    health.snapshotAsOf !== null ||
    health.ageMilliseconds !== null ||
    health.knowledgeStartAt !== null ||
    health.knowledgeEndAt !== null ||
    health.reconciliation !== null ||
    health.change !== null ||
    health.projection !== null ||
    health.incompleteReason !== null;
  const hasObservedOrderEvidence =
    observedOrders.count !== 0 || Object.keys(observedOrders.byStatus).length !== 0;
  const hasObservedFillEvidence =
    observedFills.count !== 0 ||
    observedFills.createdAfterExclusive !== null ||
    observedFills.createdBeforeExclusive !== null ||
    observedFills.latestTransactionAt !== null ||
    observedFills.initialBaseline !== null;
  const contradictsNoSnapshot =
    health.state === 'no_snapshot' &&
    (hasSnapshotHealthEvidence ||
      account !== null ||
      metrics !== null ||
      positions.length > 0 ||
      hasObservedOrderEvidence ||
      hasObservedFillEvidence);
  const missesCompleteProjectionMetrics =
    health.projection === 'complete' &&
    (metrics === null ||
      metrics.unrealizedProfitLoss === null ||
      metrics.grossExposure === null ||
      metrics.netExposure === null);
  const hasCurrencyMismatch =
    account !== null && metrics !== null && account.currency !== metrics.currency;
  if (contradictsNoSnapshot || missesCompleteProjectionMetrics || hasCurrencyMismatch) {
    return null;
  }
  return Object.freeze({
    schemaVersion: 'daily-trader.portfolio.api.v1',
    access: 'read_only',
    environment: 'paper',
    executionEnabled: false,
    valuationAuthority: 'alpaca_paper_broker_mark',
    health,
    account,
    metrics,
    positions,
    observedOrders,
    observedFills,
  });
}

/** Fetches the loopback read model and treats malformed or unavailable responses as unavailable. */
export async function loadPortfolioDashboard(input: {
  readonly apiBaseUrl: string;
  readonly fetcher?: PortfolioFetch;
}): Promise<PortfolioDashboardResult> {
  try {
    const fetcher: PortfolioFetch = input.fetcher ?? fetch;
    const response = await fetcher(`${input.apiBaseUrl}/v1/portfolio`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return Object.freeze({ state: 'unavailable' });
    const body = await response.json();
    const snapshot = decodePortfolioDashboardSnapshot(body);
    if (snapshot === null) return Object.freeze({ state: 'unavailable' });
    return Object.freeze({ state: 'available', snapshot });
  } catch {
    return Object.freeze({ state: 'unavailable' });
  }
}
