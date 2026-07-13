import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import {
  createOneMinuteBarEvent,
  deserializeOneMinuteBarEvent,
  serializeOneMinuteBarEvent,
} from '../packages/market-data/dist/index.js';
import {
  MarketDataPersistenceError,
  MarketDataRepository,
  createPgMarketDataPool,
} from '../workers/market-data/dist/persistence/index.js';

const FIXTURE_URL = new URL(
  '../packages/signals/fixtures/recordings/synthetic-phase3-signal-session-v1.json',
  import.meta.url,
);
const WORKER_PATH = 'workers/signals/dist/index.js';
const STATUS_PATH = 'workers/signals/dist/signal-cli.js';
const DATABASE_NAME = /^daily_trader_p3_live_[a-z0-9_]{1,48}$/u;
const POLL_INTERVAL_MS = 50;
const STATE_DEADLINE_MS = 20_000;
const PROCESS_DEADLINE_MS = 15_000;
const OUTPUT_LIMIT_BYTES = 256 * 1024;
const PAPER_SESSION_ID = 'phase3-live-verification-writer';
const EXPIRING_PAPER_SESSION_ID = 'phase3-live-expiring-writer';
const INITIAL_CONFIGURATION_VERSION = 'phase3-service-live-v1';
const ROLLOVER_CONFIGURATION_VERSION = 'phase3-service-live-v2';
const EXPECTED_INITIAL_REVISION_COUNT = 5;
const EXPECTED_ROLLOVER_REVISION_COUNT = 4;
const EXPECTED_TOTAL_REVISION_COUNT =
  EXPECTED_INITIAL_REVISION_COUNT + EXPECTED_ROLLOVER_REVISION_COUNT;
const EXPECTED_REENABLED_REVISION_COUNT = 1;
const EXPECTED_FINAL_REVISION_COUNT =
  EXPECTED_TOTAL_REVISION_COUNT + EXPECTED_REENABLED_REVISION_COUNT;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function boundedAppend(current, chunk) {
  const appended = current + String(chunk);
  return appended.length <= OUTPUT_LIMIT_BYTES
    ? appended
    : appended.slice(appended.length - OUTPUT_LIMIT_BYTES);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireVerificationDatabase() {
  const value = process.env.DATABASE_URL;
  invariant(typeof value === 'string' && value.length > 0, 'DATABASE_URL is required');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid URL');
  }
  invariant(
    (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'),
    'Phase 3 live verification requires loopback PostgreSQL',
  );
  invariant(
    DATABASE_NAME.test(url.pathname.slice(1)),
    'Phase 3 live verification requires its disposable database name',
  );
  invariant(
    process.env.APP_ENV === 'test' && process.env.MARKET_DATA_MODE === 'disabled',
    'Phase 3 live verification requires test mode with provider access disabled',
  );
  for (const setting of [
    'MARKET_DATA_API_KEY',
    'MARKET_DATA_API_SECRET',
    'PAPER_BROKER_API_KEY',
    'PAPER_BROKER_API_SECRET',
    'PAPER_BROKER_ACCOUNT_ID',
    'LIVE_BROKER_API_KEY',
    'LIVE_BROKER_API_SECRET',
    'LIVE_BROKER_ACCOUNT_ID',
  ]) {
    invariant(
      (process.env[setting] ?? '').trim().length === 0,
      'Phase 3 live verification does not accept provider credentials',
    );
  }
  return url.toString();
}

function childEnvironment(overrides) {
  return {
    ...process.env,
    APP_ENV: 'test',
    DATABASE_URL: databaseUrl,
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
    SIGNAL_MODE: 'monitor',
    SIGNAL_CONFIGURATION_VERSION: INITIAL_CONFIGURATION_VERSION,
    SIGNAL_DEFINITION: 'breakout_plus_volume.v1',
    SIGNAL_SYMBOLS: 'AAPL,SPY',
    SIGNAL_LOOKBACK_WINDOW: '3',
    SIGNAL_VOLUME_MULTIPLIER: '1.5',
    SIGNAL_JOURNAL_POLL_INTERVAL_MS: '50',
    SIGNAL_CLAIM_BATCH_SIZE: '10',
    SIGNAL_QUEUE_CAPACITY: '100',
    SIGNAL_RETRY_MAX_ATTEMPTS: '3',
    SIGNAL_RETRY_BASE_DELAY_MS: '25',
    SIGNAL_RETRY_MAX_DELAY_MS: '100',
    SIGNAL_RETRY_JITTER_PERCENT: '0',
    SIGNAL_BACKLOG_LIMIT: '100',
    SIGNAL_STATEMENT_TIMEOUT_MS: '5000',
    SIGNAL_CLAIM_LEASE_MS: '15000',
    SIGNAL_CLAIM_RENEW_INTERVAL_MS: '5000',
    SIGNAL_SHUTDOWN_TIMEOUT_MS: '10000',
    BROKER_MODE: 'paper',
    EXECUTION_ENABLED: 'false',
    ...overrides,
  };
}

function startProcess(path, arguments_, environment) {
  const child = spawn(process.execPath, [path, ...arguments_], {
    cwd: process.cwd(),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const runtime = {
    child,
    stdout: '',
    stderr: '',
    exited: false,
    exitCode: null,
    signalCode: null,
    done: undefined,
  };
  child.stdout.on('data', (chunk) => {
    runtime.stdout = boundedAppend(runtime.stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    runtime.stderr = boundedAppend(runtime.stderr, chunk);
  });
  runtime.done = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      runtime.exited = true;
      runtime.exitCode = code;
      runtime.signalCode = signal;
      resolve();
    });
  });
  return runtime;
}

