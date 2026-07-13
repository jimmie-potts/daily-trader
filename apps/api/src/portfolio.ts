import { createUtcTimestamp, type Clock, type UtcTimestamp } from '@daily-trader/domain';

export interface PortfolioQueryResult<Row extends Readonly<Record<string, unknown>>> {
  readonly rows: readonly Row[];
}

export interface PortfolioQueryPort {
  query<Row extends Readonly<Record<string, unknown>>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PortfolioQueryResult<Row>>;
}

interface CurrentRow extends Readonly<Record<string, unknown>> {
  readonly sync_run_id: string | null;
  readonly capture_completed_at: string | null;
  readonly knowledge_start_at: string | null;
  readonly knowledge_end_at: string | null;
  readonly activity_window_started_at: string | null;
  readonly activity_cutover_at: string | null;
  readonly activity_baseline_only: boolean | null;
  readonly account_fingerprint: string | null;
  readonly position_count: number | null;
  readonly order_count: number | null;
  readonly fill_count: number | null;
  readonly currency: string | null;
  readonly cash: string | null;
  readonly equity: string | null;
  readonly buying_power: string | null;
  readonly day_profit_loss: string | null;
  readonly unrealized_profit_loss: string | null;
  readonly gross_exposure: string | null;
  readonly net_exposure: string | null;
  readonly gross_exposure_percent: string | null;
  readonly net_exposure_percent: string | null;
  readonly concentration_percent: string | null;
  readonly projection_state: 'complete' | 'incomplete' | null;
  readonly incomplete_reason: string | null;
  readonly reconciliation_state: 'converged' | 'drift' | 'unavailable' | null;
  readonly change_state: 'baseline' | 'changed' | 'unchanged' | null;
  readonly worker_lifecycle: string;
  readonly worker_failure_code: string | null;
  readonly last_sync_started_at: string | null;
  readonly last_sync_completed_at: string | null;
}

interface PositionRow extends Readonly<Record<string, unknown>> {
  readonly provider_asset_id: string;
  readonly symbol: string;
  readonly venue: string | null;
  readonly provider_exchange: string;
  readonly asset_class: string;
  readonly currency: string;
  readonly side: 'long' | 'short';
  readonly quantity: string;
  readonly quantity_available: string | null;
  readonly average_entry_price: string | null;
  readonly current_price: string | null;
  readonly market_value: string | null;
  readonly cost_basis: string | null;
  readonly unrealized_profit_loss: string | null;
  readonly supported_for_projection: boolean;
  readonly unsupported_reason: string | null;
  readonly allocation_percent: string | null;
  readonly projection_state: 'complete' | 'incomplete' | null;
  readonly projection_incomplete_reason: string | null;
}

interface PositionPageRow extends PositionRow {
  readonly asset_marginable: boolean;
  readonly last_day_price: string | null;
  readonly change_today: string | null;
  readonly unrealized_profit_loss_percent: string | null;
  readonly unrealized_intraday_profit_loss: string | null;
  readonly unrealized_intraday_profit_loss_percent: string | null;
  readonly observed_at: string;
}

interface OrderPageRow extends Readonly<Record<string, unknown>> {
  readonly symbol: string;
  readonly venue: string | null;
  readonly asset_class: string;
  readonly supported_for_monitoring: boolean;
  readonly unsupported_reason: string | null;
  readonly side: string;
  readonly position_intent: string | null;
  readonly order_type: string;
  readonly time_in_force: string;
  readonly order_class: string | null;
  readonly status: string;
  readonly quantity: string | null;
  readonly notional: string | null;
  readonly filled_quantity: string;
  readonly filled_average_price: string | null;
  readonly limit_price: string | null;
  readonly stop_price: string | null;
  readonly trail_price: string | null;
  readonly trail_percent: string | null;
  readonly high_water_mark: string | null;
  readonly commission: string | null;
  readonly extended_hours: boolean;
  readonly provider_created_at: string;
  readonly provider_updated_at: string | null;
  readonly provider_submitted_at: string | null;
  readonly provider_filled_at: string | null;
  readonly provider_canceled_at: string | null;
  readonly provider_failed_at: string | null;
  readonly provider_replaced_at: string | null;
  readonly provider_expired_at: string | null;
  readonly observed_at: string;
}

