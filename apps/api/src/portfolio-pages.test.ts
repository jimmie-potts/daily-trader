import { describe, expect, it } from 'vitest';

import {
  PortfolioApiRepository,
  parsePortfolioApiPageRequest,
  type PortfolioQueryPort,
  type PortfolioQueryResult,
} from './portfolio.js';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

class FakeQueryPort implements PortfolioQueryPort {
  public readonly calls: QueryCall[] = [];

  public constructor(
    private readonly respond: (
      text: string,
      values: readonly unknown[] | undefined,
    ) => readonly Readonly<Record<string, unknown>>[],
  ) {}

  public query<Row extends Readonly<Record<string, unknown>>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PortfolioQueryResult<Row>> {
    this.calls.push({ text, values });
    return Promise.resolve({ rows: this.respond(text, values) as readonly Row[] });
  }
}

const SELECTION = {
  sync_run_id: 'portfolio-sync-internal',
  capture_completed_at: '2026-07-13 17:20:00+00',
} as const;

function pageDatabase(input: {
  readonly countTable: string;
  readonly pageTable: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly total?: string;
}): FakeQueryPort {
  return new FakeQueryPort((text) => {
    if (text.includes('FROM portfolio_worker_status AS worker')) return [SELECTION];
    if (text.includes(`FROM ${input.countTable}`) && text.includes('COUNT(*)')) {
      return [{ total_count: input.total ?? '3' }];
    }
    if (text.includes(`FROM ${input.pageTable}`)) return input.rows;
    throw new Error('unexpected query');
  });
}

function mlegParentOrderRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    symbol: null,
    venue: null,
    asset_class: null,
    supported_for_monitoring: false,
    unsupported_reason: 'unsupported_order_structure',
    side: null,
    position_intent: null,
    order_type: 'limit',
    time_in_force: 'day',
    order_class: 'mleg',
    status: 'new',
    quantity: '2',
    notional: null,
    filled_quantity: '0',
    filled_average_price: null,
    limit_price: '1.25',
    stop_price: null,
    trail_price: null,
    trail_percent: null,
    high_water_mark: null,
    commission: null,
    extended_hours: false,
    provider_created_at: '2026-07-13 17:10:00+00',
    provider_updated_at: null,
    provider_submitted_at: '2026-07-13 17:10:01+00',
    provider_filled_at: null,
    provider_canceled_at: null,
    provider_failed_at: null,
    provider_replaced_at: null,
    provider_expired_at: null,
    observed_at: '2026-07-13 17:19:59+00',
    ...overrides,
  };
}

