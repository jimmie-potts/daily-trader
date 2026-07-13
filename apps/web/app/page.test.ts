import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PortfolioDashboardSnapshot } from '../src/portfolio.js';
import { PortfolioDashboard } from './page';

const snapshot: PortfolioDashboardSnapshot = {
  schemaVersion: 'daily-trader.portfolio.api.v1',
  access: 'read_only',
  environment: 'paper',
  executionEnabled: false,
  valuationAuthority: 'alpaca_paper_broker_mark',
  health: {
    state: 'degraded',
    observedAt: '2026-07-13T13:31:05.000Z',
    snapshotAsOf: '2026-07-13T13:31:02.500Z',
    ageMilliseconds: 2_500,
    knowledgeStartAt: '2026-07-13T13:31:00.000Z',
    knowledgeEndAt: '2026-07-13T13:31:02.500Z',
    workerLifecycle: 'stopped',
    lastFailureCode: null,
    reconciliation: 'converged',
    change: 'baseline',
    projection: 'incomplete',
    incompleteReason: 'unsupported_holding',
  },
  account: { currency: 'USD', cash: '1000', equity: '2500', buyingPower: '2000' },
  metrics: null,
  positions: [
    {
      symbol: 'BTCUSD',
      venue: null,
      providerExchange: '',
      assetClass: 'crypto',
      currency: 'USD',
      side: 'long',
      quantity: '0.005',
      quantityAvailable: '0.005',
      averageEntryPrice: '60000',
      currentPrice: '62000',
      marketValue: '310',
      costBasis: '300',
      unrealizedProfitLoss: '10',
      allocationPercent: null,
      projectionSupport: 'unsupported',
      unsupportedReason: 'unsupported_asset_class',
      calculationState: 'incomplete',
      calculationUnavailableReason: 'unsupported_holding',
      markSource: 'broker_mark',
    },
  ],
  observedOrders: { count: 1, byStatus: { filled: 1 } },
  observedFills: {
    count: 1,
    selectionBasis: 'provider_created_at',
    createdAfterExclusive: '2026-07-13T13:30:02.500Z',
    createdBeforeExclusive: '2026-07-13T13:31:02.500Z',
    latestTransactionAt: '2026-07-13T13:31:01.987Z',
    initialBaseline: true,
  },
};

