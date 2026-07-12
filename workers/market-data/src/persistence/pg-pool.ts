import pg, { type PoolClient, type QueryResultRow } from 'pg';

import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlRow } from './repository.js';

const { Pool, TypeOverrides, types } = pg;

export interface PgMarketDataPoolOptions {
  readonly connectionString: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs?: number;
  readonly maximumConnections?: number;
}

function validateOptions(options: PgMarketDataPoolOptions): void {
  if (options.connectionString.trim().length === 0) {
    throw new TypeError('connectionString must be non-empty');
  }
  if (
    !Number.isInteger(options.connectionTimeoutMs) ||
    options.connectionTimeoutMs < 100 ||
    options.connectionTimeoutMs > 60_000
  ) {
    throw new TypeError('connectionTimeoutMs must be between 100 and 60000');
  }
  const statementTimeoutMs = options.statementTimeoutMs ?? 30_000;
  if (
    !Number.isInteger(statementTimeoutMs) ||
    statementTimeoutMs < 100 ||
    statementTimeoutMs > 60_000
  ) {
    throw new TypeError('statementTimeoutMs must be between 100 and 60000');
  }
  const maximumConnections = options.maximumConnections ?? 5;
  if (!Number.isInteger(maximumConnections) || maximumConnections < 1 || maximumConnections > 20) {
    throw new TypeError('maximumConnections must be between 1 and 20');
  }
}

function queryValues(values: readonly unknown[] | undefined): unknown[] | undefined {
  return values === undefined ? undefined : [...values];
}

function queryResult<Row extends SqlRow>(result: {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}): SqlQueryResult<Row> {
  return Object.freeze({ rows: result.rows, rowCount: result.rowCount });
}

class PgClientAdapter implements SqlPoolClient {
  readonly #client: PoolClient;
  readonly #releaseClient: (client: PoolClient, destroy: boolean) => void;

  public constructor(
    client: PoolClient,
    releaseClient: (client: PoolClient, destroy: boolean) => void,
  ) {
    this.#client = client;
    this.#releaseClient = releaseClient;
  }

  public async query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.#client.query<Row & QueryResultRow>(text, queryValues(values));
    return queryResult<Row>(result);
  }

  public release(): void {
    this.#releaseClient(this.#client, false);
  }
}

/** Creates a bounded pg pool with an explicit string parser for PostgreSQL NUMERIC. */
export function createPgMarketDataPool(options: PgMarketDataPoolOptions): SqlPool {
  validateOptions(options);
  const statementTimeoutMs = options.statementTimeoutMs ?? 30_000;
  const exactTypes = new TypeOverrides(types);
  exactTypes.setTypeParser(types.builtins.NUMERIC, 'text', (value) => value);

  const pool = new Pool({
    application_name: 'daily-trader-market-data-persistence',
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idle_in_transaction_session_timeout: statementTimeoutMs,
    idleTimeoutMillis: 30_000,
    max: options.maximumConnections ?? 5,
    query_timeout: statementTimeoutMs,
    statement_timeout: statementTimeoutMs,
    types: exactTypes,
  });
  pool.on('error', () => undefined);

  const activeClients = new Set<PoolClient>();
  let endPromise: Promise<void> | undefined;
  const releaseClient = (client: PoolClient, destroy: boolean): void => {
    if (!activeClients.delete(client)) {
      return;
    }
    client.release(destroy);
  };
  const acquireClient = async (): Promise<PoolClient> => {
    const client = await pool.connect();
    activeClients.add(client);
    return client;
  };
  const endPool = (): Promise<void> => {
    endPromise ??= pool.end();
    return endPromise;
  };

  return Object.freeze({
    connect: async (): Promise<SqlPoolClient> =>
      new PgClientAdapter(await acquireClient(), releaseClient),
    destroy: async (): Promise<void> => {
      for (const client of [...activeClients]) {
        releaseClient(client, true);
      }
      await endPool();
    },
    end: endPool,
    query: async <Row extends SqlRow = SqlRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<SqlQueryResult<Row>> => {
      const client = await acquireClient();
      try {
        const result = await client.query<Row & QueryResultRow>(text, queryValues(values));
        return queryResult<Row>(result);
      } finally {
        releaseClient(client, false);
      }
    },
  });
}
