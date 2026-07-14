import { readFileSync } from 'node:fs';

import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import type { PortfolioRequestReceipt } from '@daily-trader/portfolio';
import { describe, expect, it } from 'vitest';

import type { AlpacaPaperApiError } from './errors.js';
import { AlpacaPaperTradingClient } from './http-client.js';
import type { AlpacaFetch, AlpacaFetchInit, AlpacaFetchResponse } from './types.js';

const CLOCK = new FixedClock(createUtcTimestamp('2026-07-13T14:00:00.000Z'));

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/alpaca/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
}

function response(
  payload: unknown,
  requestId: string,
  status = 200,
  extraHeaders: Readonly<Record<string, string>> = {},
): AlpacaFetchResponse {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      ...extraHeaders,
    },
  });
}

interface FetchCall {
  readonly init: AlpacaFetchInit;
  readonly url: URL;
}

function routingFetch(
  route: (url: URL, init: AlpacaFetchInit) => AlpacaFetchResponse,
  calls: FetchCall[],
): AlpacaFetch {
  return (input, init) => {
    const url = new URL(input);
    calls.push({ init, url });
    return Promise.resolve(route(url, init));
  };
}

function defaultRoute(url: URL): AlpacaFetchResponse {
  switch (url.pathname) {
    case '/v2/account':
      return response(fixture('account'), 'request-account');
    case '/v2/positions':
      return response(fixture('positions'), 'request-positions');
    case '/v2/orders':
      return response(fixture('orders'), 'request-orders');
    case '/v2/account/activities/FILL':
      return response(fixture('fills'), 'request-fills');
    default:
      throw new Error('unexpected test route');
  }
}

function client(
  fetch: AlpacaFetch,
  overrides: Record<string, number> = {},
): AlpacaPaperTradingClient {
  return new AlpacaPaperTradingClient(
    {
      apiKey: 'fixture-key',
      apiSecret: 'fixture-secret',
      expectedAccountId: 'fixture-paper-account-id',
      ...overrides,
    },
    { clock: CLOCK, fetch },
  );
}

