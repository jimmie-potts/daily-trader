import { spawnSync } from 'node:child_process';

import pg from 'pg';

const { Client } = pg;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const defaultDatabaseUrl =
  'postgresql://daily_trader:daily_trader_local@127.0.0.1:5432/daily_trader';
const defaultRedisUrl = 'redis://127.0.0.1:6379';
const checksumPattern = /^[0-9a-f]{64}$/u;

try {
  process.loadEnvFile('.env');
} catch (error) {
  if (!(
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )) {
    process.stderr.write('Phase 3 verification could not load the optional environment file.\n');
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
    throw new Error(`${setting} must target a loopback service for Phase 3 verification`);
  }
  return url;
}

function runScript(name, environment = {}) {
  const result = spawnSync(npmCommand, ['run', name], {
    env: { ...sanitizedEnvironment, ...environment },
    stdio: 'inherit',
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`Phase 3 verification step failed: ${name}`);
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
    application_name: 'daily-trader-phase3-verification-admin',
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

function runReplay(environment, arguments_, expectFailure = false) {
  const result = spawnSync(
    process.execPath,
    ['workers/signals/dist/replay/cli.js', 'replay', ...arguments_],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...sanitizedEnvironment, ...environment },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (expectFailure) {
    if (result.error !== undefined || result.status === 0) {
      throw new Error('Injected Phase 3 replay interruption did not fail safely');
    }
    if (!result.stderr.includes('signal_replay.failed')) {
      throw new Error('Injected Phase 3 replay interruption was not classified safely');
    }
    process.stdout.write(
      `${JSON.stringify({ event: 'phase3.replay.interruption_observed', status: 'passed' })}\n`,
    );
    return undefined;
  }
  if (result.error !== undefined || result.status !== 0) {
    throw new Error('Phase 3 replay process failed');
  }
  const newline = result.stdout.indexOf('\n');
  if (newline < 0) throw new Error('Phase 3 replay output was incomplete');
  let summary;
  try {
    summary = JSON.parse(result.stdout.slice(0, newline));
  } catch {
    throw new Error('Phase 3 replay summary was invalid');
  }
  const serializedOutput = result.stdout.slice(newline + 1);
  if (
    summary === null ||
    typeof summary !== 'object' ||
    summary.mode !== 'REPLAY' ||
    summary.state !== 'completed' ||
    typeof summary.targetId !== 'string' ||
    typeof summary.outputChecksum !== 'string' ||
    !checksumPattern.test(summary.outputChecksum) ||
    serializedOutput.length === 0 ||
    !serializedOutput.endsWith('\n')
  ) {
    throw new Error('Phase 3 replay result was invalid');
  }
  return Object.freeze({
    targetId: summary.targetId,
    outputChecksum: summary.outputChecksum,
    serializedOutput,
  });
}

function runReplayInspection(environment, targetId) {
  const result = spawnSync(
    process.execPath,
    ['workers/signals/dist/replay/cli.js', 'inspect', targetId],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...sanitizedEnvironment, ...environment },
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error('Phase 3 replay inspection failed');
  }
  process.stdout.write(result.stdout);
  if (!result.stdout.endsWith('\n')) process.stdout.write('\n');
}

function runLiveStatus(environment) {
  const result = spawnSync(process.execPath, ['workers/signals/dist/signal-cli.js', 'status'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...sanitizedEnvironment, ...environment },
    maxBuffer: 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error('Phase 3 live signal status failed');
  }
  process.stdout.write(result.stdout);
}

function runLiveServiceVerification(environment) {
  const result = spawnSync(process.execPath, ['scripts/verify-phase3-live.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...sanitizedEnvironment, ...environment },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    throw new Error('Phase 3 live service verification failed');
  }
  process.stdout.write(result.stdout);
  if (!result.stdout.endsWith('\n')) process.stdout.write('\n');
}

async function inspectInterruptedReplay(databaseUrl, expectedOutput, expectedCursor) {
  let snapshot;
  await withAdminClient(databaseUrl, async (client) => {
    const target = await client.query(
      `SELECT run.run_id, run.state, run.cursor_position::text AS cursor_position,
              cursor.cursor_value::text AS cursor_value,
              run.expected_membership_count, run.failure_code,
              run.replay_output_checksum, run.replay_output_payload
       FROM signal_runs AS run
       JOIN signal_run_cursors AS cursor USING (run_id)
       WHERE run.source_kind = 'replay_schedule'`,
    );
    if (target.rows.length !== 1) {
      throw new Error('Interrupted Phase 3 replay target was not uniquely persisted');
    }
    const row = target.rows[0];
    if (
      row.run_id !== expectedOutput.targetId ||
      row.state !== 'failed' ||
      row.cursor_position !== String(expectedCursor) ||
      row.cursor_value !== String(expectedCursor) ||
      row.expected_membership_count !== expectedOutput.associations.length ||
      row.failure_code !== 'replay_sink_failed' ||
      row.replay_output_checksum !== null ||
      row.replay_output_payload !== null
    ) {
      throw new Error('Interrupted Phase 3 replay cursor state was invalid');
    }
    const membership = await client.query(
      `SELECT membership.ordinal::text AS ordinal,
              membership.expected_evaluation_id,
              transition.transition_id,
              transition.evaluation_id,
              transition.source_ordinal::text AS source_ordinal,
              transition.transition_ordinal
       FROM signal_run_expected_membership AS membership
       JOIN signal_run_transitions AS transition
         ON transition.run_id = membership.run_id
        AND transition.source_ordinal = membership.ordinal
       WHERE membership.run_id = $1
       ORDER BY membership.ordinal`,
      [row.run_id],
    );
    const expectedAssociations = expectedOutput.associations.slice(0, expectedCursor);
    if (
      membership.rows.length !== expectedCursor ||
      membership.rows.some((item, index) => {
        const expected = expectedAssociations[index];
        return (
          expected === undefined ||
          item.ordinal !== String(expected.targetOrdinal) ||
          item.source_ordinal !== String(expected.targetOrdinal) ||
          item.transition_ordinal !== expected.scheduleOrdinal ||
          item.expected_evaluation_id !== expected.evaluationId ||
          item.evaluation_id !== expected.evaluationId
        );
      })
    ) {
      throw new Error('Interrupted Phase 3 replay partial membership was not exact');
    }
    snapshot = Object.freeze({
      targetId: row.run_id,
      expectedCount: row.expected_membership_count,
      serializedMembership: JSON.stringify(membership.rows),
    });
  });
  if (snapshot === undefined) {
    throw new Error('Interrupted Phase 3 replay snapshot was unavailable');
  }
  process.stdout.write(
    `${JSON.stringify({
      event: 'phase3.replay.partial_membership_verified',
      targetId: snapshot.targetId,
      cursor: String(expectedCursor),
      expectedCount: snapshot.expectedCount,
      status: 'passed',
    })}\n`,
  );
  return snapshot;
}

async function assertReplayPrefixPreserved(databaseUrl, snapshot, expectedCursor) {
  await withAdminClient(databaseUrl, async (client) => {
    const membership = await client.query(
      `SELECT membership.ordinal::text AS ordinal,
              membership.expected_evaluation_id,
              transition.transition_id,
              transition.evaluation_id,
              transition.source_ordinal::text AS source_ordinal,
              transition.transition_ordinal
       FROM signal_run_expected_membership AS membership
       JOIN signal_run_transitions AS transition
         ON transition.run_id = membership.run_id
        AND transition.source_ordinal = membership.ordinal
       WHERE membership.run_id = $1 AND membership.ordinal <= $2
       ORDER BY membership.ordinal`,
      [snapshot.targetId, expectedCursor],
    );
    if (JSON.stringify(membership.rows) !== snapshot.serializedMembership) {
      throw new Error('Restarted Phase 3 replay did not preserve its exact durable prefix');
    }
  });
}

const configuredEnvironment = process.env.APP_ENV ?? 'local';
if (configuredEnvironment !== 'local' && configuredEnvironment !== 'test') {
  process.stderr.write('Phase 3 verification is restricted to local or test environments.\n');
  process.exit(1);
}

let baseDatabaseUrl;
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

const sanitizedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith('SIGNAL_') &&
      key !== 'MARKET_DATA_API_KEY' &&
      key !== 'MARKET_DATA_API_SECRET' &&
      !key.startsWith('PAPER_BROKER_') &&
      !key.startsWith('LIVE_BROKER_'),
  ),
);
const token = `${String(process.pid)}_${String(Date.now())}`;
const databaseNames = [
  `daily_trader_p3_clean_a_${token}`,
  `daily_trader_p3_clean_b_${token}`,
  `daily_trader_p3_restart_${token}`,
  `daily_trader_p3_live_${token}`,
];
const databaseUrls = databaseNames.map((databaseName) => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url;
});
verificationRedisUrl = new URL(verificationRedisUrl);
verificationRedisUrl.pathname = '/14';

