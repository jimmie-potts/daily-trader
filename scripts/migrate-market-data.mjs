import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';

import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';

const { Client } = pg;
const migrationsDirectory = path.resolve('infrastructure/postgres/migrations');
const migrationName = /^\d{4}_[a-z0-9_]+\.sql$/u;

function checksum(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function loadMigrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => migrationName.test(name))
    .sort();

  if (names.length === 0) {
    throw new Error('No market-data migrations were found');
  }

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(migrationsDirectory, name), 'utf8');
      return { checksum: checksum(sql), name, sql };
    }),
  );
}

async function migrate() {
  loadOptionalEnvironmentFile();
  const config = loadConfig();
  const client = new Client({
    application_name: 'daily-trader-market-data-migrations',
    connectionString: config.services.database.url,
    connectionTimeoutMillis: config.services.database.connectionTimeoutMs,
    query_timeout: config.services.database.connectionTimeoutMs,
    statement_timeout: 30_000,
  });
  let locked = false;

  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_trader_schema_migrations (
        migration_name text PRIMARY KEY,
        checksum character(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (checksum ~ '^[0-9a-f]{64}$')
      )
    `);
    await client.query('SELECT pg_advisory_lock(1642454217)');
    locked = true;

    const migrations = await loadMigrations();
    for (const migration of migrations) {
      const existing = await client.query(
        'SELECT checksum FROM daily_trader_schema_migrations WHERE migration_name = $1',
        [migration.name],
      );
      const existingChecksum = existing.rows[0]?.checksum;

      if (existingChecksum !== undefined) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Applied migration checksum changed: ${migration.name}`);
        }
        process.stdout.write(
          `${JSON.stringify({ event: 'market_data.migration.checked', migration: migration.name })}\n`,
        );
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO daily_trader_schema_migrations (migration_name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      process.stdout.write(
        `${JSON.stringify({ event: 'market_data.migration.applied', migration: migration.name })}\n`,
      );
    }
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(1642454217)').catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

try {
  await migrate();
} catch (error) {
  const event =
    error instanceof ConfigurationError
      ? { event: 'market_data.migration.configuration.invalid', issues: error.issues }
      : { code: 'MARKET_DATA_MIGRATION_FAILED', event: 'market_data.migration.failed' };
  process.stderr.write(`${JSON.stringify(event)}\n`);
  process.exitCode = 1;
}
