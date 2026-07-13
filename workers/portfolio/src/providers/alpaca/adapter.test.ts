import { readFileSync } from 'node:fs';

import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import { describe, expect, it } from 'vitest';

import { DeterministicPortfolioSnapshotProvider } from '../fixture.js';
import { AlpacaPaperPortfolioProvider } from './adapter.js';
import type { AlpacaFetch, AlpacaFetchInit, AlpacaFetchResponse } from './types.js';

const CLOCK = new FixedClock(createUtcTimestamp('2026-07-13T13:31:02.500Z'));

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/alpaca/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
}

function response(payload: unknown, requestId: string): AlpacaFetchResponse {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
  });
}

function provider(fetch: AlpacaFetch): AlpacaPaperPortfolioProvider {
  return new AlpacaPaperPortfolioProvider(
    {
      apiKey: 'fixture-key',
      apiSecret: 'fixture-secret',
      expectedAccountId: 'fixture-paper-account-id',
    },
    { clock: CLOCK, fetch },
  );
}

describe('AlpacaPaperPortfolioProvider', () => {
  it('offers only a complete normalized read and emits no mutating request', async () => {
    const calls: { readonly init: AlpacaFetchInit; readonly url: URL }[] = [];
    const fetch: AlpacaFetch = (input, init) => {
      const url = new URL(input);
      calls.push({ init, url });
      const route =
        url.pathname === '/v2/account'
          ? ['account', 'adapter-account']
          : url.pathname === '/v2/positions'
            ? ['positions', 'adapter-positions']
            : url.pathname === '/v2/orders'
              ? ['orders', 'adapter-orders']
              : ['fills', 'adapter-fills'];
      return Promise.resolve(response(fixture(route[0]!), route[1]!));
    };

    const snapshot = await provider(fetch).capture({ previousActivityCutoverAt: null });

    expect(snapshot.coverage).toMatchObject({
      positionsComplete: true,
      ordersComplete: true,
      fillsComplete: true,
    });
    expect(snapshot.positions).toHaveLength(3);
    expect(Object.getOwnPropertyNames(AlpacaPaperPortfolioProvider.prototype)).toEqual([
      'constructor',
      'capture',
    ]);
    expect(calls).toHaveLength(4);
    expect(calls.map(({ init }) => init.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
    expect(
      calls.every(({ url }) =>
        ['/v2/account', '/v2/account/activities/FILL', '/v2/orders', '/v2/positions'].includes(
          url.pathname,
        ),
      ),
    ).toBe(true);

    const fixtureProvider = new DeterministicPortfolioSnapshotProvider(snapshot);
    await expect(fixtureProvider.capture({ previousActivityCutoverAt: null })).resolves.toBe(
      snapshot,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      fixtureProvider.capture({
        previousActivityCutoverAt: null,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Fixture portfolio capture was cancelled');
  });

  it('fails before collection reads when the authenticated account is not expected', async () => {
    const calls: string[] = [];
    const fetch: AlpacaFetch = (input) => {
      calls.push(new URL(input).pathname);
      const account = structuredClone(fixture('account')) as Record<string, unknown>;
      account.id = 'different-paper-account';
      return Promise.resolve(response(account, 'adapter-account-mismatch'));
    };

    await expect(
      provider(fetch).capture({ previousActivityCutoverAt: null }),
    ).rejects.toMatchObject({
      classification: 'account_mismatch',
      code: 'ALPACA_ACCOUNT_MISMATCH',
    });
    expect(calls).toEqual(['/v2/account']);
  });

  it('classifies cancellation without exposing transport details', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch: AlpacaFetch = () => Promise.reject(new Error('sensitive transport detail'));

    const failure = await provider(fetch)
      .capture({ previousActivityCutoverAt: null, signal: controller.signal })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      classification: 'cancelled',
      code: 'ALPACA_CANCELLED',
      message: 'The Alpaca paper Trading API request failed',
    });
    expect(JSON.stringify(failure)).not.toContain('sensitive transport detail');
  });
});