const commonChildEnvironment = {
  APP_ENV: 'test',
  REDIS_URL: verificationRedisUrl.toString(),
  MARKET_DATA_MODE: 'disabled',
  MARKET_DATA_API_KEY: '',
  MARKET_DATA_API_SECRET: '',
  PAPER_BROKER_BASE_URL: '',
  PAPER_BROKER_API_KEY: '',
  PAPER_BROKER_API_SECRET: '',
  PAPER_BROKER_ACCOUNT_ID: '',
  LIVE_BROKER_BASE_URL: '',
  LIVE_BROKER_API_KEY: '',
  LIVE_BROKER_API_SECRET: '',
  LIVE_BROKER_ACCOUNT_ID: '',
  SIGNAL_MODE: 'disabled',
  SIGNAL_CONFIGURATION_VERSION: 'phase3-v1',
  SIGNAL_DEFINITION: 'breakout_plus_volume.v1',
  SIGNAL_SYMBOLS: 'AAPL,SPY',
  SIGNAL_LOOKBACK_WINDOW: '20',
  SIGNAL_VOLUME_MULTIPLIER: '1.5',
  SIGNAL_JOURNAL_POLL_INTERVAL_MS: '250',
  SIGNAL_CLAIM_BATCH_SIZE: '50',
  SIGNAL_QUEUE_CAPACITY: '1000',
  SIGNAL_RETRY_MAX_ATTEMPTS: '5',
  SIGNAL_RETRY_BASE_DELAY_MS: '100',
  SIGNAL_RETRY_MAX_DELAY_MS: '5000',
  SIGNAL_RETRY_JITTER_PERCENT: '20',
  SIGNAL_BACKLOG_LIMIT: '10000',
  SIGNAL_STATEMENT_TIMEOUT_MS: '10000',
  SIGNAL_CLAIM_LEASE_MS: '30000',
  SIGNAL_CLAIM_RENEW_INTERVAL_MS: '10000',
  SIGNAL_SHUTDOWN_TIMEOUT_MS: '10000',
  BROKER_MODE: 'paper',
  EXECUTION_ENABLED: 'false',
};