interface FillPageRow extends Readonly<Record<string, unknown>> {
  readonly symbol: string;
  readonly venue: string | null;
  readonly side: 'buy' | 'sell';
  readonly fill_type: 'fill' | 'partial_fill';
  readonly quantity: string;
  readonly price: string;
  readonly cumulative_quantity: string;
  readonly leaves_quantity: string;
  readonly provider_transaction_at: string;
  readonly observed_at: string;
}

interface CurrentSelectionRow extends Readonly<Record<string, unknown>> {
  readonly sync_run_id: string | null;
  readonly capture_completed_at: string | null;
}

interface CountRow extends Readonly<Record<string, unknown>> {
  readonly total_count: string;
}

interface OrderStatusRow extends Readonly<Record<string, unknown>> {
  readonly status: string;
  readonly count: string;
}

interface FillSummaryRow extends Readonly<Record<string, unknown>> {
  readonly fill_count: string;
  readonly last_fill_at: string | null;
}

export interface PortfolioApiPosition {
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
}

export interface PortfolioApiPositionObservation extends PortfolioApiPosition {
  readonly assetMarginable: boolean;
  readonly lastDayPrice: string | null;
  readonly changeToday: string | null;
  readonly unrealizedProfitLossPercent: string | null;
  readonly unrealizedIntradayProfitLoss: string | null;
  readonly unrealizedIntradayProfitLossPercent: string | null;
  readonly observedAt: UtcTimestamp;
}

export interface PortfolioApiOrderObservation {
  readonly symbol: string;
  readonly venue: string | null;
  readonly assetClass: string;
  readonly monitoringSupport: 'supported' | 'unsupported';
  readonly unsupportedReason: string | null;
  readonly side: string;
  readonly providerPositionIntent: string | null;
  readonly orderType: string;
  readonly timeInForce: string;
  readonly orderClass: string | null;
  readonly status: string;
  readonly quantity: string | null;
  readonly notional: string | null;
  readonly filledQuantity: string;
  readonly filledAveragePrice: string | null;
  readonly limitPrice: string | null;
  readonly stopPrice: string | null;
  readonly trailPrice: string | null;
  readonly trailPercent: string | null;
  readonly highWaterMark: string | null;
  readonly commission: string | null;
  readonly extendedHours: boolean;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp | null;
  readonly submittedAt: UtcTimestamp | null;
  readonly filledAt: UtcTimestamp | null;
  readonly canceledAt: UtcTimestamp | null;
  readonly failedAt: UtcTimestamp | null;
  readonly replacedAt: UtcTimestamp | null;
  readonly expiredAt: UtcTimestamp | null;
  readonly observedAt: UtcTimestamp;
}

export interface PortfolioApiFillObservation {
  readonly symbol: string;
  readonly venue: string | null;
  readonly side: 'buy' | 'sell';
  readonly fillType: 'fill' | 'partial_fill';
  readonly quantity: string;
  readonly price: string;
  readonly cumulativeQuantity: string;
  readonly leavesQuantity: string;
  readonly transactionAt: UtcTimestamp;
  readonly observedAt: UtcTimestamp;
}

export const PORTFOLIO_PAGE_DEFAULT_LIMIT = 25;
export const PORTFOLIO_PAGE_MAX_LIMIT = 100;
export const PORTFOLIO_PAGE_MAX_OFFSET = 10_000;

export interface PortfolioApiPageRequest {
  readonly limit: number;
  readonly offset: number;
}

interface PortfolioApiPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
  readonly nextOffset: number | null;
}

interface PortfolioApiPage<SchemaVersion extends string, Item> {
  readonly schemaVersion: SchemaVersion;
  readonly access: 'read_only';
  readonly environment: 'paper';
  readonly executionEnabled: false;
  readonly state: 'available' | 'no_snapshot';
  readonly snapshotAsOf: UtcTimestamp | null;
  readonly pagination: PortfolioApiPagination;
  readonly items: readonly Item[];
}

export type PortfolioApiPositionsPage = PortfolioApiPage<
  'daily-trader.portfolio.positions-page.v1',
  PortfolioApiPositionObservation
>;

export type PortfolioApiOrdersPage = PortfolioApiPage<
  'daily-trader.portfolio.orders-page.v1',
  PortfolioApiOrderObservation
>;

export type PortfolioApiFillsPage = PortfolioApiPage<
  'daily-trader.portfolio.fills-page.v1',
  PortfolioApiFillObservation
>;

