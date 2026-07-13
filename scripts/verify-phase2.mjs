import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';

import pg from 'pg';

const { Client } = pg;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const defaultDatabaseUrl =
  'postgresql://daily_trader:daily_trader_local@127.0.0.1:5432/daily_trader';
const defaultRedisUrl = 'redis://127.0.0.1:6379';

try {
  process.loadEnvFile('.env');
} catch (error) {
  if (!(
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )) {
    process.stderr.write('Phase 2 verification could not load the optional environment file.\n');
    process.exit(1);
  }
}

function requireLoopbackUrl(value, allowedProtocols, setting) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${setting} must be a valid local service URL`);
  }
  if (
    !allowedProtocols.includes(url.protocol) ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '::1')
  ) {
    throw new Error(`${setting} must target a loopback service for Phase 2 verification`);
  }
  return url;
}

function runScript(name, environment = {}) {
  const result = spawnSync(npmCommand, ['run', name], {
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`Phase 2 verification step failed: ${name}`);
  }
}

function quotedIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) {
    throw new Error('Generated verification database identifier was invalid');
  }
  return `"${value}"`;
}

async function withAdminClient(databaseUrl, operation) {
  const client = new Client({
    application_name: 'daily-trader-phase2-verification-admin',
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  try {
    await client.connect();
    await operation(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const configuredEnvironment = process.env.APP_ENV ?? 'local';
if (configuredEnvironment !== 'local' && configuredEnvironment !== 'test') {
  process.stderr.write('Phase 2 verification is restricted to local or test environments.\n');
  process.exit(1);
}

let baseDatabaseUrl;
let verificationDatabaseUrl;
let verificationRedisUrl;
try {
  baseDatabaseUrl = requireLoopbackUrl(
    process.env.DATABASE_URL ?? defaultDatabaseUrl,
    ['postgres:', 'postgresql:'],
    'DATABASE_URL',
  );
  verificationRedisUrl = requireLoopbackUrl(
    process.env.REDIS_URL ?? defaultRedisUrl,
    ['redis:', 'rediss:'],
    'REDIS_URL',
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid local service URL'}\n`);
  process.exit(1);
}

const databaseName = `daily_trader_phase2_verify_${String(process.pid)}_${String(Date.now())}`;
const verificationRunId = `v${String(process.pid)}-${String(Date.now())}`;
verificationDatabaseUrl = new URL(baseDatabaseUrl);
verificationDatabaseUrl.pathname = `/${databaseName}`;
verificationRedisUrl = new URL(verificationRedisUrl);
verificationRedisUrl.pathname = '/15';

const stateFile = `/tmp/daily-trader-phase2-verify-${String(process.pid)}.json`;
const childEnvironment = {
  APP_ENV: 'test',
  DATABASE_URL: verificationDatabaseUrl.toString(),
  REDIS_URL: verificationRedisUrl.toString(),
  MARKET_DATA_MODE: 'disabled',
  MARKET_DATA_API_KEY: '',
  MARKET_DATA_API_SECRET: '',
  PHASE2_VERIFY_STATE_FILE: stateFile,
  PHASE2_VERIFY_RUN_ID: verificationRunId,
};

let servicesAttempted = false;
let servicesRunning = false;
let databaseCreated = false;
let failed = false;

try {
  runScript('ci');
  runScript('audit:dependencies');

  servicesAttempted = true;
  runScript('services:up');
  servicesRunning = true;
  runScript('services:check');

  await withAdminClient(baseDatabaseUrl.toString(), async (client) => {
    await client.query(`CREATE DATABASE ${quotedIdentifier(databaseName)} TEMPLATE template0`);
  });
  databaseCreated = true;

  runScript('db:migrate', childEnvironment);
  runScript('services:check', childEnvironment);
  runScript('phase2:service-verify', {
    ...childEnvironment,
    PHASE2_VERIFY_PASS: 'initial',
  });

  runScript('services:stop');
  servicesRunning = false;
  runScript('services:up');
  servicesRunning = true;
  runScript('services:check', childEnvironment);
  runScript('phase2:service-verify', {
    ...childEnvironment,
    PHASE2_VERIFY_PASS: 'restart',
  });

  process.stdout.write(
    `${JSON.stringify({ event: 'phase2.verification.complete', providerSmoke: 'not_run', status: 'passed' })}\n`,
  );
} catch (error) {
  failed = true;
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Phase 2 verification failed'}\n`,
  );
} finally {
  await rm(stateFile, { force: true }).catch(() => undefined);

  if (databaseCreated) {
    if (!servicesRunning) {
      try {
        runScript('services:up');
        servicesRunning = true;
      } catch {
        failed = true;
      }
    }
    if (servicesRunning) {
      try {
        await withAdminClient(baseDatabaseUrl.toString(), async (client) => {
          await client.query(
            `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`,
          );
        });
      } catch {
        failed = true;
        process.stderr.write('Phase 2 verification database cleanup failed.\n');
      }
    }
  }

  if (servicesAttempted) {
    try {
      runScript('services:stop');
      servicesRunning = false;
    } catch {
      failed = true;
      process.stderr.write('Phase 2 service cleanup failed.\n');
    }
  }
}

process.exitCode = failed ? 1 : 0;