function processFailure(runtime, label) {
  const lastLine = runtime.stderr.trim().split('\n').at(-1) ?? '';
  return new Error(
    `${label} exited before verification completed` +
      (lastLine.length === 0 ? '' : ` (${lastLine.slice(0, 500)})`),
  );
}

async function stopProcess(runtime, label) {
  if (!runtime.exited) runtime.child.kill('SIGTERM');
  const exited = await Promise.race([
    runtime.done.then(() => true),
    delay(PROCESS_DEADLINE_MS).then(() => false),
  ]);
  if (!exited) {
    runtime.child.kill('SIGKILL');
    await runtime.done;
    throw new Error(`${label} did not stop within its bounded shutdown deadline`);
  }
  invariant(
    runtime.exitCode === 0,
    `${label} stopped unsuccessfully (code=${String(runtime.exitCode)}, signal=${String(runtime.signalCode)})`,
  );
}

async function runProcess(path, arguments_, environment, label) {
  const runtime = startProcess(path, arguments_, environment);
  const exited = await Promise.race([
    runtime.done.then(() => true),
    delay(PROCESS_DEADLINE_MS).then(() => false),
  ]);
  if (!exited) {
    runtime.child.kill('SIGKILL');
    await runtime.done;
    throw new Error(`${label} exceeded its bounded deadline`);
  }
  invariant(
    runtime.exitCode === 0,
    `${label} failed` +
      (runtime.stderr.trim().length === 0 ? '' : ` (${runtime.stderr.trim().slice(-500)})`),
  );
  return runtime.stdout;
}

