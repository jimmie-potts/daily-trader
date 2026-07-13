import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import { describe, expect, it } from 'vitest';

import {
  buildPortfolioApiSnapshot,
  PortfolioApiRepository,
  type PortfolioApiRepositorySnapshot,
  type PortfolioQueryPort,
} from './portfolio.js';

const CLOCK = new FixedClock(createUtcTimestamp('2026-07-13T17:20:30.000Z'));

function repositorySnapshot(
  overrides: Partial<PortfolioApiRepositorySnapshot['current']> = {},
): PortfolioApiRepositorySnapshot {
  return {
    current: {
      sync_run_id: 'portfolio-sync-fixture',
      capture_completed_at: '2026-07-13T17:20:00.000Z',
      knowledge_start_at: '2026-07-13T17:19:58.000Z',
      knowledge_end_at: '2026-07-13T17:20:00.000Z',
      activity_window_started_at: '2026-07-13T17:18:58.000Z',
      activity_cutover_at: '2026-07-13T17:19:58.000Z',
      activity_baseline_only: true,
      account_fingerprint: 'a'.repeat(64),
      position_count: 1,
      order_count: 1,
      fill_count: 1,
      currency: 'USD',
      cash: '1000',
      equity: '2500',
      buying_power: '2000',
      day_profit_loss: '25',
      unrealized_profit_loss: '100',
      gross_exposure: '1500',
      net_exposure: '1500',
      gross_exposure_percent: '60',
      net_exposure_percent: '60',
      concentration_percent: '100',
      projection_state: 'complete',
      incomplete_reason: null,
      reconciliation_state: 'converged',
      change_state: 'baseline',
      worker_lifecycle: 'running',
      worker_heartbeat_at: '2026-07-13T17:20:20.000Z',
      worker_lease_expires_at: '2026-07-13T17:21:20.000Z',
      worker_lease_current: true,
      worker_failure_code: null,
      last_sync_started_at: '2026-07-13T17:19:58.000Z',
      last_sync_completed_at: '2026-07-13T17:20:00.000Z',
      ...overrides,
    },
    positions: [
      {
        provider_asset_id: 'b'.repeat(64),
        symbol: 'AAPL',
        venue: 'XNAS',
        provider_exchange: 'NASDAQ',
        asset_class: 'us_equity',
        currency: 'USD',
        side: 'long',
        quantity: '10',
        quantity_available: '9',
        average_entry_price: '140',
        current_price: '150',
        market_value: '1500',
        cost_basis: '1400',
        unrealized_profit_loss: '100',
        supported_for_projection: true,
        unsupported_reason: null,
        allocation_percent: '100',
        projection_state: 'complete',
        projection_incomplete_reason: null,
      },
    ],
    orderStatuses: [{ status: 'filled', count: '1' }],
    fills: { fill_count: '1', last_fill_at: '2026-07-13T17:19:30.000Z' },
  };
}