describe('portfolio dashboard rendering', () => {
  it('renders exact read-only paper state and unsupported evidence without action controls', () => {
    const markup = renderToStaticMarkup(
      createElement(PortfolioDashboard, { result: { state: 'available', snapshot } }),
    );

    expect(markup).toContain('Paper');
    expect(markup).toContain('Read only');
    expect(markup).toContain('Execution disabled');
    expect(markup).toContain('unsupported_asset_class');
    expect(markup).toContain('2500 ms');
    expect(markup).toContain('bounded initial activity-created query');
    expect(markup).toContain('2026-07-13T13:30:02.500Z');
    expect(markup).toContain('both bounds exclusive');
    expect(markup).toContain('Transaction time is separate');
    expect(markup).toContain('Not full account history');
    expect(markup).not.toMatch(/>\s*(?:Buy|Sell|Submit|Replace|Cancel|Close|Approve)\s*</iu);
  });

  it('labels subsequent fill coverage as a bounded activity-created query', () => {
    const markup = renderToStaticMarkup(
      createElement(PortfolioDashboard, {
        result: {
          state: 'available',
          snapshot: {
            ...snapshot,
            observedFills: { ...snapshot.observedFills, initialBaseline: false },
          },
        },
      }),
    );

    expect(markup).toContain('bounded activity-created query');
    expect(markup).not.toContain('bounded initial activity-created query');
    expect(markup).toContain('both bounds exclusive');
    expect(markup).toContain('Not full account history');
  });

  it('distinguishes a healthy empty portfolio from an unavailable snapshot', () => {
    const markup = renderToStaticMarkup(
      createElement(PortfolioDashboard, {
        result: {
          state: 'available',
          snapshot: {
            ...snapshot,
            health: {
              ...snapshot.health,
              state: 'fresh',
              workerLifecycle: 'running',
              projection: 'complete',
              incompleteReason: null,
            },
            metrics: {
              currency: 'USD',
              dayProfitLoss: '0',
              unrealizedProfitLoss: '0',
              grossExposure: '0',
              netExposure: '0',
              grossExposurePercent: '0',
              netExposurePercent: '0',
              concentrationPercent: null,
            },
            positions: [],
            observedOrders: { count: 0, byStatus: {} },
            observedFills: {
              ...snapshot.observedFills,
              count: 0,
              latestTransactionAt: null,
            },
          },
        },
      }),
    );

    expect(markup).toContain('state-fresh');
    expect(markup).toContain('0 positions');
    expect(markup).toContain('No positions were observed.');
    expect(markup).toContain('No observed order states');
    expect(markup).not.toContain('Portfolio API unavailable');
  });

  it('renders exact long and short position rows without changing their signs', () => {
    const longPosition: PortfolioDashboardSnapshot['positions'][number] = {
      symbol: 'AAPL',
      venue: 'XNAS',
      providerExchange: 'NASDAQ',
      assetClass: 'us_equity',
      currency: 'USD',
      side: 'long',
      quantity: '10.5',
      quantityAvailable: '8.5',
      averageEntryPrice: '195.1',
      currentPrice: '200',
      marketValue: '2100',
      costBasis: '2048.55',
      unrealizedProfitLoss: '51.45',
      allocationPercent: '84',
      projectionSupport: 'supported',
      unsupportedReason: null,
      calculationState: 'complete',
      calculationUnavailableReason: null,
      markSource: 'broker_mark',
    };
    const shortPosition: PortfolioDashboardSnapshot['positions'][number] = {
      ...longPosition,
      symbol: 'SPY',
      venue: 'ARCX',
      providerExchange: 'ARCA',
      side: 'short',
      quantity: '-2.5',
      quantityAvailable: '-2.5',
      averageEntryPrice: '510',
      currentPrice: '500',
      marketValue: '-1250',
      costBasis: '-1275',
      unrealizedProfitLoss: '25',
      allocationPercent: '50',
    };
    const markup = renderToStaticMarkup(
      createElement(PortfolioDashboard, {
        result: {
          state: 'available',
          snapshot: { ...snapshot, positions: [longPosition, shortPosition] },
        },
      }),
    );

    expect(markup).toContain('long <code>10.5</code>');
    expect(markup).toContain('short <code>-2.5</code>');
    expect(markup).toContain('<code>-1250</code>');
  });

  it('keeps an explicitly stale last-good snapshot visible with its age and as-of time', () => {
    const markup = renderToStaticMarkup(
      createElement(PortfolioDashboard, {
        result: {
          state: 'available',
          snapshot: {
            ...snapshot,
            health: {
              ...snapshot.health,
              state: 'stale',
              ageMilliseconds: 120_001,
              workerLifecycle: 'running',
            },
            account: { ...snapshot.account!, equity: '3141.59' },
          },
        },
      }),
    );

    expect(markup).toContain('state-stale');
    expect(markup).toContain('120001 ms');
    expect(markup).toContain('2026-07-13T13:31:02.500Z');
    expect(markup).toContain('<code>3141.59</code>');
  });

  it('surfaces a failed synchronization and reconciliation drift on retained data', () => {
    const markup = renderToStaticMarkup(
      createElement(PortfolioDashboard, {
        result: {
          state: 'available',
          snapshot: {
            ...snapshot,
            health: {
              ...snapshot.health,
              state: 'degraded',
              workerLifecycle: 'degraded',
              lastFailureCode: 'provider_transport',
              reconciliation: 'drift',
            },
          },
        },
      }),
    );

    expect(markup).toContain('state-degraded');
    expect(markup).toContain('Last failure: provider_transport');
    expect(markup).toContain('<strong>drift</strong>');
    expect(markup).toContain('<code>2500</code>');
  });

  it('keeps a null broker mark visible and explains calculation suppression', () => {
    const nullMarkPosition: PortfolioDashboardSnapshot['positions'][number] = {
      ...snapshot.positions[0]!,
      symbol: 'AAPL',
      venue: 'XNAS',
      providerExchange: 'NASDAQ',
      assetClass: 'us_equity',
      projectionSupport: 'supported',
      unsupportedReason: null,
      currentPrice: null,
      marketValue: null,
      unrealizedProfitLoss: null,
      allocationPercent: null,
      calculationState: 'incomplete',
      calculationUnavailableReason: 'missing_current_price',
    };
    const markup = renderToStaticMarkup(
      createElement(PortfolioDashboard, {
        result: {
          state: 'available',
          snapshot: {
            ...snapshot,
            health: {
              ...snapshot.health,
              projection: 'incomplete',
              incompleteReason: 'missing_current_price',
            },
            metrics: null,
            positions: [nullMarkPosition],
          },
        },
      }),
    );

    expect(markup.match(/unavailable/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain('Aggregate projections are incomplete: missing_current_price.');
    expect(markup).toContain('missing_current_price');
  });

  it('renders unavailable state without cached financial values', () => {
    const markup = renderToStaticMarkup(
      createElement(PortfolioDashboard, { result: { state: 'unavailable' } }),
    );

    expect(markup).toContain('Portfolio API unavailable');
    expect(markup).not.toContain(snapshot.account?.equity ?? 'never');
  });
});