export interface PortfolioApiSnapshot {
  readonly schemaVersion: 'daily-trader.portfolio.api.v1';
  readonly access: 'read_only';
  readonly environment: 'paper';
  readonly executionEnabled: false;
  readonly valuationAuthority: 'alpaca_paper_broker_mark';
  readonly health: {
    readonly state: 'degraded' | 'fresh' | 'no_snapshot' | 'stale';
    readonly observedAt: UtcTimestamp;
    readonly snapshotAsOf: UtcTimestamp | null;
    readonly ageMilliseconds: number | null;
    readonly knowledgeStartAt: UtcTimestamp | null;
    readonly knowledgeEndAt: UtcTimestamp | null;
    readonly workerLifecycle: string;
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
  readonly positions: readonly PortfolioApiPosition[];
  readonly observedOrders: {
    readonly count: number;
    readonly byStatus: Readonly<Record<string, number>>;
  };
  readonly observedFills: {
    readonly count: number;
    readonly selectionBasis: 'provider_created_at';
    readonly createdAfterExclusive: UtcTimestamp | null;
    readonly createdBeforeExclusive: UtcTimestamp | null;
    readonly latestTransactionAt: UtcTimestamp | null;
    readonly initialBaseline: boolean | null;
  };
}

export interface PortfolioApiRepositorySnapshot {
  readonly current: CurrentRow;
  readonly positions: readonly PositionRow[];
  readonly orderStatuses: readonly OrderStatusRow[];
  readonly fills: FillSummaryRow;
}

const CURRENT_SQL = `
  SELECT
    current.sync_run_id,
    run.capture_completed_at::text,
    run.knowledge_start_at::text,
    run.knowledge_end_at::text,
    run.activity_window_started_at::text,
    run.activity_cutover_at::text,
    run.activity_baseline_only,
    run.account_fingerprint,
    run.position_count,
    run.order_count,
    run.fill_count,
    account.currency,
    account.cash::text,
    account.equity::text,
    account.buying_power::text,
    projection.day_profit_loss::text,
    projection.unrealized_profit_loss::text,
    projection.gross_exposure::text,
    projection.net_exposure::text,
    projection.gross_exposure_percent::text,
    projection.net_exposure_percent::text,
    projection.concentration_percent::text,
    projection.state AS projection_state,
    projection.incomplete_reason,
    reconciliation.integrity_state AS reconciliation_state,
    reconciliation.change_state,
    worker.lifecycle AS worker_lifecycle,
    worker.failure_code AS worker_failure_code,
    worker.last_sync_started_at::text,
    worker.last_sync_completed_at::text
  FROM portfolio_worker_status AS worker
  LEFT JOIN portfolio_current_snapshot AS current ON current.singleton
  LEFT JOIN portfolio_sync_runs AS run ON run.sync_run_id = current.sync_run_id
  LEFT JOIN portfolio_account_observations AS account ON account.sync_run_id = current.sync_run_id
  LEFT JOIN portfolio_projections AS projection ON projection.sync_run_id = current.sync_run_id
  LEFT JOIN portfolio_reconciliations AS reconciliation
    ON reconciliation.sync_run_id = current.sync_run_id
  WHERE worker.singleton
`;

const POSITIONS_SQL = `
  SELECT
    position.provider_asset_id,
    position.symbol,
    CASE
      WHEN position.instrument_id IS NULL THEN NULL
      ELSE split_part(position.instrument_id, ':', 1)
    END AS venue,
    position.provider_exchange,
    position.asset_class,
    position.currency,
    position.side,
    position.quantity::text,
    position.quantity_available::text,
    position.average_entry_price::text,
    position.current_price::text,
    position.market_value::text,
    position.cost_basis::text,
    position.unrealized_profit_loss::text,
    position.supported_for_projection,
    position.unsupported_reason,
    projection.allocation_percent::text,
    projection.projection_state,
    projection.incomplete_reason AS projection_incomplete_reason
  FROM portfolio_position_observations AS position
  LEFT JOIN portfolio_position_projections AS projection
    ON projection.sync_run_id = position.sync_run_id
   AND projection.provider_asset_id = position.provider_asset_id
  WHERE position.sync_run_id = $1
  ORDER BY position.symbol, position.provider_asset_id
`;

const CURRENT_SELECTION_SQL = `
  SELECT
    current.sync_run_id,
    run.capture_completed_at::text
  FROM portfolio_worker_status AS worker
  LEFT JOIN portfolio_current_snapshot AS current ON current.singleton
  LEFT JOIN portfolio_sync_runs AS run ON run.sync_run_id = current.sync_run_id
  WHERE worker.singleton
`;

const POSITION_COUNT_SQL = `
  SELECT COUNT(*)::text AS total_count
  FROM portfolio_position_observations
  WHERE sync_run_id = $1
`;

const POSITION_PAGE_SQL = `
  SELECT
    position.provider_asset_id,
    position.symbol,
    CASE
      WHEN position.instrument_id IS NULL THEN NULL
      ELSE split_part(position.instrument_id, ':', 1)
    END AS venue,
    position.provider_exchange,
    position.asset_class,
    position.currency,
    position.side,
    position.quantity::text,
    position.quantity_available::text,
    position.average_entry_price::text,
    position.current_price::text,
    position.market_value::text,
    position.cost_basis::text,
    position.unrealized_profit_loss::text,
    position.unrealized_profit_loss_percent::text,
    position.unrealized_intraday_profit_loss::text,
    position.unrealized_intraday_profit_loss_percent::text,
    position.last_day_price::text,
    position.change_today::text,
    position.asset_marginable,
    position.supported_for_projection,
    position.unsupported_reason,
    position.observed_at::text,
    projection.allocation_percent::text,
    projection.projection_state,
    projection.incomplete_reason AS projection_incomplete_reason
  FROM portfolio_position_observations AS position
  LEFT JOIN portfolio_position_projections AS projection
    ON projection.sync_run_id = position.sync_run_id
   AND projection.provider_asset_id = position.provider_asset_id
  WHERE position.sync_run_id = $1
  ORDER BY position.symbol ASC, position.provider_asset_id ASC
  LIMIT $2 OFFSET $3
`;

const ORDER_COUNT_SQL = `
  SELECT COUNT(*)::text AS total_count
  FROM portfolio_order_observations
  WHERE sync_run_id = $1
`;

const ORDER_PAGE_SQL = `
  SELECT
    observed_order.symbol,
    CASE
      WHEN observed_order.instrument_id IS NULL THEN NULL
      ELSE split_part(observed_order.instrument_id, ':', 1)
    END AS venue,
    observed_order.asset_class,
    observed_order.supported_for_monitoring,
    observed_order.unsupported_reason,
    observed_order.side,
    observed_order.position_intent,
    observed_order.order_type,
    observed_order.time_in_force,
    observed_order.order_class,
    observed_order.status,
    observed_order.quantity::text,
    observed_order.notional::text,
    observed_order.filled_quantity::text,
    observed_order.filled_average_price::text,
    observed_order.limit_price::text,
    observed_order.stop_price::text,
    observed_order.trail_price::text,
    observed_order.trail_percent::text,
    observed_order.high_water_mark::text,
    observed_order.commission::text,
    observed_order.extended_hours,
    observed_order.provider_created_at::text,
    observed_order.provider_updated_at::text,
    observed_order.provider_submitted_at::text,
    observed_order.provider_filled_at::text,
    observed_order.provider_canceled_at::text,
    observed_order.provider_failed_at::text,
    observed_order.provider_replaced_at::text,
    observed_order.provider_expired_at::text,
    observed_order.observed_at::text
  FROM portfolio_order_observations AS observed_order
  WHERE observed_order.sync_run_id = $1
  ORDER BY
    COALESCE(observed_order.provider_submitted_at, observed_order.provider_created_at) DESC,
    observed_order.provider_order_id ASC
  LIMIT $2 OFFSET $3
`;

const FILL_COUNT_SQL = `
  SELECT COUNT(*)::text AS total_count
  FROM portfolio_sync_fill_memberships
  WHERE sync_run_id = $1
`;

const FILL_PAGE_SQL = `
  SELECT
    fill.symbol,
    CASE
      WHEN fill.instrument_id IS NULL THEN NULL
      ELSE split_part(fill.instrument_id, ':', 1)
    END AS venue,
    fill.side,
    fill.fill_type,
    fill.quantity::text,
    fill.price::text,
    fill.cumulative_quantity::text,
    fill.leaves_quantity::text,
    fill.provider_transaction_at::text,
    fill.observed_at::text
  FROM portfolio_sync_fill_memberships AS membership
  INNER JOIN portfolio_fill_observations AS fill
    ON fill.fill_observation_id = membership.fill_observation_id
  WHERE membership.sync_run_id = $1
  ORDER BY fill.provider_transaction_at DESC, membership.ordinal ASC
  LIMIT $2 OFFSET $3
`;

const ORDER_STATUS_SQL = `
  SELECT status, COUNT(*)::text AS count
  FROM portfolio_order_observations
  WHERE sync_run_id = $1
  GROUP BY status
  ORDER BY status
`;

const FILL_SUMMARY_SQL = `
  SELECT COUNT(*)::text AS fill_count,
         MAX(fill.provider_transaction_at)::text AS last_fill_at
  FROM portfolio_sync_fill_memberships AS membership
  INNER JOIN portfolio_fill_observations AS fill
    ON fill.fill_observation_id = membership.fill_observation_id
  WHERE membership.sync_run_id = $1
`;

function rowCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError('invalid database count');
  return parsed;
}

