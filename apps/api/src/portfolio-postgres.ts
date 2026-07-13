import pg, { type QueryResultRow } from 'pg';

import { PortfolioApiRepository, type PortfolioQueryPort } from './portfolio.js';

const { Pool, TypeOverrides, types } = pg;

export interface PortfolioApiDatabase {
  readonly reader: PortfolioApiRepository;
  close(): Promise<void>;
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
    ) => {
      const result = await pool.query<Row & QueryResultRow>(
        text,
        values === undefined ? undefined : [...values],
      );
      return Object.freeze({ rows: result.rows });
    },
  });

  return Object.freeze({
    reader: new PortfolioApiRepository(queryPort),
    close: async (): Promise<void> => pool.end(),
  });
}
