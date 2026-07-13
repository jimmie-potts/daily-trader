import pg, { type PoolClient, type QueryResultRow } from 'pg';

import type { SqlClient, SqlPool, SqlQueryResult, SqlRow } from './sql.js';

const { Pool, TypeOverrides, types } = pg;

export interface PgSignalsPoolOptions {
  readonly connectionString: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

function result<Row extends SqlRow>(value: {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}): SqlQueryResult<Row> {
  return Object.freeze({ rows: value.rows, rowCount: value.rowCount });
}

function values(input?: readonly unknown[]): unknown[] | undefined {
  return input === undefined ? undefined : [...input];
}

class ClientAdapter implements SqlClient {
  readonly #client: PoolClient;
  readonly #release: (client: PoolClient, destroy: boolean) => void;

  public constructor(client: PoolClient, release: (client: PoolClient, destroy: boolean) => void) {
    this.#client = client;
    this.#release = release;
  }

  public async query<Row extends SqlRow = SqlRow>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    return result(await this.#client.query<Row & QueryResultRow>(text, values(parameters)));
  }

  public release(): void {
    this.#release(this.#client, false);
  }
}

/** PostgreSQL NUMERIC and BIGINT both remain exact text at the application boundary. */
export function createPgSignalsPool(options: PgSignalsPoolOptions): SqlPool {
  if (options.connectionString.trim().length === 0)
    throw new TypeError('connectionString required');
  for (const value of [options.connectionTimeoutMs, options.statementTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 100 || value > 60_000) {
      throw new TypeError('database timeouts must be bounded milliseconds');
    }
  }

  const exactTypes = new TypeOverrides(types);
  exactTypes.setTypeParser(types.builtins.NUMERIC, 'text', (value) => value);
  exactTypes.setTypeParser(types.builtins.INT8, 'text', (value) => value);
  const pool = new Pool({
    application_name: 'daily-trader-signals-worker',
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idle_in_transaction_session_timeout: options.statementTimeoutMs,
    idleTimeoutMillis: 30_000,
    max: 4,
    query_timeout: options.statementTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
    types: exactTypes,
  });
  pool.on('error', () => undefined);

  const active = new Set<PoolClient>();
  let ending: Promise<void> | undefined;
  const release = (client: PoolClient, destroy: boolean): void => {
    if (!active.delete(client)) return;
    client.release(destroy);
  };
  const acquire = async (): Promise<PoolClient> => {
    const client = await pool.connect();
    active.add(client);
    return client;
  };
  const end = (): Promise<void> => {
    ending ??= pool.end();
    return ending;
  };

  return Object.freeze({
    connect: async () => new ClientAdapter(await acquire(), release),
    query: async <Row extends SqlRow = SqlRow>(text: string, parameters?: readonly unknown[]) => {
      const client = await acquire();
      try {
        return result(await client.query<Row & QueryResultRow>(text, values(parameters)));
      } finally {
        release(client, false);
      }
    },
    end,
    destroy: async () => {
      for (const client of [...active]) release(client, true);
      await end();
    },
  });
}