function utc(value: string | null): UtcTimestamp | null {
  return value === null ? null : createUtcTimestamp(new Date(value).toISOString());
}

function requiredUtc(value: string): UtcTimestamp {
  const result = utc(value);
  if (result === null) throw new TypeError('required database timestamp is unavailable');
  return result;
}

function pageInteger(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

/** Parses only the fixed pagination surface supported by portfolio observation endpoints. */
export function parsePortfolioApiPageRequest(input: unknown): PortfolioApiPageRequest | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const record = input as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => key !== 'limit' && key !== 'offset')) return null;
  const limit = pageInteger(
    record.limit,
    PORTFOLIO_PAGE_DEFAULT_LIMIT,
    1,
    PORTFOLIO_PAGE_MAX_LIMIT,
  );
  const offset = pageInteger(record.offset, 0, 0, PORTFOLIO_PAGE_MAX_OFFSET);
  return limit === null || offset === null ? null : Object.freeze({ limit, offset });
}

function positionApiView(position: PositionRow): PortfolioApiPosition {
  return Object.freeze({
    symbol: position.symbol,
    venue: position.venue,
    providerExchange: position.provider_exchange,
    assetClass: position.asset_class,
    currency: position.currency,
    side: position.side,
    quantity: position.quantity,
    quantityAvailable: position.quantity_available,
    averageEntryPrice: position.average_entry_price,
    currentPrice: position.current_price,
    marketValue: position.market_value,
    costBasis: position.cost_basis,
    unrealizedProfitLoss: position.unrealized_profit_loss,
    allocationPercent: position.allocation_percent,
    projectionSupport: position.supported_for_projection ? 'supported' : 'unsupported',
    unsupportedReason: position.unsupported_reason,
    calculationState: position.projection_state ?? ('unavailable' as const),
    calculationUnavailableReason:
      position.projection_state === null
        ? 'projection_unavailable'
        : position.projection_incomplete_reason,
    markSource: 'broker_mark',
  });
}