describe('portfolio API pagination contract', () => {
  it('accepts only canonical bounded limit and offset parameters', () => {
    expect(parsePortfolioApiPageRequest({})).toEqual({ limit: 25, offset: 0 });
    expect(parsePortfolioApiPageRequest({ limit: '100', offset: '50000' })).toEqual({
      limit: 100,
      offset: 50_000,
    });
    for (const input of [
      null,
      [],
      { limit: '0' },
      { limit: '101' },
      { limit: '01' },
      { limit: ['1', '2'] },
      { offset: '-1' },
      { offset: '50001' },
      { cursor: 'internal' },
    ]) {
      expect(parsePortfolioApiPageRequest(input)).toBeNull();
    }
  });

  it('returns stable bounded positions with exact values and no internal identifiers', async () => {
    const database = pageDatabase({
      countTable: 'portfolio_position_observations',
      pageTable: 'portfolio_position_observations AS position',
      rows: [
        {
          provider_asset_id: 'provider-asset-secret',
          symbol: 'AAPL',
          venue: 'XNAS',
          provider_exchange: 'NASDAQ',
          asset_class: 'us_equity',
          currency: 'USD',
          side: 'long',
          quantity: '10.500000000000000001',
          quantity_available: '9.5',
          average_entry_price: '140.125',
          current_price: '150.25',
          market_value: '1577.62500000000000015025',
          cost_basis: '1471.3125',
          unrealized_profit_loss: '106.31250000000000015025',
          unrealized_profit_loss_percent: '0.072257',
          unrealized_intraday_profit_loss: '12.5',
          unrealized_intraday_profit_loss_percent: '0.008',
          last_day_price: '149',
          change_today: '0.008389',
          asset_marginable: true,
          supported_for_projection: true,
          unsupported_reason: null,
          observed_at: '2026-07-13 17:19:59+00',
          allocation_percent: '100',
          projection_state: 'complete',
          projection_incomplete_reason: null,
        },
      ],
    });

    const page = await new PortfolioApiRepository(database).readPositions({ limit: 1, offset: 1 });

    expect(page).toMatchObject({
      schemaVersion: 'daily-trader.portfolio.positions-page.v1',
      access: 'read_only',
      environment: 'paper',
      executionEnabled: false,
      snapshotAsOf: '2026-07-13T17:20:00.000Z',
      pagination: { limit: 1, offset: 1, returned: 1, total: 3, nextOffset: 2 },
      items: [
        {
          symbol: 'AAPL',
          venue: 'XNAS',
          quantity: '10.500000000000000001',
          marketValue: '1577.62500000000000015025',
          observedAt: '2026-07-13T17:19:59.000Z',
        },
      ],
    });
    expect(JSON.stringify(page)).not.toContain('provider-asset-secret');
    const pageQuery = database.calls.find(({ text }) => text.includes('LIMIT $2 OFFSET $3'));
    expect(pageQuery?.values).toEqual(['portfolio-sync-internal', 1, 1]);
    expect(pageQuery?.text).toContain(
      'ORDER BY position.symbol ASC, position.provider_asset_id ASC',
    );
  });

  it('returns safe observed order facts without broker or client-order identifiers', async () => {
    const database = pageDatabase({
      countTable: 'portfolio_order_observations',
      pageTable: 'portfolio_order_observations AS observed_order',
      total: '50000',
      rows: [
        {
          provider_order_id: 'provider-order-secret',
          client_order_id: 'client-order-secret',
          provider_asset_id: 'provider-asset-secret',
          symbol: 'SPY',
          venue: 'ARCX',
          asset_class: 'us_equity',
          supported_for_monitoring: true,
          unsupported_reason: null,
          side: 'sell',
          position_intent: 'sell_to_close',
          order_type: 'limit',
          time_in_force: 'day',
          order_class: '',
          status: 'filled',
          quantity: '2.5',
          notional: null,
          filled_quantity: '2.5',
          filled_average_price: '600.125',
          limit_price: '600',
          stop_price: null,
          trail_price: null,
          trail_percent: null,
          high_water_mark: null,
          commission: '0',
          extended_hours: false,
          provider_created_at: '2026-07-13 17:10:00+00',
          provider_updated_at: '2026-07-13 17:11:00+00',
          provider_submitted_at: '2026-07-13 17:10:01+00',
          provider_filled_at: '2026-07-13 17:11:00+00',
          provider_canceled_at: null,
          provider_failed_at: null,
          provider_replaced_at: null,
          provider_expired_at: null,
          observed_at: '2026-07-13 17:19:59+00',
        },
      ],
    });

    const page = await new PortfolioApiRepository(database).readOrders({
      limit: 1,
      offset: 49_999,
    });

    expect(page.schemaVersion).toBe('daily-trader.portfolio.orders-page.v2');
    expect(page.items[0]).toMatchObject({
      symbol: 'SPY',
      venue: 'ARCX',
      status: 'filled',
      providerPositionIntent: 'sell_to_close',
      quantity: '2.5',
      filledAveragePrice: '600.125',
      submittedAt: '2026-07-13T17:10:01.000Z',
    });
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('provider-order-secret');
    expect(serialized).not.toContain('client-order-secret');
    expect(serialized).not.toContain('provider-asset-secret');
    expect(serialized).not.toMatch(/"(?:submit|replace|cancel|approve|orderIntent)":/u);
    expect(page.pagination).toEqual({
      limit: 1,
      offset: 49_999,
      returned: 1,
      total: 50_000,
      nextOffset: null,
    });
    const pageQuery = database.calls.find(({ text }) => text.includes('LIMIT $2 OFFSET $3'));
    expect(pageQuery?.values).toEqual(['portfolio-sync-internal', 1, 49_999]);
  });

  it('exposes nullable mleg parent facts without deriving them from child legs', async () => {
    const database = pageDatabase({
      countTable: 'portfolio_order_observations',
      pageTable: 'portfolio_order_observations AS observed_order',
      total: '2',
      rows: [
        mlegParentOrderRow(),
        mlegParentOrderRow({
          symbol: 'AAPL260116C00200001',
          asset_class: 'us_option',
          side: 'buy',
          order_type: null,
          position_intent: 'buy_to_open',
        }),
      ],
    });

    const page = await new PortfolioApiRepository(database).readOrders({ limit: 2, offset: 0 });

    expect(page).toMatchObject({
      schemaVersion: 'daily-trader.portfolio.orders-page.v2',
      items: [
        {
          symbol: null,
          venue: null,
          assetClass: null,
          monitoringSupport: 'unsupported',
          unsupportedReason: 'unsupported_order_structure',
          side: null,
          orderType: 'limit',
          orderClass: 'mleg',
        },
        {
          symbol: 'AAPL260116C00200001',
          assetClass: 'us_option',
          side: 'buy',
          orderType: null,
          orderClass: 'mleg',
          monitoringSupport: 'unsupported',
          unsupportedReason: 'unsupported_order_structure',
        },
      ],
    });
  });

  it('returns safe fill facts in deterministic newest-first order without fill identifiers', async () => {
    const database = pageDatabase({
      countTable: 'portfolio_sync_fill_memberships',
      pageTable: 'portfolio_sync_fill_memberships AS membership',
      total: '50000',
      rows: [
        {
          fill_observation_id: 'database-fill-secret',
          provider_activity_id: 'provider-fill-secret',
          provider_order_id: 'provider-order-secret',
          symbol: 'AAPL',
          venue: 'XNAS',
          side: 'buy',
          fill_type: 'partial_fill',
          quantity: '0.125',
          price: '204.250000000000000001',
          cumulative_quantity: '0.125',
          leaves_quantity: '0.875',
          provider_transaction_at: '2026-07-13 17:15:00.123+00',
          observed_at: '2026-07-13 17:19:59+00',
        },
      ],
    });

    const page = await new PortfolioApiRepository(database).readFills({
      limit: 1,
      offset: 49_999,
    });

    expect(page.items).toEqual([
      {
        symbol: 'AAPL',
        venue: 'XNAS',
        side: 'buy',
        fillType: 'partial_fill',
        quantity: '0.125',
        price: '204.250000000000000001',
        cumulativeQuantity: '0.125',
        leavesQuantity: '0.875',
        transactionAt: '2026-07-13T17:15:00.123Z',
        observedAt: '2026-07-13T17:19:59.000Z',
      },
    ]);
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('database-fill-secret');
    expect(serialized).not.toContain('provider-fill-secret');
    expect(serialized).not.toContain('provider-order-secret');
    const pageQuery = database.calls.find(({ text }) => text.includes('LIMIT $2 OFFSET $3'));
    expect(page.pagination).toEqual({
      limit: 1,
      offset: 49_999,
      returned: 1,
      total: 50_000,
      nextOffset: null,
    });
    expect(pageQuery?.values).toEqual(['portfolio-sync-internal', 1, 49_999]);
    expect(pageQuery?.text).toContain(
      'ORDER BY fill.provider_transaction_at DESC, membership.ordinal ASC',
    );
  });

  it('returns a stable empty page when a valid offset is beyond the selected collection', async () => {
    const database = pageDatabase({
      countTable: 'portfolio_order_observations',
      pageTable: 'portfolio_order_observations AS observed_order',
      total: '3',
      rows: [],
    });

    const page = await new PortfolioApiRepository(database).readOrders({ limit: 10, offset: 25 });

    expect(page).toMatchObject({
      state: 'available',
      snapshotAsOf: '2026-07-13T17:20:00.000Z',
      pagination: { limit: 10, offset: 25, returned: 0, total: 3, nextOffset: null },
      items: [],
    });
  });

  it('returns an explicit empty page without issuing resource queries when no snapshot exists', async () => {
    const database = new FakeQueryPort((text) => {
      if (text.includes('FROM portfolio_worker_status AS worker')) {
        return [{ sync_run_id: null, capture_completed_at: null }];
      }
      throw new Error('resource query must not run');
    });

    const page = await new PortfolioApiRepository(database).readOrders({ limit: 10, offset: 25 });

    expect(page).toMatchObject({
      state: 'no_snapshot',
      snapshotAsOf: null,
      pagination: { limit: 10, offset: 25, returned: 0, total: 0, nextOffset: null },
      items: [],
    });
    expect(database.calls).toHaveLength(1);
  });
});
