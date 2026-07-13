import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  decodePortfolioDashboardSnapshot,
  loadPortfolioDashboard,
  type PortfolioDashboardSnapshot,
  type PortfolioFetch,
} from './portfolio.js';

const position: PortfolioDashboardSnapshot['positions'][number] = {
  symbol: 'AAPL',
  venue: 'XNAS',
  providerExchange: 'NASDAQ',
  assetClass: 'us_equity',
  currency: 'USD',
  side: 'long',
  quantity: '10',
  quantityAvailable: '9',
  averageEntryPrice: '140',
  currentPrice: '150',
  marketValue: '1500',
  costBasis: '1400',
  unrealizedProfitLoss: '100',
  allocationPercent: '60',
  projectionSupport: 'supported',
  unsupportedReason: null,
  calculationState: 'complete',
  calculationUnavailableReason: null,
  markSource: 'broker_mark',
};

const snapshot: PortfolioDashboardSnapshot = {
  schemaVersion: 'daily-trader.portfolio.api.v1',
  access: 'read_only',
  environment: 'paper',
  executionEnabled: false,
  valuationAuthority: 'alpaca_paper_broker_mark',
  health: {
    state: 'fresh',
    observedAt: '2026-07-13T13:31:05.000Z',
    snapshotAsOf: '2026-07-13T13:31:02.500Z',
    ageMilliseconds: 2_500,
    knowledgeStartAt: '2026-07-13T13:31:00.000Z',
    knowledgeEndAt: '2026-07-13T13:31:02.500Z',
    workerLifecycle: 'running',
    lastFailureCode: null,
    reconciliation: 'converged',
    change: 'baseline',
    projection: 'complete',
    incompleteReason: null,
  },
  account: { currency: 'USD', cash: '1000', equity: '2500', buyingPower: '2000' },
  metrics: {
    currency: 'USD',
    dayProfitLoss: '25',
    unrealizedProfitLoss: '100',
    grossExposure: '1500',
    netExposure: '1500',
    grossExposurePercent: '60',
    netExposurePercent: '60',
    concentrationPercent: '60',
  },
  positions: [position],
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

describe('portfolio dashboard loader', () => {
  it('keeps development and production presentation on loopback', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { readonly scripts?: Readonly<Record<string, string>> };

    expect(manifest.scripts?.dev).toContain('--hostname 127.0.0.1');
    expect(manifest.scripts?.start).toContain('--hostname 127.0.0.1');
  });

  it('requests only the read model without caching', async () => {
    const fetcher = vi.fn<PortfolioFetch>(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(snapshot) }),
    );

    const result = await loadPortfolioDashboard({
      apiBaseUrl: 'http://127.0.0.1:3001',
      fetcher,
    });

    expect(result).toEqual({ state: 'available', snapshot });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3001/v1/portfolio');
    expect(options.cache).toBe('no-store');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('reconstructs a deeply immutable application-owned snapshot', () => {
    const decoded = decodePortfolioDashboardSnapshot(snapshot);

    expect(decoded).toEqual(snapshot);
    expect(decoded).not.toBe(snapshot);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded?.health)).toBe(true);
    expect(Object.isFrozen(decoded?.positions)).toBe(true);
    expect(Object.isFrozen(decoded?.positions[0])).toBe(true);
    expect(Object.isFrozen(decoded?.observedOrders.byStatus)).toBe(true);
  });

  it('retains bounded rows that share a display symbol without inventing an identifier', () => {
    const decoded = decodePortfolioDashboardSnapshot({
      ...snapshot,
      positions: [position, { ...position, venue: null, providerExchange: 'NASDAQ' }],
    });

    expect(decoded?.positions).toHaveLength(2);
    expect(decoded?.positions.map(({ symbol }) => symbol)).toEqual(['AAPL', 'AAPL']);
  });

  it.each([
    { ok: false, json: () => Promise.resolve(snapshot) },
    { ok: true, json: () => Promise.resolve({ ...snapshot, executionEnabled: true }) },
    { ok: true, json: () => Promise.resolve({ access: 'read_only' }) },
    {
      ok: true,
      json: () =>
        Promise.resolve({
          ...snapshot,
          observedFills: { ...snapshot.observedFills, initialBaseline: 'true' },
        }),
    },
  ])('suppresses unavailable, malformed, or unsafe responses', async (response) => {
    await expect(
      loadPortfolioDashboard({
        apiBaseUrl: 'http://127.0.0.1:3001',
        fetcher: () => Promise.resolve(response),
      }),
    ).resolves.toEqual({ state: 'unavailable' });
  });

  it.each([
    ['unknown top-level key', { ...snapshot, futureField: 'version-skew' }],
    ['unknown health state', { ...snapshot, health: { ...snapshot.health, state: 'healthy' } }],
    [
      'impossible health timestamp',
      { ...snapshot, health: { ...snapshot.health, observedAt: '2026-02-31T13:31:05.000Z' } },
    ],
    [
      'unknown nested health key',
      { ...snapshot, health: { ...snapshot.health, providerMessage: 'untrusted' } },
    ],
    ['numeric account value', { ...snapshot, account: { ...snapshot.account, cash: 1000 } }],
    [
      'noncanonical metric value',
      { ...snapshot, metrics: { ...snapshot.metrics, grossExposure: '1.5e3' } },
    ],
    [
      'unknown account key',
      { ...snapshot, account: { ...snapshot.account, accountId: 'must-not-render' } },
    ],
    ['invalid position enum', { ...snapshot, positions: [{ ...position, side: 'buy' }] }],
    [
      'unknown position key',
      { ...snapshot, positions: [{ ...position, rawPayload: '<b>unsafe</b>' }] },
    ],
    [
      'incoherent supported position',
      {
        ...snapshot,
        positions: [{ ...position, projectionSupport: 'supported', unsupportedReason: 'x' }],
      },
    ],
    [
      'malformed order status count',
      { ...snapshot, observedOrders: { count: 1, byStatus: { filled: '1' } } },
    ],
    [
      'inconsistent order status total',
      { ...snapshot, observedOrders: { count: 2, byStatus: { filled: 1 } } },
    ],
    [
      'malformed fill timestamp',
      {
        ...snapshot,
        observedFills: {
          ...snapshot.observedFills,
          latestTransactionAt: 'July 13, 2026',
        },
      },
    ],
    [
      'reversed provider creation bounds',
      {
        ...snapshot,
        observedFills: {
          ...snapshot.observedFills,
          createdAfterExclusive: snapshot.observedFills.createdBeforeExclusive,
        },
      },
    ],
    [
      'fill count without transaction evidence',
      {
        ...snapshot,
        observedFills: { ...snapshot.observedFills, latestTransactionAt: null },
      },
    ],
    [
      'unknown fill key',
      { ...snapshot, observedFills: { ...snapshot.observedFills, fullHistory: true } },
    ],
  ])('fails closed for malformed nested payload: %s', async (_case, body) => {
    await expect(
      loadPortfolioDashboard({
        apiBaseUrl: 'http://127.0.0.1:3001',
        fetcher: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }),
      }),
    ).resolves.toEqual({ state: 'unavailable' });
  });

  it('rejects a position collection beyond the broker boundary cap before decoding rows', async () => {
    const positions = Array.from({ length: 10_001 }, () => position);

    await expect(
      loadPortfolioDashboard({
        apiBaseUrl: 'http://127.0.0.1:3001',
        fetcher: () =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...snapshot, positions }),
          }),
      }),
    ).resolves.toEqual({ state: 'unavailable' });
  });

  it('degrades safely when the local API cannot be reached', async () => {
    await expect(
      loadPortfolioDashboard({
        apiBaseUrl: 'http://127.0.0.1:3001',
        fetcher: () => Promise.reject(new Error('connection detail')),
      }),
    ).resolves.toEqual({ state: 'unavailable' });
  });
});
