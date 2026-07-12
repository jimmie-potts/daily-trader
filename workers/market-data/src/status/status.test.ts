import { createExactDecimal, createUtcTimestamp, FixedClock } from '@daily-trader/domain';
import {
  PHASE_2_INSTRUMENTS,
  addUtcMilliseconds,
  createOneMinuteBarEvent,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import { describe, expect, it } from 'vitest';

import { buildMarketStatusModel } from './model.js';
import { renderMarketStatus, renderMarketStatusRow } from './render.js';
import type {
  BuildMarketStatusInput,
  MarketStatusConnectionState,
  MarketStatusModel,
  MarketStatusRepositorySnapshot,
  PresentMarketStatusRow,
} from './types.js';

interface BarFixtureOptions {
  readonly symbol: 'AAPL' | 'SPY';
  readonly barStart?: string;
  readonly receivedAt?: string;
  readonly close?: string;
}

function barFixture({
  symbol,
  barStart = '2026-07-13T13:30:00.000Z',
  receivedAt,
  close = symbol === 'AAPL' ? '210.25' : '610.5',
}: BarFixtureOptions): OneMinuteBarEvent {
  const instrument = PHASE_2_INSTRUMENTS[symbol];
  const barStartUtc = createUtcTimestamp(barStart);
  const defaultReceivedAt = addUtcMilliseconds(barStartUtc, 70_000);
  return createOneMinuteBarEvent({
    symbol,
    venue: instrument.venue,
    providerTimestamp: barStart,
    receivedAt: receivedAt ?? defaultReceivedAt,
    processedAt: receivedAt ?? defaultReceivedAt,
    open: symbol === 'AAPL' ? '210' : '610',
    high: symbol === 'AAPL' ? '211' : '611',
    low: symbol === 'AAPL' ? '209' : '609',
    close,
    volume: symbol === 'AAPL' ? '12345678901234567890' : '7654321',
  });
}

function repository(
  AAPL: OneMinuteBarEvent | undefined,
  SPY: OneMinuteBarEvent | undefined,
  health: Pick<MarketStatusRepositorySnapshot, 'postgresPersistence' | 'redisDelivery'> = {
    postgresPersistence: 'healthy',
    redisDelivery: 'healthy',
  },
): MarketStatusRepositorySnapshot {
  return Object.freeze({
    latest: Object.freeze({ AAPL, SPY }),
    ...health,
  });
}

function model(
  snapshot: MarketStatusRepositorySnapshot,
  observedAt = '2026-07-13T13:31:30.000Z',
  overrides: Partial<
    Pick<BuildMarketStatusInput, 'connection' | 'gap' | 'lastSuccessfulEvent'>
  > = {},
): MarketStatusModel {
  return buildMarketStatusModel({
    repository: snapshot,
    clock: new FixedClock(createUtcTimestamp(observedAt)),
    connection: overrides.connection ?? 'subscribed',
    gap: overrides.gap ?? 'complete',
    lastSuccessfulEvent:
      overrides.lastSuccessfulEvent ?? createUtcTimestamp('2026-07-13T13:31:10.000Z'),
  });
}

describe('terminal market status', () => {
  it('renders fresh persisted AAPL then SPY bar closes with exact source and time context', () => {
    const status = model(repository(barFixture({ symbol: 'AAPL' }), barFixture({ symbol: 'SPY' })));
    const rendered = renderMarketStatus(status);

    expect(rendered).toBe(
      [
        'MARKET STATUS | observed_at=2026-07-13T13:31:30.000Z',
        'AAPL/XNAS | BAR CLOSE | close=210.25 | currency=USD | unit=USD/share | bar_start=2026-07-13T13:30:00.000Z | as_of=2026-07-13T13:31:00.000Z | provider_timestamp=2026-07-13T13:30:00.000Z | received_at=2026-07-13T13:31:10.000Z | age_ms=30000 | freshness=fresh | arrival=on_time | provider=alpaca | feed=iex | entitlement=real_time | delay_ms=0',
        'SPY/ARCX | BAR CLOSE | close=610.5 | currency=USD | unit=USD/share | bar_start=2026-07-13T13:30:00.000Z | as_of=2026-07-13T13:31:00.000Z | provider_timestamp=2026-07-13T13:30:00.000Z | received_at=2026-07-13T13:31:10.000Z | age_ms=30000 | freshness=fresh | arrival=on_time | provider=alpaca | feed=iex | entitlement=real_time | delay_ms=0',
        'OVERALL | connection=subscribed | last_event=2026-07-13T13:31:10.000Z | gap=complete | redis_delivery=healthy | postgres_persistence=healthy',
      ].join('\n'),
    );
    expect(rendered).not.toMatch(/quote/iu);
    expect(renderMarketStatus(status)).toBe(rendered);
  });

  it('preserves a delayed presentation row without changing the canonical IEX event contract', () => {
    const status = model(repository(barFixture({ symbol: 'AAPL' }), undefined));
    const canonicalRow = status.rows[0];
    if (canonicalRow.state !== 'present') {
      throw new TypeError('expected present AAPL fixture');
    }
    const delayedRow: PresentMarketStatusRow = Object.freeze({
      ...canonicalRow,
      close: createExactDecimal('210.25'),
      source: Object.freeze({
        provider: 'alpaca',
        feed: 'delayed_sip',
        entitlement: 'delayed',
        delayMilliseconds: 900_000,
      }),
    });

    expect(renderMarketStatusRow(delayedRow)).toContain(
      'provider=alpaca | feed=delayed_sip | entitlement=delayed | delay_ms=900000',
    );
  });

  it('makes stale and future bars explicit with signed time age', () => {
    const stale = renderMarketStatus(
      model(repository(barFixture({ symbol: 'AAPL' }), undefined), '2026-07-13T13:35:00.000Z'),
    );
    expect(stale).toContain('age_ms=240000 | freshness=stale');

    const future = renderMarketStatus(
      model(
        repository(
          barFixture({
            symbol: 'AAPL',
            barStart: '2026-07-13T13:32:00.000Z',
            receivedAt: '2026-07-13T13:33:05.000Z',
          }),
          undefined,
        ),
        '2026-07-13T13:31:00.000Z',
      ),
    );
    expect(future).toContain('age_ms=-120000 | freshness=future');
  });

  it('uses the configured freshness threshold in status projection', () => {
    const status = buildMarketStatusModel({
      repository: repository(barFixture({ symbol: 'AAPL' }), undefined),
      clock: new FixedClock(createUtcTimestamp('2026-07-13T13:34:00.000Z')),
      connection: 'subscribed',
      gap: 'complete',
      lastSuccessfulEvent: createUtcTimestamp('2026-07-13T13:31:10.000Z'),
      freshnessThresholdMs: 180_000,
    });

    expect(status.rows[0]).toMatchObject({ freshness: 'fresh', ageMilliseconds: 180_000 });
  });

  it('does not restore fresh status until each symbol has a post-reconnect bar', () => {
    const status = buildMarketStatusModel({
      repository: repository(
        barFixture({ symbol: 'AAPL', receivedAt: '2026-07-13T13:31:10.000Z' }),
        barFixture({ symbol: 'SPY', receivedAt: '2026-07-13T13:31:25.000Z' }),
      ),
      clock: new FixedClock(createUtcTimestamp('2026-07-13T13:31:30.000Z')),
      connection: 'subscribed',
      gap: 'complete',
      lastSuccessfulEvent: createUtcTimestamp('2026-07-13T13:31:25.000Z'),
      freshnessNotBefore: createUtcTimestamp('2026-07-13T13:31:20.000Z'),
    });

    expect(status.rows[0]).toMatchObject({ symbol: 'AAPL', freshness: 'unknown' });
    expect(status.rows[1]).toMatchObject({ symbol: 'SPY', freshness: 'fresh' });
  });

  it('shows missing and partial AAPL/SPY state without zero-fill or substitution', () => {
    const missing = renderMarketStatus(model(repository(undefined, undefined)));
    expect(missing).toContain('AAPL/XNAS | MISSING | bar_close=missing | freshness=no_data');
    expect(missing).toContain('SPY/ARCX | MISSING | bar_close=missing | freshness=no_data');
    expect(missing).not.toContain('close=0');

    const partial = renderMarketStatus(
      model(repository(barFixture({ symbol: 'AAPL' }), undefined)),
    );
    expect(partial).toContain('AAPL/XNAS | BAR CLOSE | close=210.25');
    expect(partial).toContain('SPY/ARCX | MISSING');
    expect(partial).not.toContain('SPY/ARCX | BAR CLOSE | close=210.25');
  });

  it.each<MarketStatusConnectionState>(['disconnected', 'reconnecting'])(
    'renders %s connection independently from unknown data freshness',
    (connection) => {
      const status = renderMarketStatus(
        model(repository(undefined, undefined), '2026-07-13T13:31:30.000Z', {
          connection,
        }),
      );

      expect(status).toContain(`OVERALL | connection=${connection}`);
      expect(status).toContain('AAPL/XNAS | MISSING');
    },
  );

  it('reports gap, Redis delivery, and Postgres persistence independently', () => {
    const rendered = renderMarketStatus(
      model(
        repository(barFixture({ symbol: 'AAPL' }), barFixture({ symbol: 'SPY' }), {
          redisDelivery: 'degraded',
          postgresPersistence: 'unavailable',
        }),
        '2026-07-13T13:31:30.000Z',
        { gap: 'gapped' },
      ),
    );

    expect(rendered).toContain(
      'gap=gapped | redis_delivery=degraded | postgres_persistence=unavailable',
    );
  });

  it('distinguishes a late arrival from current freshness', () => {
    const late = barFixture({
      symbol: 'AAPL',
      receivedAt: '2026-07-13T13:34:01.000Z',
    });
    const rendered = renderMarketStatus(
      model(repository(late, undefined), '2026-07-13T13:34:30.000Z'),
    );

    expect(rendered).toContain('freshness=stale | arrival=late');
  });

  it('uses outside-session status during an expected closed-market period', () => {
    const fridayClose = barFixture({
      symbol: 'AAPL',
      barStart: '2026-07-17T19:58:00.000Z',
      receivedAt: '2026-07-17T19:59:05.000Z',
    });
    const rendered = renderMarketStatus(
      model(repository(fridayClose, undefined), '2026-07-18T15:00:00.000Z'),
    );

    expect(rendered).toContain('AAPL/XNAS | BAR CLOSE');
    expect(rendered).toContain('freshness=outside_session');
    expect(rendered).toContain(
      'SPY/ARCX | MISSING | bar_close=missing | freshness=outside_session',
    );
  });

  it('does not guess freshness beyond the versioned calendar coverage', () => {
    const event = barFixture({
      symbol: 'AAPL',
      barStart: '2028-12-29T14:30:00.000Z',
      receivedAt: '2028-12-29T14:31:05.000Z',
    });
    const rendered = renderMarketStatus(
      model(repository(event, undefined), '2029-01-02T15:00:00.000Z'),
    );

    expect(rendered).toContain('AAPL/XNAS | BAR CLOSE');
    expect(rendered).toContain('freshness=unknown');
    expect(rendered).toContain('SPY/ARCX | MISSING | bar_close=missing | freshness=unknown');
  });

  it('shows no last event explicitly', () => {
    const rendered = renderMarketStatus(
      buildMarketStatusModel({
        repository: repository(undefined, undefined, {
          redisDelivery: 'unknown',
          postgresPersistence: 'unknown',
        }),
        clock: new FixedClock(createUtcTimestamp('2026-07-13T13:31:30.000Z')),
        connection: 'connecting',
        gap: 'unknown',
        lastSuccessfulEvent: undefined,
      }),
    );

    expect(rendered).toContain(
      'OVERALL | connection=connecting | last_event=none | gap=unknown | redis_delivery=unknown | postgres_persistence=unknown',
    );
  });

  it('allowlists rendered fields and excludes extra secrets, raw payloads, and unused values', () => {
    const secret = 'recognizable-secret-value';
    const canonical = barFixture({ symbol: 'AAPL' });
    const tainted = {
      ...canonical,
      apiSecret: secret,
      rawPayload: `raw-provider-payload-${secret}`,
    } as OneMinuteBarEvent;
    const taintedRepository = {
      ...repository(tainted, undefined),
      credential: secret,
      rawPayload: secret,
    } as MarketStatusRepositorySnapshot;
    const rendered = renderMarketStatus(model(taintedRepository));

    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain('rawPayload');
    expect(rendered).not.toContain(canonical.eventId);
    expect(rendered).not.toContain(canonical.volume);
    expect(rendered).not.toContain('open=');
    expect(rendered).not.toContain('high=');
    expect(rendered).not.toContain('low=');
    expect(rendered).not.toContain('volume=');
  });

  it('rejects a mismatched repository slot rather than substituting instruments', () => {
    expect(() => model(repository(barFixture({ symbol: 'SPY' }), undefined))).toThrowError(
      'does not match the AAPL repository slot',
    );
  });
});
