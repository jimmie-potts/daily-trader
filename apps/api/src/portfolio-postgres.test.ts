import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  PortfolioApiQueryCancelledError,
  queryPortfolioApiDatabase,
} from './portfolio-postgres.js';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

interface FakeClient {
  readonly calls: QueryCall[];
  readonly releases: readonly (Error | boolean | undefined)[];
  readonly client: PoolClient;
}

function fakeClient(
  query: (
    text: string,
    values: readonly unknown[] | undefined,
  ) => Promise<Readonly<{ rows: readonly Readonly<Record<string, unknown>>[] }>>,
): FakeClient {
  const calls: QueryCall[] = [];
  const releases: (Error | boolean | undefined)[] = [];
  let rejectActive: ((error: Error) => void) | undefined;
  const client = {
    query: (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return new Promise((resolve, reject) => {
        rejectActive = reject;
        void query(text, values).then(resolve, reject);
      });
    },
    release: (error?: Error | boolean): void => {
      releases.push(error);
      if (error instanceof Error) rejectActive?.(error);
      rejectActive = undefined;
    },
  } as unknown as PoolClient;
  return { calls, releases, client };
}

function poolWith(client: PoolClient): Pick<Pool, 'connect'> {
  return {
    connect: () => Promise.resolve(client),
  };
}

describe('portfolio API PostgreSQL cancellation', () => {
  it('does not enter the pool queue for an already-cancelled request', async () => {
    const database = fakeClient(() => Promise.resolve({ rows: [] }));
    const connect = vi.fn(() => Promise.resolve(database.client));
    const controller = new AbortController();
    controller.abort();

    await expect(
      queryPortfolioApiDatabase(
        { connect },
        'SELECT value FROM safe_projection',
        undefined,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(PortfolioApiQueryCancelledError);

    expect(connect).not.toHaveBeenCalled();
    expect(database.calls).toHaveLength(0);
    expect(database.releases).toHaveLength(0);
  });

  it('cancels a request that aborts while entering the pool queue', async () => {
    const database = fakeClient(() => Promise.resolve({ rows: [] }));
    const controller = new AbortController();
    const connect = vi.fn(() => {
      controller.abort();
      return Promise.resolve(database.client);
    });

    await expect(
      queryPortfolioApiDatabase(
        { connect },
        'SELECT value FROM safe_projection',
        undefined,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(PortfolioApiQueryCancelledError);

    expect(connect).toHaveBeenCalledOnce();
    expect(database.calls).toHaveLength(0);
    await vi.waitFor(() => expect(database.releases).toEqual([undefined]));
  });

  it('releases a successful read and preserves only its rows', async () => {
    const database = fakeClient(() => Promise.resolve({ rows: [{ value: 'safe' }] }));
    const controller = new AbortController();

    const result = await queryPortfolioApiDatabase<{ readonly value: string }>(
      poolWith(database.client),
      'SELECT value FROM safe_projection WHERE key = $1',
      ['portfolio'],
      controller.signal,
    );

    expect(result).toEqual({ rows: [{ value: 'safe' }] });
    expect(database.calls).toEqual([
      {
        text: 'SELECT value FROM safe_projection WHERE key = $1',
        values: ['portfolio'],
      },
    ]);
    expect(database.releases).toEqual([undefined]);
  });

  it('destroys the checked-out connection when an active request is cancelled', async () => {
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const database = fakeClient(
      () =>
        new Promise(() => {
          startedResolve?.();
        }),
    );
    const controller = new AbortController();
    const pending = queryPortfolioApiDatabase(
      poolWith(database.client),
      'SELECT pg_sleep(60)',
      undefined,
      controller.signal,
    );

    await started;
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(PortfolioApiQueryCancelledError);
    expect(database.releases).toHaveLength(1);
    expect(database.releases[0]).toBeInstanceOf(PortfolioApiQueryCancelledError);
  });

  it('settles immediately while a pool checkout is pending and releases the late client', async () => {
    const database = fakeClient(() => Promise.resolve({ rows: [] }));
    let connectResolve: ((client: PoolClient) => void) | undefined;
    const pool = {
      connect: () =>
        new Promise<PoolClient>((resolve) => {
          connectResolve = resolve;
        }),
    } as Pick<Pool, 'connect'>;
    const controller = new AbortController();
    const pending = queryPortfolioApiDatabase(
      pool,
      'SELECT value FROM safe_projection',
      undefined,
      controller.signal,
    );

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(PortfolioApiQueryCancelledError);
    expect(database.calls).toHaveLength(0);

    connectResolve?.(database.client);
    await vi.waitFor(() => expect(database.releases).toEqual([undefined]));
  });
});