describe('AlpacaPaperTradingClient', () => {
  it('uses only the exact paper GET allowlist and keeps credentials at the transport call', async () => {
    const calls: FetchCall[] = [];
    const receipts: PortfolioRequestReceipt[] = [];
    const capture = await client(routingFetch((url) => defaultRoute(url), calls)).capture({
      previousActivityCutoverAt: null,
      captureAttempt: 2,
      onRequestReceipt: (receipt) => {
        receipts.push(receipt);
        return Promise.resolve();
      },
    });

    expect(calls.map(({ url }) => url.pathname).sort()).toEqual([
      '/v2/account',
      '/v2/account/activities/FILL',
      '/v2/orders',
      '/v2/positions',
    ]);
    for (const { init, url } of calls) {
      expect(url.origin).toBe('https://paper-api.alpaca.markets');
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('manual');
      expect(init.headers).toMatchObject({
        'APCA-API-KEY-ID': 'fixture-key',
        'APCA-API-SECRET-KEY': 'fixture-secret',
      });
    }
    const activityCall = calls.find(({ url }) => url.pathname === '/v2/account/activities/FILL');
    expect(activityCall?.url.searchParams.get('after')).toBe('2026-07-13T13:59:59.000Z');
    expect(activityCall?.url.searchParams.get('until')).toBe('2026-07-13T14:00:00.000Z');
    expect(capture.activityBaselineOnly).toBe(true);
    expect(capture.account.metadata.requestId).toBe('request-account');
    expect(capture.positions.metadata.requestId).toBe('request-positions');
    expect(receipts).toHaveLength(4);
    expect(receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: 'account',
          captureAttempt: 2,
          pageOrdinal: 0,
          responseStatus: 200,
        }),
        expect.objectContaining({ resource: 'positions', pageOrdinal: 0 }),
        expect.objectContaining({ resource: 'orders', pageOrdinal: 0 }),
        expect.objectContaining({ resource: 'fills', pageOrdinal: 0 }),
      ]),
    );
    expect(JSON.stringify(receipts)).not.toMatch(/request-(?:account|positions|orders|fills)/u);
    expect(JSON.stringify(capture)).not.toContain('fixture-key');
    expect(JSON.stringify(capture)).not.toContain('fixture-secret');
  });

  it('paginates orders by ascending after_order_id and fills in one fixed created-at query', async () => {
    const calls: FetchCall[] = [];
    const receipts: PortfolioRequestReceipt[] = [];
    const orders = Array.from({ length: 500 }, (_, index) => ({ id: `order-${index}` }));
    const fills = Array.from({ length: 100 }, (_, index) => ({ id: `fill-${index}` }));
    const fetch = routingFetch((url) => {
      if (url.pathname === '/v2/orders') {
        return url.searchParams.has('after_order_id')
          ? response([{ id: 'order-final' }], 'request-orders-2')
          : response(orders, 'request-orders-1');
      }
      if (url.pathname === '/v2/account/activities/FILL') {
        return url.searchParams.has('page_token')
          ? response([{ id: 'fill-final' }], 'request-fills-2')
          : response(fills, 'request-fills-1');
      }
      return defaultRoute(url);
    }, calls);

    const capture = await client(fetch).capture({
      previousActivityCutoverAt: createUtcTimestamp('2026-07-13T13:00:00.000Z'),
      onRequestReceipt: (receipt) => {
        receipts.push(receipt);
        return Promise.resolve();
      },
    });

    expect(capture.orders).toHaveLength(2);
    expect(capture.fills).toHaveLength(2);
    const secondOrderPage = calls.find(
      ({ url }) => url.searchParams.get('after_order_id') === 'order-499',
    );
    expect(
      calls.find(({ url }) => url.pathname === '/v2/orders')?.url.searchParams.get('limit'),
    ).toBe('500');
    expect(secondOrderPage?.url.searchParams.get('direction')).toBe('asc');
    const secondFillPage = calls.find(
      ({ url }) => url.searchParams.get('page_token') === 'fill-99',
    );
    const createdAfter = secondFillPage?.url.searchParams.get('after');
    const createdBefore = secondFillPage?.url.searchParams.get('until');
    expect(createdAfter).toBe('2026-07-13T12:59:59.000Z');
    expect(createdBefore).toBe('2026-07-13T14:00:00.000Z');
    // Both provider bounds are exclusive. The bounded overlap makes the prior
    // cutover strictly interior, so an activity created exactly at that seam is
    // not omitted between cycles.
    expect(Date.parse(createdAfter!)).toBeLessThan(Date.parse('2026-07-13T13:00:00.000Z'));
    expect(Date.parse(createdBefore!)).toBeGreaterThan(Date.parse('2026-07-13T13:00:00.000Z'));
    expect(
      calls
        .find(({ url }) => url.pathname === '/v2/account/activities/FILL')
        ?.url.searchParams.get('page_size'),
    ).toBe('100');
    expect(capture.activityBaselineOnly).toBe(false);
    expect(
      receipts
        .filter(({ resource }) => resource === 'orders' || resource === 'fills')
        .map(({ resource, pageOrdinal }) => `${resource}:${String(pageOrdinal)}`)
        .sort(),
    ).toEqual(['fills:0', 'fills:1', 'orders:0', 'orders:1']);
  });

  it('uses validated configured page sizes without exceeding provider limits', async () => {
    const calls: FetchCall[] = [];
    const fetch = routingFetch((url) => {
      if (url.pathname === '/v2/orders') {
        return url.searchParams.has('after_order_id')
          ? response([], 'request-orders-2')
          : response([{ id: 'order-1' }, { id: 'order-2' }], 'request-orders-1');
      }
      if (url.pathname === '/v2/account/activities/FILL') {
        return url.searchParams.has('page_token')
          ? response([], 'request-fills-2')
          : response([{ id: 'fill-1' }], 'request-fills-1');
      }
      return defaultRoute(url);
    }, calls);

    const capture = await client(fetch, { orderPageSize: 2, fillPageSize: 1 }).capture({
      previousActivityCutoverAt: null,
    });

    expect(capture.orders).toHaveLength(2);
    expect(capture.fills).toHaveLength(2);
    expect(
      calls.find(({ url }) => url.pathname === '/v2/orders')?.url.searchParams.get('limit'),
    ).toBe('2');
    expect(
      calls
        .find(({ url }) => url.pathname === '/v2/account/activities/FILL')
        ?.url.searchParams.get('page_size'),
    ).toBe('1');
    expect(() => client(fetch, { orderPageSize: 501 })).toThrow(TypeError);
    expect(() => client(fetch, { fillPageSize: 101 })).toThrow(TypeError);
  });

  it('requires collection limits to leave page budget for a terminal short page', () => {
    const fetch = routingFetch(defaultRoute, []);

    expect(() => client(fetch, { maxOrderPages: 2, orderPageSize: 2, maxOrders: 4 })).toThrow(
      'maxOrders must be less than maxOrderPages multiplied by orderPageSize',
    );
    expect(() => client(fetch, { maxFillPages: 2, fillPageSize: 2, maxFills: 4 })).toThrow(
      'maxFills must be less than maxFillPages multiplied by fillPageSize',
    );
    expect(() =>
      client(fetch, {
        maxOrderPages: 2,
        orderPageSize: 2,
        maxOrders: 3,
        maxFillPages: 2,
        fillPageSize: 2,
        maxFills: 3,
      }),
    ).not.toThrow();
    expect(() =>
      client(fetch, {
        maxOrderPages: 2,
        orderPageSize: 2,
        maxFillPages: 2,
        fillPageSize: 2,
      }),
    ).not.toThrow();
  });

  it('aborts and settles sibling collection reads before rejecting one failed capture', async () => {
    const siblingStates = new Map<string, 'aborted' | 'started'>();
    const receipts: PortfolioRequestReceipt[] = [];
    const fetch: AlpacaFetch = (input, init) => {
      const url = new URL(input);
      if (url.pathname === '/v2/account') {
        return Promise.resolve(response(fixture('account'), 'request-account'));
      }
      if (url.pathname === '/v2/orders') {
        return Promise.resolve(response({}, 'request-orders-failure', 503));
      }
      siblingStates.set(url.pathname, 'started');
      return new Promise<AlpacaFetchResponse>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => {
            siblingStates.set(url.pathname, 'aborted');
            reject(new Error('sibling request aborted'));
          },
          { once: true },
        );
      });
    };

    await expect(
      client(fetch).capture({
        previousActivityCutoverAt: null,
        onRequestReceipt: (receipt) => {
          receipts.push(receipt);
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({
      classification: 'retryable_transport',
      code: 'ALPACA_SERVICE_UNAVAILABLE',
    });

    expect(siblingStates).toEqual(
      new Map([
        ['/v2/positions', 'aborted'],
        ['/v2/account/activities/FILL', 'aborted'],
      ]),
    );
    expect(receipts.map(({ resource }) => resource)).toEqual(['account']);
  });

  it('rejects redirects without following them or exposing credentials', async () => {
    const calls: FetchCall[] = [];
    const fetch = routingFetch(
      (url) =>
        url.pathname === '/v2/account'
          ? response({}, 'request-redirect', 302, { location: 'https://api.alpaca.markets' })
          : defaultRoute(url),
      calls,
    );

    const failure = await client(fetch)
      .capture({ previousActivityCutoverAt: null })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      classification: 'redirect_rejected',
      code: 'ALPACA_REDIRECT_REJECTED',
    });
    expect(JSON.stringify(failure)).not.toContain('fixture-secret');
    expect(calls.find(({ url }) => url.pathname === '/v2/account')?.init.redirect).toBe('manual');
  });

  it('bounds response bytes and page-derived collection capacity', async () => {
    const oversizedFetch = routingFetch(
      (url) =>
        url.pathname === '/v2/account'
          ? response({ content: 'x'.repeat(256) }, 'request-large')
          : defaultRoute(url),
      [],
    );
    await expect(
      client(oversizedFetch, { maxResponseBytes: 64 }).capture({
        previousActivityCutoverAt: null,
      }),
    ).rejects.toMatchObject({ code: 'ALPACA_RESPONSE_TOO_LARGE' });

    const fullPage = Array.from({ length: 500 }, (_, index) => ({ id: `order-${index}` }));
    const pageLimitedFetch = routingFetch(
      (url) =>
        url.pathname === '/v2/orders'
          ? response(fullPage, 'request-orders-full')
          : defaultRoute(url),
      [],
    );
    await expect(
      client(pageLimitedFetch, { maxOrderPages: 1 }).capture({
        previousActivityCutoverAt: null,
      }),
    ).rejects.toMatchObject({ code: 'ALPACA_ORDER_LIMIT_EXCEEDED' });

    await expect(
      client(routingFetch(defaultRoute, []), { maxPositions: 2 }).capture({
        previousActivityCutoverAt: null,
      }),
    ).rejects.toMatchObject({ code: 'ALPACA_POSITION_LIMIT_EXCEEDED' });
  });

  it('returns a bounded rate-limit classification and retry delay', async () => {
    const fetch = routingFetch(
      (url) =>
        url.pathname === '/v2/account'
          ? response({}, 'request-rate-limit', 429, { 'retry-after': '7' })
          : defaultRoute(url),
      [],
    );

    await expect(client(fetch).capture({ previousActivityCutoverAt: null })).rejects.toEqual(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({
        classification: 'rate_limited',
        code: 'ALPACA_RATE_LIMITED',
        retryAfterMs: 7_000,
      }),
    );
  });

  it('rejects a successful response that lacks the required provider request ID', async () => {
    const fetch = routingFetch(
      (url) =>
        url.pathname === '/v2/account'
          ? new Response(JSON.stringify(fixture('account')), {
              headers: { 'content-type': 'application/json' },
            })
          : defaultRoute(url),
      [],
    );

    await expect(client(fetch).capture({ previousActivityCutoverAt: null })).rejects.toMatchObject({
      classification: 'malformed_response',
      code: 'ALPACA_REQUEST_ID_INVALID',
    });
  });
});