function pageResponse<SchemaVersion extends string, Item>(input: {
  readonly schemaVersion: SchemaVersion;
  readonly snapshotAsOf: string | null;
  readonly request: PortfolioApiPageRequest;
  readonly total: number;
  readonly items: readonly Item[];
}): PortfolioApiPage<SchemaVersion, Item> {
  const snapshotAsOf = utc(input.snapshotAsOf);
  if (
    input.items.length > input.request.limit ||
    input.request.offset + input.items.length > input.total ||
    (input.request.offset < input.total && input.items.length === 0)
  ) {
    throw new TypeError('portfolio page membership is inconsistent');
  }
  const nextOffset =
    input.request.offset + input.items.length < input.total
      ? input.request.offset + input.items.length
      : null;
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    access: 'read_only',
    environment: 'paper',
    executionEnabled: false,
    state: snapshotAsOf === null ? 'no_snapshot' : 'available',
    snapshotAsOf,
    pagination: Object.freeze({
      limit: input.request.limit,
      offset: input.request.offset,
      returned: input.items.length,
      total: input.total,
      nextOffset,
    }),
    items: Object.freeze([...input.items]),
  });
}

export class PortfolioApiRepository {
  public constructor(private readonly database: PortfolioQueryPort) {}

  async #currentSelection(): Promise<CurrentSelectionRow> {
    const selection = (await this.database.query<CurrentSelectionRow>(CURRENT_SELECTION_SQL))
      .rows[0];
    if (selection === undefined) throw new Error('portfolio worker status is unavailable');
    if (selection.sync_run_id !== null && selection.capture_completed_at === null) {
      throw new Error('selected portfolio snapshot is incomplete');
    }
    return selection;
  }

  public async readPositions(request: PortfolioApiPageRequest): Promise<PortfolioApiPositionsPage> {
    const selection = await this.#currentSelection();
    if (selection.sync_run_id === null) {
      return pageResponse({
        schemaVersion: 'daily-trader.portfolio.positions-page.v1',
        snapshotAsOf: null,
        request,
        total: 0,
        items: [],
      });
    }
    const [countResult, pageResult] = await Promise.all([
      this.database.query<CountRow>(POSITION_COUNT_SQL, [selection.sync_run_id]),
      this.database.query<PositionPageRow>(POSITION_PAGE_SQL, [
        selection.sync_run_id,
        request.limit,
        request.offset,
      ]),
    ]);
    const count = countResult.rows[0];
    if (count === undefined) throw new Error('portfolio position count is unavailable');
    const items = pageResult.rows.map((position) =>
      Object.freeze({
        ...positionApiView(position),
        assetMarginable: position.asset_marginable,
        lastDayPrice: position.last_day_price,
        changeToday: position.change_today,
        unrealizedProfitLossPercent: position.unrealized_profit_loss_percent,
        unrealizedIntradayProfitLoss: position.unrealized_intraday_profit_loss,
        unrealizedIntradayProfitLossPercent: position.unrealized_intraday_profit_loss_percent,
        observedAt: requiredUtc(position.observed_at),
      }),
    );
    return pageResponse({
      schemaVersion: 'daily-trader.portfolio.positions-page.v1',
      snapshotAsOf: selection.capture_completed_at,
      request,
      total: rowCount(count.total_count),
      items,
    });
  }

  public async readOrders(request: PortfolioApiPageRequest): Promise<PortfolioApiOrdersPage> {
    const selection = await this.#currentSelection();
    if (selection.sync_run_id === null) {
      return pageResponse({
        schemaVersion: 'daily-trader.portfolio.orders-page.v1',
        snapshotAsOf: null,
        request,
        total: 0,
        items: [],
      });
    }
    const [countResult, pageResult] = await Promise.all([
      this.database.query<CountRow>(ORDER_COUNT_SQL, [selection.sync_run_id]),
      this.database.query<OrderPageRow>(ORDER_PAGE_SQL, [
        selection.sync_run_id,
        request.limit,
        request.offset,
      ]),
    ]);
    const count = countResult.rows[0];
    if (count === undefined) throw new Error('portfolio order count is unavailable');
    const items = pageResult.rows.map((order) =>
      Object.freeze({
        symbol: order.symbol,
        venue: order.venue,
        assetClass: order.asset_class,
        monitoringSupport: order.supported_for_monitoring ? 'supported' : 'unsupported',
        unsupportedReason: order.unsupported_reason,
        side: order.side,
        providerPositionIntent: order.position_intent,
        orderType: order.order_type,
        timeInForce: order.time_in_force,
        orderClass: order.order_class,
        status: order.status,
        quantity: order.quantity,
        notional: order.notional,
        filledQuantity: order.filled_quantity,
        filledAveragePrice: order.filled_average_price,
        limitPrice: order.limit_price,
        stopPrice: order.stop_price,
        trailPrice: order.trail_price,
        trailPercent: order.trail_percent,
        highWaterMark: order.high_water_mark,
        commission: order.commission,
        extendedHours: order.extended_hours,
        createdAt: requiredUtc(order.provider_created_at),
        updatedAt: utc(order.provider_updated_at),
        submittedAt: utc(order.provider_submitted_at),
        filledAt: utc(order.provider_filled_at),
        canceledAt: utc(order.provider_canceled_at),
        failedAt: utc(order.provider_failed_at),
        replacedAt: utc(order.provider_replaced_at),
        expiredAt: utc(order.provider_expired_at),
        observedAt: requiredUtc(order.observed_at),
      }),
    );
    return pageResponse({
      schemaVersion: 'daily-trader.portfolio.orders-page.v1',
      snapshotAsOf: selection.capture_completed_at,
      request,
      total: rowCount(count.total_count),
      items,
    });
  }

  public async readFills(request: PortfolioApiPageRequest): Promise<PortfolioApiFillsPage> {
    const selection = await this.#currentSelection();
    if (selection.sync_run_id === null) {
      return pageResponse({
        schemaVersion: 'daily-trader.portfolio.fills-page.v1',
        snapshotAsOf: null,
        request,
        total: 0,
        items: [],
      });
    }
    const [countResult, pageResult] = await Promise.all([
      this.database.query<CountRow>(FILL_COUNT_SQL, [selection.sync_run_id]),
      this.database.query<FillPageRow>(FILL_PAGE_SQL, [
        selection.sync_run_id,
        request.limit,
        request.offset,
      ]),
    ]);
    const count = countResult.rows[0];
    if (count === undefined) throw new Error('portfolio fill count is unavailable');
    const items = pageResult.rows.map((fill) =>
      Object.freeze({
        symbol: fill.symbol,
        venue: fill.venue,
        side: fill.side,
        fillType: fill.fill_type,
        quantity: fill.quantity,
        price: fill.price,
        cumulativeQuantity: fill.cumulative_quantity,
        leavesQuantity: fill.leaves_quantity,
        transactionAt: requiredUtc(fill.provider_transaction_at),
        observedAt: requiredUtc(fill.observed_at),
      }),
    );
    return pageResponse({
      schemaVersion: 'daily-trader.portfolio.fills-page.v1',
      snapshotAsOf: selection.capture_completed_at,
      request,
      total: rowCount(count.total_count),
      items,
    });
  }

  public async read(): Promise<PortfolioApiRepositorySnapshot> {
    const current = (await this.database.query<CurrentRow>(CURRENT_SQL)).rows[0];
    if (current === undefined) throw new Error('portfolio worker status is unavailable');
    if (current.sync_run_id === null || current.account_fingerprint === null) {
      return Object.freeze({
        current,
        positions: Object.freeze([]),
        orderStatuses: Object.freeze([]),
        fills: Object.freeze({ fill_count: '0', last_fill_at: null }),
      });
    }

    const [positions, orderStatuses, fills] = await Promise.all([
      this.database.query<PositionRow>(POSITIONS_SQL, [current.sync_run_id]),
      this.database.query<OrderStatusRow>(ORDER_STATUS_SQL, [current.sync_run_id]),
      this.database.query<FillSummaryRow>(FILL_SUMMARY_SQL, [current.sync_run_id]),
    ]);
    const fillRow = fills.rows[0];
    if (fillRow === undefined) throw new Error('portfolio fill summary is unavailable');
    return Object.freeze({
      current,
      positions: Object.freeze([...positions.rows]),
      orderStatuses: Object.freeze([...orderStatuses.rows]),
      fills: fillRow,
    });
  }
}