async function waitFor(label, operation, predicate, runtime) {
  const deadline = performance.now() + STATE_DEADLINE_MS;
  let lastValue;
  while (performance.now() <= deadline) {
    if (runtime?.exited === true) throw processFailure(runtime, label);
    lastValue = await operation();
    if (predicate(lastValue)) return lastValue;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} did not reach the expected durable state`);
}

function asNonnegativeIntegerText(value, field) {
  invariant(typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value), `${field} invalid`);
  return value;
}

function eventEntry(event) {
  const eventJson = serializeOneMinuteBarEvent(event);
  return Object.freeze({
    sessionId: PAPER_SESSION_ID,
    eventId: event.eventId,
    orderingKey: event.orderingKey,
    schemaVersion: event.schemaVersion,
    eventJson,
  });
}

async function persistCanonical(repository, event, expectedRevisionCount) {
  await repository.renewWriterCapability(PAPER_SESSION_ID);
  const result = await repository.persistEntry(eventEntry(event));
  invariant(result.canonicalized, 'Verification event did not become canonical');
  const count = await repositoryPool.query(
    'SELECT count(*)::text AS count FROM market_data_canonical_revisions',
  );
  invariant(
    asNonnegativeIntegerText(count.rows[0]?.count, 'revision count') ===
      String(expectedRevisionCount),
    'Canonical revision count did not match the capture boundary',
  );
}

async function persistBatch(repository, events, initialRevisionCount) {
  let expectedRevisionCount = initialRevisionCount;
  for (const event of events) {
    expectedRevisionCount += 1;
    await persistCanonical(repository, event, expectedRevisionCount);
  }
  return expectedRevisionCount;
}

async function loadFixtureEvents() {
  const fixture = JSON.parse(await readFile(FIXTURE_URL, 'utf8'));
  invariant(
    typeof fixture === 'object' &&
      fixture !== null &&
      typeof fixture.catalog === 'object' &&
      fixture.catalog !== null &&
      Array.isArray(fixture.catalog.events),
    'Phase 3 verification fixture was invalid',
  );
  const byId = new Map();
  for (const raw of fixture.catalog.events) {
    const event = deserializeOneMinuteBarEvent(JSON.stringify(raw));
    byId.set(event.eventId, event);
  }
  return byId;
}

function requireFixtureEvent(events, eventId) {
  const event = events.get(eventId);
  invariant(event !== undefined, 'Required Phase 3 verification fixture event was missing');
  return event;
}

async function selectedCapture() {
  const result = await repositoryPool.query(
    `SELECT run_id, state, configuration_version, start_position::text,
            cursor_position::text, stop_position::text, capture_active,
            claim_fence::text
     FROM signal_runs
     WHERE source_kind = 'live_journal' AND capture_active`,
  );
  invariant(result.rows.length <= 1, 'Multiple live capture owners were persisted');
  return result.rows[0];
}

async function runByConfiguration(configurationVersion) {
  const result = await repositoryPool.query(
    `SELECT run_id, state, configuration_version, start_position::text,
            cursor_position::text, stop_position::text, capture_active,
            claim_fence::text
     FROM signal_runs
     WHERE source_kind = 'live_journal' AND configuration_version = $1`,
    [configurationVersion],
  );
  invariant(result.rows.length <= 1, 'Configuration selected more than one live run');
  return result.rows[0];
}

async function runById(runId) {
  const result = await repositoryPool.query(
    `SELECT run_id, state, configuration_version, start_position::text,
            cursor_position::text, stop_position::text, capture_active,
            claim_fence::text
     FROM signal_runs
     WHERE run_id = $1`,
    [runId],
  );
  invariant(result.rows.length <= 1, 'Run identifier selected more than one live run');
  return result.rows[0];
}

async function waitForCapture(input) {
  return waitFor(
    `${input.configurationVersion} capture`,
    selectedCapture,
    (row) =>
      row !== undefined &&
      row.state === 'active' &&
      row.configuration_version === input.configurationVersion &&
      row.start_position === input.startPosition &&
      row.cursor_position === input.cursorPosition &&
      row.capture_active === true,
    input.runtime,
  );
}

async function waitForCursor(input) {
  return waitFor(
    `${input.configurationVersion} cursor`,
    () => runById(input.runId),
    (row) =>
      row !== undefined &&
      row.run_id === input.runId &&
      row.cursor_position === input.cursorPosition &&
      row.capture_active === true,
    input.runtime,
  );
}

async function assertReenabledWithoutBackfill(input) {
  const result = await repositoryPool.query(
    `SELECT run.state, run.start_position::text, run.cursor_position::text,
            run.capture_active,
       (SELECT count(*)::integer
          FROM market_data_canonical_revisions WHERE run_id = $1) AS owned_revisions,
       (SELECT count(*)::integer
          FROM signal_run_transitions WHERE run_id = $1) AS owned_transitions,
       (SELECT count(*)::integer
          FROM market_data_canonical_revisions WHERE new_event_id = $2) AS gap_revisions,
       (SELECT count(*)::integer
          FROM signal_run_transitions AS transition
          JOIN signal_evaluations AS evaluation USING (evaluation_id)
          WHERE transition.run_id = $1 AND evaluation.evaluation_event_id = $2)
            AS gap_evaluations,
       (SELECT count(*)::integer
          FROM signal_run_bootstrap_events
          WHERE run_id = $1 AND event_id = $2 AND evidence_only) AS gap_bootstrap_events,
       (SELECT first_evaluation_bar_start
          FROM signal_run_boundaries
          WHERE run_id = $1 AND instrument_symbol = 'AAPL') AS aapl_boundary
     FROM signal_runs AS run
     WHERE run.run_id = $1`,
    [input.runId, input.uncapturedEventId],
  );
  const row = result.rows[0];
  invariant(
    result.rows.length === 1 &&
      row.state === 'active' &&
      row.start_position === String(EXPECTED_TOTAL_REVISION_COUNT) &&
      row.cursor_position === input.expectedCursorPosition &&
      row.capture_active === true &&
      row.owned_revisions === input.expectedOwnedWork &&
      row.owned_transitions === input.expectedOwnedWork &&
      row.gap_revisions === 0 &&
      row.gap_evaluations === 0 &&
      row.gap_bootstrap_events === 1 &&
      row.aapl_boundary instanceof Date &&
      row.aapl_boundary.toISOString() === input.firstEligibleBarStart,
    'Re-enabled monitoring resumed or backfilled across the uncaptured interval',
  );
}

async function assertRunEvidence(runId, expectedRevisionCount) {
  const result = await repositoryPool.query(
    `WITH associated AS (
       SELECT DISTINCT evaluation_id
       FROM signal_run_transitions
       WHERE run_id = $1
     ), evidence_counts AS (
       SELECT associated.evaluation_id, count(evidence.event_id)::integer AS evidence_count
       FROM associated
       JOIN signal_evaluation_evidence AS evidence USING (evaluation_id)
       GROUP BY associated.evaluation_id
     )
     SELECT
       (SELECT count(*)::integer FROM market_data_canonical_revisions WHERE run_id = $1)
         AS revision_count,
       (SELECT count(*)::integer FROM signal_run_transitions WHERE run_id = $1)
         AS transition_count,
       (SELECT count(*)::integer FROM associated) AS evaluation_count,
       (SELECT count(*)::integer FROM evidence_counts WHERE evidence_count = 4)
         AS complete_evidence_count,
       (SELECT count(*)::integer
          FROM signal_run_transitions WHERE run_id = $1 AND occurrence_id IS NOT NULL)
         AS occurrence_count`,
    [runId],
  );
  const row = result.rows[0];
  invariant(row !== undefined, 'Run evidence aggregate was unavailable');
  invariant(row.revision_count === expectedRevisionCount, 'Run revision ownership was incomplete');
  invariant(
    row.transition_count === expectedRevisionCount &&
      row.evaluation_count === expectedRevisionCount &&
      row.complete_evidence_count === expectedRevisionCount,
    'Run cursor advanced without exact persisted evaluation evidence',
  );
  invariant(row.occurrence_count >= 1, 'Synthetic live run did not persist a fired occurrence');
}

async function assertWriterCapability(runId) {
  const result = await repositoryPool.query(
    `SELECT capability.capability_state, capability.revision_contract_version,
            capability.freshness_threshold_ms,
            capability.data_quality_policy_version,
            capability.retired_at,
            run.freshness_threshold_ms AS run_freshness_threshold_ms,
            run.data_quality_policy_version AS run_data_quality_policy_version
     FROM market_data_writer_capabilities AS capability
     JOIN signal_runs AS run ON run.run_id = $2
     WHERE capability.session_id = $1`,
    [PAPER_SESSION_ID, runId],
  );
  const row = result.rows[0];
  invariant(
    row !== undefined &&
      row.capability_state === 'accepted' &&
      row.revision_contract_version === 'daily-trader.market-data.canonical-revision.v1' &&
      row.freshness_threshold_ms === row.run_freshness_threshold_ms &&
      row.data_quality_policy_version === row.run_data_quality_policy_version &&
      row.retired_at === null,
    'Live cutover was not backed by a compatible paper-writer capability',
  );
}

async function assertExpiredWriterCommitFence() {
  const repository = new MarketDataRepository(repositoryPool, {
    freshnessThresholdMs: 120_000,
    writerCapabilityLeaseMs: 3_000,
  });
  const event = createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: '2026-07-13T13:39:00Z',
    receivedAt: '2026-07-13T13:40:00.100Z',
    processedAt: '2026-07-13T13:40:00.200Z',
    open: '107',
    high: '109',
    low: '106',
    close: '108',
    volume: '450',
  });
  const lockClient = await repositoryPool.connect();
  let lockTransactionOpen = false;
  let sessionOpen = false;
  let pendingPersistence;
  try {
    await repository.createIngestionSession({
      sessionId: EXPIRING_PAPER_SESSION_ID,
      mode: 'paper',
      configurationVersion: 'phase3-expiring-writer-v1',
      startedAt: '2026-07-13T13:29:00.000Z',
    });
    sessionOpen = true;
    await lockClient.query('BEGIN');
    lockTransactionOpen = true;
    await lockClient.query(
      `SELECT next_position
       FROM market_data_canonical_revision_counter
       WHERE singleton
       FOR UPDATE`,
    );
    pendingPersistence = repository.persistEntry({
      ...eventEntry(event),
      sessionId: EXPIRING_PAPER_SESSION_ID,
    });
    await waitFor(
      'expiring writer counter-lock wait',
      async () => {
        const result = await repositoryPool.query(
          `SELECT count(*)::integer AS waiters
           FROM pg_stat_activity
           WHERE datname = current_database()
             AND pid <> pg_backend_pid()
             AND wait_event_type = 'Lock'
             AND query LIKE '%market-data:lock-canonical-revision-counter%'`,
        );
        return result.rows[0]?.waiters;
      },
      (waiters) => typeof waiters === 'number' && waiters >= 1,
    );
    await delay(3_500);
    await lockClient.query('COMMIT');
    lockTransactionOpen = false;

    let rejected;
    try {
      await pendingPersistence;
    } catch (error) {
      rejected = error;
    }
    invariant(
      rejected instanceof MarketDataPersistenceError && rejected.code === 'query_failed',
      'A writer whose lease expired at the counter lock was not fenced at commit',
    );
    const residue = await repositoryPool.query(
      `SELECT
         (SELECT count(*)::integer FROM market_data_event_ledger WHERE event_id = $1)
           AS ledger_count,
         (SELECT count(*)::integer FROM market_data_one_minute_bars WHERE event_id = $1)
           AS canonical_count,
         (SELECT count(*)::integer FROM market_data_canonical_revisions WHERE new_event_id = $1)
           AS revision_count`,
      [event.eventId],
    );
    invariant(
      residue.rows[0]?.ledger_count === 0 &&
        residue.rows[0]?.canonical_count === 0 &&
        residue.rows[0]?.revision_count === 0,
      'Expired-writer fencing did not roll back the complete canonical transaction',
    );
  } finally {
    if (lockTransactionOpen) await lockClient.query('ROLLBACK').catch(() => undefined);
    lockClient.release();
    if (pendingPersistence !== undefined) await pendingPersistence.catch(() => undefined);
    if (sessionOpen) {
      await repository.closeIngestionSession(EXPIRING_PAPER_SESSION_ID, '2026-07-13T13:40:00.000Z');
    }
  }
}

async function assertDisabledState(initialRunId, rolloverRunId) {
  const result = await repositoryPool.query(
    `SELECT
       (SELECT count(*)::integer FROM signal_runs WHERE capture_active) AS captures,
       (SELECT state FROM signal_runs WHERE run_id = $1) AS initial_state,
       (SELECT cursor_position::text FROM signal_runs WHERE run_id = $1) AS initial_cursor,
       (SELECT stop_position::text FROM signal_runs WHERE run_id = $1) AS initial_stop,
       (SELECT state FROM signal_runs WHERE run_id = $2) AS rollover_state,
       (SELECT cursor_position::text FROM signal_runs WHERE run_id = $2) AS rollover_cursor,
       (SELECT stop_position::text FROM signal_runs WHERE run_id = $2) AS rollover_stop,
       (SELECT lifecycle FROM signal_worker_status WHERE singleton) AS lifecycle,
       (SELECT backlog_count::text FROM signal_worker_status WHERE singleton) AS backlog,
       (SELECT revision_gap_detected FROM signal_worker_status WHERE singleton) AS gap,
       (SELECT last_evaluated_bar_start FROM signal_worker_status WHERE singleton)
         AS last_evaluated_bar_start`,
    [initialRunId, rolloverRunId],
  );
  const row = result.rows[0];
  invariant(
    row !== undefined &&
      row.captures === 0 &&
      row.initial_state === 'completed' &&
      row.initial_cursor === String(EXPECTED_INITIAL_REVISION_COUNT) &&
      row.initial_stop === String(EXPECTED_INITIAL_REVISION_COUNT) &&
      row.rollover_state === 'completed' &&
      row.rollover_cursor === String(EXPECTED_TOTAL_REVISION_COUNT) &&
      row.rollover_stop === String(EXPECTED_TOTAL_REVISION_COUNT) &&
      row.lifecycle === 'disabled' &&
      row.backlog === '0' &&
      row.gap === false &&
      row.last_evaluated_bar_start instanceof Date,
    'Disabled worker did not durably drain and close the captured runs',
  );
}

function assertTerminalStatus(output, rolloverRunId, fixtureEvents) {
  for (const expected of [
    'LIVE SIGNAL OBSERVATIONS — not recommendations or position actions',
    `run: ${rolloverRunId}`,
    'worker: disabled',
    'run state: completed',
    'revision backlog: 0',
    `configuration version: ${ROLLOVER_CONFIGURATION_VERSION}`,
    'AAPL/XNAS — IEX single-exchange observation',
    'SPY/ARCX — IEX single-exchange observation',
    'canonical revision schema: daily-trader.market-data.canonical-revision.v1',
  ]) {
    invariant(output.includes(expected), `Terminal signal status omitted: ${expected}`);
  }
  for (const eventId of fixtureEvents.keys()) {
    invariant(!output.includes(eventId), 'Terminal signal status exposed an internal event ID');
  }
}

const databaseUrl = requireVerificationDatabase();
const repositoryPool = createPgMarketDataPool({
  connectionString: databaseUrl,
  connectionTimeoutMs: 5_000,
  statementTimeoutMs: 5_000,
  maximumConnections: 5,
});
const marketRepository = new MarketDataRepository(repositoryPool, {
  freshnessThresholdMs: 120_000,
  writerCapabilityLeaseMs: 90_000,
});
const workers = new Set();
let paperSessionOpen = false;
let failure;

try {
  const fixtureEvents = await loadFixtureEvents();
  const warmupEvents = [
    '8f3335c09b6a78c689c7928b6327cbe41f1393465314d997226fec11bcc64ac8',
    'cc62c70bfa552e0a86f160445e15122a88d989926f91f9092c49d57d5f9c1f06',
    '4a69be67b877245c80d6bbb3578fc599f36c6cf9021a6e14ce76158bdc1da202',
    '725b69f79b88473fa1727ab2108303ce41119010d9e5100afd3a53dc96d46069',
    '449924f88dbf2804c55c0b39bc9bdeb4f660cb9af5f45f1ae516c78bee4a327d',
    '39a226d3f4d0b0bf0a7382f151d75094bdbd1f8944ee9aa8fe654095220b3d3c',
  ].map((eventId) => requireFixtureEvent(fixtureEvents, eventId));
  const initialFirstBatch = [
    '2324aa349a64d3b992401b88489c279a6ea03ff31911d3d97726584b7d587bae',
    '4d33d17e62fff64ea424120efb3b1ca26866e2a63151ac6b56436be8c60af219',
  ].map((eventId) => requireFixtureEvent(fixtureEvents, eventId));
  const initialRestartBatch = [
    'c90fd3c605698dd01f95f264096374c5d3183eca29f3840f53d671eb1f6e5b50',
    'fcd9fb2e74b5f1adf44062379f6a0a882da4d74d61bbe18e9ce5a518a788267c',
    '244edb5b893bad2ed89c660143b4780a18868a0427628498612d1bd295422db8',
  ].map((eventId) => requireFixtureEvent(fixtureEvents, eventId));
  const rolloverFirstBatch = [
    requireFixtureEvent(
      fixtureEvents,
      'f0166b6f986f9ce78687ca74d8912a15b4c50181f15c25a5663cf22e67ba5e07',
    ),
    createOneMinuteBarEvent({
      symbol: 'SPY',
      venue: 'ARCX',
      providerTimestamp: '2026-07-13T13:35:00Z',
      receivedAt: '2026-07-13T13:36:00.200Z',
      processedAt: '2026-07-13T13:36:00.300Z',
      open: '498',
      high: '501',
      low: '497',
      close: '500',
      volume: '300',
    }),
  ];
  const rolloverDrainBatch = [
    createOneMinuteBarEvent({
      symbol: 'AAPL',
      venue: 'XNAS',
      providerTimestamp: '2026-07-13T13:37:00Z',
      receivedAt: '2026-07-13T13:38:00.100Z',
      processedAt: '2026-07-13T13:38:00.200Z',
      open: '101',
      high: '107',
      low: '99',
      close: '106',
      volume: '600',
    }),
    createOneMinuteBarEvent({
      symbol: 'SPY',
      venue: 'ARCX',
      providerTimestamp: '2026-07-13T13:36:00Z',
      receivedAt: '2026-07-13T13:37:00.200Z',
      processedAt: '2026-07-13T13:37:00.300Z',
      open: '500',
      high: '501',
      low: '499',
      close: '500',
      volume: '100',
    }),
  ];
  const afterDisableEvent = createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: '2026-07-13T13:38:00Z',
    receivedAt: '2026-07-13T13:39:00.100Z',
    processedAt: '2026-07-13T13:39:00.200Z',
    open: '106',
    high: '108',
    low: '105',
    close: '107',
    volume: '400',
  });
  const afterReenableEvent = createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: '2026-07-13T13:39:00Z',
    receivedAt: '2026-07-13T13:40:00.100Z',
    processedAt: '2026-07-13T13:40:00.200Z',
    open: '107',
    high: '113',
    low: '106',
    close: '112',
    volume: '1000',
  });

  await marketRepository.createIngestionSession({
    sessionId: PAPER_SESSION_ID,
    mode: 'paper',
    configurationVersion: 'phase3-service-verification-v1',
    startedAt: '2026-07-13T13:29:00.000Z',
  });
  paperSessionOpen = true;
  for (const event of warmupEvents) {
    await persistCanonical(marketRepository, event, 0);
  }

  let worker = startProcess(WORKER_PATH, [], childEnvironment({}));
  workers.add(worker);
  const initialCapture = await waitForCapture({
    configurationVersion: INITIAL_CONFIGURATION_VERSION,
    startPosition: '0',
    cursorPosition: '0',
    runtime: worker,
  });
  const initialRunId = initialCapture.run_id;
  invariant(typeof initialRunId === 'string', 'Initial live run identifier was unavailable');
  await assertWriterCapability(initialRunId);
  await assertExpiredWriterCommitFence();

  await persistBatch(marketRepository, initialFirstBatch, 0);
  await waitForCursor({
    configurationVersion: INITIAL_CONFIGURATION_VERSION,
    runId: initialRunId,
    cursorPosition: '2',
    runtime: worker,
  });
  await stopProcess(worker, 'Initial Phase 3 signal worker');
  workers.delete(worker);

  await persistBatch(marketRepository, initialRestartBatch, 2);
  worker = startProcess(WORKER_PATH, [], childEnvironment({}));
  workers.add(worker);
  const resumed = await waitForCursor({
    configurationVersion: INITIAL_CONFIGURATION_VERSION,
    runId: initialRunId,
    cursorPosition: String(EXPECTED_INITIAL_REVISION_COUNT),
    runtime: worker,
  });
  invariant(
    BigInt(resumed.claim_fence) > BigInt(initialCapture.claim_fence),
    'Same-configuration restart did not acquire a new fenced claim',
  );
  await assertRunEvidence(initialRunId, EXPECTED_INITIAL_REVISION_COUNT);
  await stopProcess(worker, 'Restarted Phase 3 signal worker');
  workers.delete(worker);

  const rolloverEnvironment = childEnvironment({
    SIGNAL_CONFIGURATION_VERSION: ROLLOVER_CONFIGURATION_VERSION,
    SIGNAL_VOLUME_MULTIPLIER: '2',
  });
  worker = startProcess(WORKER_PATH, [], rolloverEnvironment);
  workers.add(worker);
  const rolloverCapture = await waitForCapture({
    configurationVersion: ROLLOVER_CONFIGURATION_VERSION,
    startPosition: String(EXPECTED_INITIAL_REVISION_COUNT),
    cursorPosition: String(EXPECTED_INITIAL_REVISION_COUNT),
    runtime: worker,
  });
  const rolloverRunId = rolloverCapture.run_id;
  invariant(
    typeof rolloverRunId === 'string' && rolloverRunId !== initialRunId,
    'Configuration rollover did not create a distinct run',
  );
  const completedInitial = await runByConfiguration(INITIAL_CONFIGURATION_VERSION);
  invariant(
    completedInitial?.state === 'completed' &&
      completedInitial.stop_position === String(EXPECTED_INITIAL_REVISION_COUNT) &&
      completedInitial.cursor_position === String(EXPECTED_INITIAL_REVISION_COUNT) &&
      completedInitial.capture_active === false,
    'Configuration rollover did not freeze and close its predecessor',
  );
  await assertWriterCapability(rolloverRunId);

  await persistBatch(marketRepository, rolloverFirstBatch, EXPECTED_INITIAL_REVISION_COUNT);
  await waitForCursor({
    configurationVersion: ROLLOVER_CONFIGURATION_VERSION,
    runId: rolloverRunId,
    cursorPosition: '7',
    runtime: worker,
  });
  await stopProcess(worker, 'Rollover Phase 3 signal worker');
  workers.delete(worker);

  await persistBatch(marketRepository, rolloverDrainBatch, 7);
  const disabledEnvironment = childEnvironment({
    SIGNAL_MODE: 'disabled',
    SIGNAL_CONFIGURATION_VERSION: ROLLOVER_CONFIGURATION_VERSION,
    SIGNAL_VOLUME_MULTIPLIER: '2',
  });
  worker = startProcess(WORKER_PATH, [], disabledEnvironment);
  workers.add(worker);
  await waitFor(
    'bounded disabled-mode drain',
    async () => {
      const run = await runByConfiguration(ROLLOVER_CONFIGURATION_VERSION);
      const status = await repositoryPool.query(
        `SELECT lifecycle, backlog_count::text AS backlog_count
         FROM signal_worker_status WHERE singleton`,
      );
      return { run, status: status.rows[0] };
    },
    ({ run, status }) =>
      run?.state === 'completed' &&
      run.cursor_position === String(EXPECTED_TOTAL_REVISION_COUNT) &&
      run.stop_position === String(EXPECTED_TOTAL_REVISION_COUNT) &&
      run.capture_active === false &&
      status?.lifecycle === 'disabled' &&
      status.backlog_count === '0',
    worker,
  );
  await assertRunEvidence(rolloverRunId, EXPECTED_ROLLOVER_REVISION_COUNT);
  await assertDisabledState(initialRunId, rolloverRunId);

  const statusOutput = await runProcess(
    STATUS_PATH,
    ['status'],
    disabledEnvironment,
    'Phase 3 live terminal status',
  );
  assertTerminalStatus(statusOutput, rolloverRunId, fixtureEvents);
  process.stdout.write(statusOutput);

  await marketRepository.renewWriterCapability(PAPER_SESSION_ID);
  const afterDisableResult = await marketRepository.persistEntry(eventEntry(afterDisableEvent));
  invariant(afterDisableResult.canonicalized, 'Post-disable market bar was not canonicalized');
  const postDisableCounts = await repositoryPool.query(
    `SELECT
       (SELECT count(*)::text FROM market_data_canonical_revisions) AS revision_count,
       (SELECT next_position::text FROM market_data_canonical_revision_counter WHERE singleton)
         AS next_position,
       (SELECT count(*)::integer FROM signal_runs WHERE capture_active) AS capture_count`,
  );
  invariant(
    postDisableCounts.rows[0]?.revision_count === String(EXPECTED_TOTAL_REVISION_COUNT) &&
      postDisableCounts.rows[0]?.next_position === String(EXPECTED_TOTAL_REVISION_COUNT + 1) &&
      postDisableCounts.rows[0]?.capture_count === 0,
    'Canonical commits after disable accrued signal-run debt',
  );

  await stopProcess(worker, 'Disabled Phase 3 signal worker');
  workers.delete(worker);

  worker = startProcess(WORKER_PATH, [], rolloverEnvironment);
  workers.add(worker);
  const reenabledCapture = await waitForCapture({
    configurationVersion: ROLLOVER_CONFIGURATION_VERSION,
    startPosition: String(EXPECTED_TOTAL_REVISION_COUNT),
    cursorPosition: String(EXPECTED_TOTAL_REVISION_COUNT),
    runtime: worker,
  });
  const reenabledRunId = reenabledCapture.run_id;
  invariant(
    typeof reenabledRunId === 'string' && reenabledRunId !== rolloverRunId,
    'Re-enabling after an uncaptured interval did not create a fresh live run',
  );
  await assertReenabledWithoutBackfill({
    runId: reenabledRunId,
    uncapturedEventId: afterDisableEvent.eventId,
    expectedCursorPosition: String(EXPECTED_TOTAL_REVISION_COUNT),
    expectedOwnedWork: 0,
    firstEligibleBarStart: afterReenableEvent.barStart,
  });

  await persistCanonical(marketRepository, afterReenableEvent, EXPECTED_FINAL_REVISION_COUNT);
  await waitForCursor({
    configurationVersion: ROLLOVER_CONFIGURATION_VERSION,
    runId: reenabledRunId,
    cursorPosition: String(EXPECTED_FINAL_REVISION_COUNT),
    runtime: worker,
  });
  await assertReenabledWithoutBackfill({
    runId: reenabledRunId,
    uncapturedEventId: afterDisableEvent.eventId,
    expectedCursorPosition: String(EXPECTED_FINAL_REVISION_COUNT),
    expectedOwnedWork: EXPECTED_REENABLED_REVISION_COUNT,
    firstEligibleBarStart: afterReenableEvent.barStart,
  });
  await assertRunEvidence(reenabledRunId, EXPECTED_REENABLED_REVISION_COUNT);
  await stopProcess(worker, 'Re-enabled Phase 3 signal worker');
  workers.delete(worker);

  await marketRepository.closeIngestionSession(PAPER_SESSION_ID, '2026-07-13T13:41:00.000Z');
  paperSessionOpen = false;

  process.stdout.write(
    `${JSON.stringify({
      event: 'phase3.live_service_verification.passed',
      initialRunId,
      rolloverRunId,
      reenabledRunId,
      canonicalRevisionCount: EXPECTED_FINAL_REVISION_COUNT,
      transitionCount: EXPECTED_FINAL_REVISION_COUNT,
      sameConfigurationRestart: 'passed',
      expiredWriterCommitFence: 'passed',
      configurationRollover: 'passed',
      boundedDisableDrain: 'passed',
      postDisableDebt: 'none',
      reenableAfterUncapturedInterval: 'passed',
      uncapturedIntervalBackfill: 'none',
      providerConnectionOpened: false,
      brokerConnectionOpened: false,
    })}\n`,
  );
} catch (error) {
  failure = error instanceof Error ? error : new Error('Phase 3 live verification failed');
} finally {
  for (const worker of workers) {
    if (!worker.exited) worker.child.kill('SIGKILL');
  }
  await Promise.all([...workers].map((worker) => worker.done));

  if (paperSessionOpen) {
    try {
      await marketRepository.closeIngestionSession(PAPER_SESSION_ID, '2026-07-13T13:40:00.000Z');
    } catch {
      failure ??= new Error('Phase 3 live writer cleanup failed');
    }
  }
  try {
    await repositoryPool.end();
  } catch {
    failure ??= new Error('Phase 3 live database-pool cleanup failed');
  }
}

if (failure !== undefined) {
  process.stderr.write(
    `${JSON.stringify({ event: 'phase3.live_service_verification.failed', message: failure.message })}\n`,
  );
  process.exitCode = 1;
}
