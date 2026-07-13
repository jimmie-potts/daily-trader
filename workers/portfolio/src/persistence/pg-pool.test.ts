import { describe, expect, it } from 'vitest';

import { PortfolioWorkerError } from '../errors.js';
import { createPgPortfolioPool } from './pg-pool.js';

describe('PostgreSQL portfolio adapter', () => {
  it('translates raw connection failures into a safe retryable database error', async () => {
    const pool = createPgPortfolioPool({
      connectionString: 'postgresql://portfolio:portfolio@127.0.0.1:1/unavailable',
      connectionTimeoutMs: 100,
      statementTimeoutMs: 100,
    });

    const error = await pool.query('SELECT 1').catch((failure: unknown) => failure);
    await pool.destroy();

    expect(error).toEqual(
      new PortfolioWorkerError('database_unavailable', 'Portfolio database operation failed', true),
    );
    expect(JSON.stringify(error)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|portfolio@/u);
  });
});