export function buildPortfolioApiSnapshot(input: {
  readonly repository: PortfolioApiRepositorySnapshot;
  readonly clock: Clock;
  readonly staleAfterMs: number;
}): PortfolioApiSnapshot {
  const observedAt = createUtcTimestamp(input.clock.now());
  const current = input.repository.current;
  const snapshotAsOf = utc(current.capture_completed_at);
  const knowledgeStartAt = utc(current.knowledge_start_at);
  const knowledgeEndAt = utc(current.knowledge_end_at);
  const activityWindowStartedAt = utc(current.activity_window_started_at);
  const activityCutoverAt = utc(current.activity_cutover_at);
  const ageMilliseconds =
    snapshotAsOf === null ? null : Date.parse(observedAt) - Date.parse(snapshotAsOf);
  const observedOrderCount = input.repository.orderStatuses.reduce(
    (total, row) => total + rowCount(row.count),
    0,
  );
  const observedFillCount = rowCount(input.repository.fills.fill_count);
  const failedAfterSnapshot =
    current.worker_failure_code !== null &&
    (snapshotAsOf === null ||
      (utc(current.last_sync_started_at) !== null &&
        Date.parse(utc(current.last_sync_started_at) as UtcTimestamp) > Date.parse(snapshotAsOf)));
  const reconciliationUnhealthy =
    snapshotAsOf !== null && current.reconciliation_state !== 'converged';
  const projectionUnhealthy = snapshotAsOf !== null && current.projection_state !== 'complete';
  const workerUnhealthy = current.worker_lifecycle !== 'running';
  const membershipUnhealthy =
    snapshotAsOf !== null &&
    (current.position_count === null ||
      current.position_count !== input.repository.positions.length ||
      current.order_count === null ||
      current.order_count !== observedOrderCount ||
      current.fill_count === null ||
      current.fill_count !== observedFillCount);
  const accountUnhealthy =
    snapshotAsOf !== null &&
    (current.currency === null || current.cash === null || current.equity === null);
  const knowledgeUnhealthy =
    snapshotAsOf !== null && (knowledgeStartAt === null || knowledgeEndAt === null);
  const fillCoverageUnhealthy =
    snapshotAsOf !== null &&
    (activityWindowStartedAt === null ||
      activityCutoverAt === null ||
      current.activity_baseline_only === null ||
      activityWindowStartedAt > activityCutoverAt ||
      (knowledgeStartAt !== null && activityCutoverAt < knowledgeStartAt) ||
      (knowledgeEndAt !== null && activityCutoverAt > knowledgeEndAt));
  const state =
    snapshotAsOf === null
      ? 'no_snapshot'
      : failedAfterSnapshot ||
          reconciliationUnhealthy ||
          projectionUnhealthy ||
          workerUnhealthy ||
          membershipUnhealthy ||
          accountUnhealthy ||
          knowledgeUnhealthy ||
          fillCoverageUnhealthy
        ? 'degraded'
        : ageMilliseconds !== null && (ageMilliseconds < 0 || ageMilliseconds > input.staleAfterMs)
          ? 'stale'
          : 'fresh';

  const positions = input.repository.positions.map((position) =>
    Object.freeze({
      symbol: position.symbol,
      venue: position.venue,
      providerExchange: position.provider_exchange,
      assetClass: position.asset_class,
      currency: position.currency,
      side: position.side,
      quantity: position.quantity,
      quantityAvailable: position.quantity_available,
      averageEntryPrice: position.average_entry_price,
      currentPrice: position.current_price,
      marketValue: position.market_value,
      costBasis: position.cost_basis,
      unrealizedProfitLoss: position.unrealized_profit_loss,
      allocationPercent: position.allocation_percent,
      projectionSupport: position.supported_for_projection ? 'supported' : 'unsupported',
      unsupportedReason: position.unsupported_reason,
      calculationState: position.projection_state ?? ('unavailable' as const),
      calculationUnavailableReason:
        position.projection_state === null
          ? 'projection_unavailable'
          : position.projection_incomplete_reason,
      markSource: 'broker_mark' as const,
    }),
  );
  const byStatus = Object.freeze(
    Object.fromEntries(
      input.repository.orderStatuses.map((row) => [row.status, rowCount(row.count)]),
    ),
  );

  return Object.freeze({
    schemaVersion: 'daily-trader.portfolio.api.v1',
    access: 'read_only',
    environment: 'paper',
    executionEnabled: false,
    valuationAuthority: 'alpaca_paper_broker_mark',
    health: Object.freeze({
      state,
      observedAt,
      snapshotAsOf,
      ageMilliseconds,
      knowledgeStartAt,
      knowledgeEndAt,
      workerLifecycle: current.worker_lifecycle,
      lastFailureCode: current.worker_failure_code,
      reconciliation: current.reconciliation_state,
      change: current.change_state,
      projection: current.projection_state,
      incompleteReason: current.incomplete_reason,
    }),
    account:
      current.currency === null || current.cash === null || current.equity === null
        ? null
        : Object.freeze({
            currency: current.currency,
            cash: current.cash,
            equity: current.equity,
            buyingPower: current.buying_power,
          }),
    metrics:
      current.day_profit_loss === null || current.currency === null
        ? null
        : Object.freeze({
            currency: current.currency,
            dayProfitLoss: current.day_profit_loss,
            unrealizedProfitLoss: current.unrealized_profit_loss,
            grossExposure: current.gross_exposure,
            netExposure: current.net_exposure,
            grossExposurePercent: current.gross_exposure_percent,
            netExposurePercent: current.net_exposure_percent,
            concentrationPercent: current.concentration_percent,
          }),
    positions: Object.freeze(positions),
    observedOrders: Object.freeze({
      count: observedOrderCount,
      byStatus,
    }),
    observedFills: Object.freeze({
      count: observedFillCount,
      selectionBasis: 'provider_created_at',
      createdAfterExclusive: activityWindowStartedAt,
      createdBeforeExclusive: activityCutoverAt,
      latestTransactionAt: utc(input.repository.fills.last_fill_at),
      initialBaseline: current.activity_baseline_only,
    }),
  });
}