describe('portfolio API presentation', () => {
  it('returns exact text, freshness, and read-only paper labels without identifiers', () => {
    const result = buildPortfolioApiSnapshot({
      repository: repositorySnapshot(),
      clock: CLOCK,
      staleAfterMs: 90_000,
    });

    expect(result).toMatchObject({
      access: 'read_only',
      environment: 'paper',
      executionEnabled: false,
      schemaVersion: 'daily-trader.portfolio.api.v1',
      valuationAuthority: 'alpaca_paper_broker_mark',
      health: {
        state: 'fresh',
        ageMilliseconds: 30_000,
        reconciliation: 'converged',
        change: 'baseline',
        projection: 'complete',
      },
      account: { currency: 'USD', cash: '1000', equity: '2500' },
      metrics: { unrealizedProfitLoss: '100', grossExposurePercent: '60' },
      positions: [
        {
          symbol: 'AAPL',
          venue: 'XNAS',
          currency: 'USD',
          markSource: 'broker_mark',
          calculationState: 'complete',
          quantity: '10',
          allocationPercent: '100',
        },
      ],
      observedOrders: { count: 1, byStatus: { filled: 1 } },
      observedFills: {
        count: 1,
        selectionBasis: 'provider_created_at',
        createdAfterExclusive: '2026-07-13T17:18:58.000Z',
        createdBeforeExclusive: '2026-07-13T17:19:58.000Z',
        latestTransactionAt: '2026-07-13T17:19:30.000Z',
        initialBaseline: true,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('portfolio-sync-fixture');
    expect(serialized).not.toContain('a'.repeat(64));
    expect(serialized).not.toContain('b'.repeat(64));
  });

  it('keeps unsupported holdings visible and suppresses incomplete aggregate metrics', () => {
    const source = repositorySnapshot({
      projection_state: 'incomplete',
      incomplete_reason: 'unsupported_asset_class',
      unrealized_profit_loss: null,
      gross_exposure: null,
      net_exposure: null,
      gross_exposure_percent: null,
      net_exposure_percent: null,
      concentration_percent: null,
    });
    const incomplete = {
      ...source,
      positions: [
        {
          ...source.positions[0]!,
          asset_class: 'crypto',
          supported_for_projection: false,
          unsupported_reason: 'unsupported_asset_class',
          allocation_percent: null,
          projection_state: 'incomplete',
          projection_incomplete_reason: 'unsupported_holding',
        },
      ],
    } satisfies PortfolioApiRepositorySnapshot;

    const result = buildPortfolioApiSnapshot({
      repository: incomplete,
      clock: CLOCK,
      staleAfterMs: 90_000,
    });

    expect(result.health).toMatchObject({
      state: 'degraded',
      projection: 'incomplete',
      incompleteReason: 'unsupported_asset_class',
    });
    expect(result.metrics).toMatchObject({
      unrealizedProfitLoss: null,
      grossExposure: null,
      concentrationPercent: null,
    });
    expect(result.positions[0]).toMatchObject({
      assetClass: 'crypto',
      projectionSupport: 'unsupported',
      unsupportedReason: 'unsupported_asset_class',
      calculationState: 'incomplete',
      calculationUnavailableReason: 'unsupported_holding',
    });
  });

  it('reports no snapshot and degrades a retained snapshot after a failed sync', () => {
    const missing = repositorySnapshot({
      sync_run_id: null,
      capture_completed_at: null,
      knowledge_start_at: null,
      knowledge_end_at: null,
      activity_window_started_at: null,
      activity_cutover_at: null,
      activity_baseline_only: null,
      account_fingerprint: null,
      currency: null,
      cash: null,
      equity: null,
      buying_power: null,
      day_profit_loss: null,
      projection_state: null,
      reconciliation_state: null,
    });
    const noSnapshot = {
      ...missing,
      positions: [],
      orderStatuses: [],
      fills: { fill_count: '0', last_fill_at: null },
    } satisfies PortfolioApiRepositorySnapshot;
    expect(
      buildPortfolioApiSnapshot({ repository: noSnapshot, clock: CLOCK, staleAfterMs: 90_000 })
        .health.state,
    ).toBe('no_snapshot');

    const failed = repositorySnapshot({
      worker_failure_code: 'provider_transport',
      last_sync_started_at: '2026-07-13T17:20:10.000Z',
    });
    expect(
      buildPortfolioApiSnapshot({ repository: failed, clock: CLOCK, staleAfterMs: 90_000 }).health
        .state,
    ).toBe('degraded');
  });

  it('degrades a retained snapshot when the database classifies its running lease as invalid', () => {
    for (const leaseEvidence of [
      {
        worker_heartbeat_at: '2026-07-13T17:20:20.000Z',
        worker_lease_expires_at: null,
      },
      {
        worker_heartbeat_at: '2026-07-13T17:20:20.000Z',
        worker_lease_expires_at: '2026-07-13T17:20:30.000Z',
      },
      {
        worker_heartbeat_at: '2026-07-13T17:20:31.000Z',
        worker_lease_expires_at: '2026-07-13T17:21:31.000Z',
      },
    ]) {
      const result = buildPortfolioApiSnapshot({
        repository: repositorySnapshot({
          ...leaseEvidence,
          worker_lease_current: false,
        }),
        clock: CLOCK,
        staleAfterMs: 90_000,
      });

      expect(result.health).toMatchObject({
        state: 'degraded',
        workerLifecycle: 'running',
      });
    }
  });

  it('uses one database-clock observation to classify lease expiry and future heartbeats', async () => {
    const source = repositorySnapshot({ worker_lease_current: false });
    let currentQuery = '';
    const database: PortfolioQueryPort = {
      query: <Row extends Readonly<Record<string, unknown>>>(text: string) => {
        if (text.includes('worker.lifecycle AS worker_lifecycle')) {
          currentQuery = text;
          return Promise.resolve({ rows: [source.current] as unknown as readonly Row[] });
        }
        if (text.includes('portfolio_position_observations AS position')) {
          return Promise.resolve({ rows: source.positions as unknown as readonly Row[] });
        }
        if (text.includes('GROUP BY status')) {
          return Promise.resolve({ rows: source.orderStatuses as unknown as readonly Row[] });
        }
        if (text.includes('MAX(fill.provider_transaction_at)')) {
          return Promise.resolve({ rows: [source.fills] as unknown as readonly Row[] });
        }
        throw new Error('unexpected query');
      },
    };

    const repository = await new PortfolioApiRepository(database).read();

    expect(currentQuery).toContain('WITH database_clock AS MATERIALIZED');
    expect(currentQuery).toContain('SELECT clock_timestamp() AS observed_at');
    expect(currentQuery).toContain('worker.heartbeat_at <= database_clock.observed_at');
    expect(currentQuery).toContain('worker.lease_expires_at > database_clock.observed_at');
    expect(repository.current.worker_lease_current).toBe(false);
  });

  it('degrades a selected snapshot when immutable projection membership is incomplete', () => {
    const missingPosition = repositorySnapshot({ position_count: 2 });
    const missingReconciliation = repositorySnapshot({ reconciliation_state: null });
    const missingFillCoverage = repositorySnapshot({ activity_window_started_at: null });

    expect(
      buildPortfolioApiSnapshot({
        repository: missingPosition,
        clock: CLOCK,
        staleAfterMs: 90_000,
      }).health.state,
    ).toBe('degraded');
    expect(
      buildPortfolioApiSnapshot({
        repository: missingReconciliation,
        clock: CLOCK,
        staleAfterMs: 90_000,
      }).health.state,
    ).toBe('degraded');
    expect(
      buildPortfolioApiSnapshot({
        repository: missingFillCoverage,
        clock: CLOCK,
        staleAfterMs: 90_000,
      }).health.state,
    ).toBe('degraded');
  });

  it('exposes subsequent fills with explicit open provider-created query bounds', () => {
    const result = buildPortfolioApiSnapshot({
      repository: repositorySnapshot({
        activity_window_started_at: '2026-07-13T17:17:58.000Z',
        activity_baseline_only: false,
      }),
      clock: CLOCK,
      staleAfterMs: 90_000,
    });

    expect(result.observedFills).toMatchObject({
      selectionBasis: 'provider_created_at',
      createdAfterExclusive: '2026-07-13T17:17:58.000Z',
      createdBeforeExclusive: '2026-07-13T17:19:58.000Z',
      initialBaseline: false,
    });
  });
});
