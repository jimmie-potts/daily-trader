import pg, { type Pool as PgPool, type PoolClient, type QueryResultRow } from 'pg';

import {
  PortfolioApiRepository,
  type PortfolioQueryPort,
  type PortfolioQueryResult,
} from './portfolio.js';

const { Pool, TypeOverrides, types } = pg;

export interface PortfolioApiDatabase {
  readonly reader: PortfolioApiRepository;
  close(): Promise<void>;
}

export class PortfolioApiQueryCancelledError extends Error {
  public constructor() {
    super('Portfolio API database query was cancelled');
    this.name = 'PortfolioApiQueryCancelledError';
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function releasePendingClient(pendingClient: Promise<PoolClient>): void {
  void pendingClient.then(
    (client) => client.release(),
    () => undefined,
  );
}

async function acquireClient(
  pool: Pick<PgPool, 'connect'>,
  signal: AbortSignal | undefined,
): Promise<PoolClient> {
  if (isAborted(signal)) {
    throw new PortfolioApiQueryCancelledError();
  }
  const pendingClient = pool.connect();
  if (signal === undefined) return pendingClient;
  if (isAborted(signal)) {
    releasePendingClient(pendingClient);
    throw new PortfolioApiQueryCancelledError();
  }

  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new PortfolioApiQueryCancelledError());
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([pendingClient, cancelled]);
  } catch (error) {
    if (isAborted(signal)) {
      releasePendingClient(pendingClient);
      throw new PortfolioApiQueryCancelledError();
    }
    throw error;
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort);
  }
}

/** Runs one read-only query and destroys its checked-out connection if the request is cancelled. */
export async function queryPortfolioApiDatabase<Row extends Readonly<Record<string, unknown>>>(
  pool: Pick<PgPool, 'connect'>,
  text: string,
  values: readonly unknown[] | undefined,
  signal: AbortSignal | undefined,
): Promise<PortfolioQueryResult<Row>> {
  const client = await acquireClient(pool, signal);
  const cancellation = new PortfolioApiQueryCancelledError();
  let released = false;
  let releaseError: Error | undefined;
  const releaseClient = (error?: Error): void => {
    if (released) return;
    released = true;
    client.release(error);
  };
  const abort = (): void => {
    // Releasing with an error removes the client from the pool. node-postgres
    // force-closes a client with an active query, which cancels the backend work.
    releaseClient(cancellation);
  };
  if (signal !== undefined) signal.addEventListener('abort', abort, { once: true });

  try {
    if (isAborted(signal)) {
      abort();
      throw cancellation;
    }
    const result = await client.query<Row & QueryResultRow>(
      text,
      values === undefined ? undefined : [...values],
    );
    if (isAborted(signal)) throw cancellation;
    return Object.freeze({ rows: result.rows });
  } catch (error) {
    if (isAborted(signal)) throw cancellation;
    releaseError =
      error instanceof Error ? error : new Error('Portfolio API database query failed');
    throw error;
  } finally {
    if (signal !== undefined) signal.removeEventListener('abort', abort);
    releaseClient(releaseError);
  }
}

/** Creates the bounded, read-only query pool used by the portfolio presentation endpoint. */
export function createPortfolioApiDatabase(options: {
  readonly connectionString: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
}): PortfolioApiDatabase {
  const exactTypes = new TypeOverrides(types);
  exactTypes.setTypeParser(types.builtins.NUMERIC, 'text', (value) => value);
  exactTypes.setTypeParser(types.builtins.INT8, 'text', (value) => value);

  const pool = new Pool({
    application_name: 'daily-trader-portfolio-api',
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idle_in_transaction_session_timeout: options.statementTimeoutMs,
    idleTimeoutMillis: 30_000,
    max: 2,
    options: '-c default_transaction_read_only=on',
    query_timeout: options.statementTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
    types: exactTypes,
  });
  pool.on('error', () => undefined);

  const queryPort: PortfolioQueryPort = Object.freeze({
    query: async <Row extends Readonly<Record<string, unknown>>>(
      text: string,
      values?: readonly unknown[],
      signal?: AbortSignal,
    ) => queryPortfolioApiDatabase<Row>(pool, text, values, signal),
  });

  return Object.freeze({
    reader: new PortfolioApiRepository(queryPort),
    close: async (): Promise<void> => pool.end(),
  });
}