let servicesAttempted = false;
let servicesRunning = false;
const createdDatabases = [];
let failed = false;

try {
  runScript('ci');
  runScript('audit:dependencies');
  runScript('signal:recording:verify', commonChildEnvironment);

  servicesAttempted = true;
  runScript('services:up');
  servicesRunning = true;
  runScript('services:check');

  for (const [index, databaseName] of databaseNames.entries()) {
    await withAdminClient(baseDatabaseUrl.toString(), async (client) => {
      await client.query(`CREATE DATABASE ${quotedIdentifier(databaseName)} TEMPLATE template0`);
    });
    createdDatabases.push(databaseName);
    const environment = {
      ...commonChildEnvironment,
      DATABASE_URL: databaseUrls[index].toString(),
    };
    runScript('db:migrate', environment);
    runScript('db:migrate', environment);
    runScript('services:check', environment);
  }

  const environmentA = {
    ...commonChildEnvironment,
    DATABASE_URL: databaseUrls[0].toString(),
  };
  const environmentB = {
    ...commonChildEnvironment,
    DATABASE_URL: databaseUrls[1].toString(),
  };
  const environmentRestart = {
    ...commonChildEnvironment,
    DATABASE_URL: databaseUrls[2].toString(),
  };
  const environmentLive = {
    ...commonChildEnvironment,
    DATABASE_URL: databaseUrls[3].toString(),
  };
  const cleanA = runReplay(environmentA, ['--repeat']);
  const cleanB = runReplay(environmentB, []);
  if (
    cleanA.outputChecksum !== cleanB.outputChecksum ||
    cleanA.serializedOutput !== cleanB.serializedOutput
  ) {
    throw new Error('Isolated Phase 3 clean replay outputs differed');
  }
  runReplayInspection(environmentA, cleanA.targetId);

  let expectedReplayOutput;
  try {
    expectedReplayOutput = JSON.parse(cleanA.serializedOutput);
  } catch {
    throw new Error('Clean Phase 3 replay output was not valid JSON');
  }
  if (
    expectedReplayOutput === null ||
    typeof expectedReplayOutput !== 'object' ||
    expectedReplayOutput.targetId !== cleanA.targetId ||
    !Array.isArray(expectedReplayOutput.associations)
  ) {
    throw new Error('Clean Phase 3 replay output did not expose expected membership');
  }

  const interruptionCursor = 5;
  runReplay(environmentRestart, [`--interrupt-after=${String(interruptionCursor)}`], true);
  const interrupted = await inspectInterruptedReplay(
    environmentRestart.DATABASE_URL,
    expectedReplayOutput,
    interruptionCursor,
  );
  runScript('services:stop');
  servicesRunning = false;
  runScript('services:up');
  servicesRunning = true;
  runScript('services:check', environmentRestart);
  const restarted = runReplay(environmentRestart, []);
  if (restarted.targetId !== interrupted.targetId) {
    throw new Error('Restarted Phase 3 replay selected a different target');
  }
  await assertReplayPrefixPreserved(
    environmentRestart.DATABASE_URL,
    interrupted,
    interruptionCursor,
  );
  if (
    cleanA.outputChecksum !== restarted.outputChecksum ||
    cleanA.serializedOutput !== restarted.serializedOutput
  ) {
    throw new Error('Restarted Phase 3 replay output differed from clean replay');
  }
  runReplayInspection(environmentRestart, restarted.targetId);
  runLiveServiceVerification(environmentLive);
  runLiveStatus(environmentLive);

  process.stdout.write(
    `${JSON.stringify({
      event: 'phase3.technical_verification.complete',
      outputChecksum: cleanA.outputChecksum,
      phase2ProviderSmoke: 'recorded_pass_2026-07-13',
      phaseExit: 'passed',
      status: 'passed',
    })}\n`,
  );
} catch (error) {
  failed = true;
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Phase 3 verification failed'}\n`,
  );
} finally {
  if (createdDatabases.length > 0) {
    if (!servicesRunning) {
      try {
        runScript('services:up');
        servicesRunning = true;
      } catch {
        failed = true;
      }
    }
    if (servicesRunning) {
      for (const databaseName of createdDatabases) {
        try {
          await withAdminClient(baseDatabaseUrl.toString(), async (client) => {
            await client.query(
              `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`,
            );
          });
        } catch {
          failed = true;
          process.stderr.write('Phase 3 verification database cleanup failed.\n');
        }
      }
    }
  }

  if (servicesAttempted) {
    try {
      runScript('services:stop');
      servicesRunning = false;
    } catch {
      failed = true;
      process.stderr.write('Phase 3 service cleanup failed.\n');
    }
  }
}

process.exitCode = failed ? 1 : 0;
