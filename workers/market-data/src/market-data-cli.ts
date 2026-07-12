import {
  loadConfig,
  loadOptionalEnvironmentFile,
  type ApplicationConfig,
} from '@daily-trader/config';
import {
  createUtcTimestamp,
  FixedClock,
  type Clock,
  type UtcTimestamp,
} from '@daily-trader/domain';
import { deserializeOneMinuteBarEvent, type GapState } from '@daily-trader/market-data';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createRedisCommandClient,
  RedisMarketDataConsumer,
  RedisMarketDataPublisher,
  type RedisCommandClient,
  type RedisEntryHandler,
} from './delivery/redis-stream.js';
import {
  createPgMarketDataPool,
  createRedisPersistenceHandler,
  MarketDataRepository,
  type LatestPersistedBar,
  type SqlPool,
  type SqlRow,
} from './persistence/index.js';
import {
  replayVerifiedRecording,
  verifyPortableRecording,
  type VerifiedMarketDataRecording,
} from './replay/index.js';
import { buildMarketStatusModel, renderMarketStatus } from './status/index.js';
import type { MarketStatusRepositorySnapshot, OperationalHealth } from './status/types.js';
import { SystemClock } from './system-clock.js';

const DEFAULT_RECORDING_URL = new URL(
  '../fixtures/recordings/synthetic-aapl-spy-session-v1.json',
  import.meta.url,
);
const REPLAY_PERSIST_TIMEOUT_MS = 15_000;
const REPLAY_READ_BLOCK_MS = 500;
const MAX_RECORDING_BYTES = 16 * 1024 * 1024;
const REPLAY_COUNT_SQL = `
  /* market-data:count-replay-events */
  SELECT COUNT(DISTINCT event_id)::text AS persisted_count
  FROM market_data_session_events
  WHERE session_id = $1 AND event_id::text = ANY($2::text[])
`;

type MarketDataCliCommand =
  | Readonly<{ name: 'recording:verify'; path: string | URL }>
  | Readonly<{ name: 'replay'; path: string | URL }>
  | Readonly<{ name: 'status' }>;

interface CliIo {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

interface ReplayPersistenceWaitDependencies {
  readonly consumer: Pick<RedisMarketDataConsumer, 'process' | 'readNew'>;
  readonly persistEntry: RedisEntryHandler;
  countPersisted(eventIds: readonly string[]): Promise<number>;
  nowMilliseconds(): number;
}

class MarketDataCliError extends Error {}

function defaultRecordingPath(): URL {
  return DEFAULT_RECORDING_URL;
}

export function parseMarketDataCliArguments(argv: readonly string[]): MarketDataCliCommand {
  const [command, path, extra] = argv;
  if (extra !== undefined) {
    throw new MarketDataCliError('invalid arguments');
  }
  switch (command) {
    case 'recording:verify':
    case 'replay':
      return Object.freeze({
        name: command,
        path: path === undefined ? defaultRecordingPath() : resolve(path),
      });
    case 'status':
      if (path !== undefined) {
        throw new MarketDataCliError('invalid arguments');
      }
      return Object.freeze({ name: command });
    case undefined:
    default:
      throw new MarketDataCliError('unknown command');
  }
}

export function summarizeVerifiedRecording(
  recording: VerifiedMarketDataRecording,
): Readonly<Record<string, unknown>> {
  const manifest = recording.manifest;
  return Object.freeze({
    event: 'market_data.recording.verified',
    formatVersion: manifest.formatVersion,
    eventSchemaVersion: manifest.eventSchemaVersion,
    sourceSessionId: manifest.sourceSessionId,
    instruments: manifest.instruments,
    provider: manifest.provider,
    feed: manifest.feed,
    entitlement: manifest.entitlement,
    delayMilliseconds: manifest.delayMilliseconds,
    sessionStart: manifest.sessionStart,
    sessionEnd: manifest.sessionEnd,
    eventCount: manifest.eventCount,
    configurationVersion: manifest.configurationVersion,
    freshnessThresholdMs: manifest.freshnessThresholdMs,
    sourceKind: manifest.sourceMetadata.kind,
    checksum: manifest.checksum,
  });
}

function latestBySymbol(
  bars: readonly LatestPersistedBar[],
): MarketStatusRepositorySnapshot['latest'] {
  let AAPL: MarketStatusRepositorySnapshot['latest']['AAPL'];
  let SPY: MarketStatusRepositorySnapshot['latest']['SPY'];
  for (const bar of bars) {
    switch (bar.event.instrument.symbol) {
      case 'AAPL':
        AAPL = bar.event;
        break;
      case 'SPY':
        SPY = bar.event;
        break;
    }
  }
  return Object.freeze({ AAPL, SPY });
}

export function overallGapState(bars: readonly LatestPersistedBar[]): GapState {
  if (bars.some((bar) => bar.gapState === 'gapped')) {
    return 'gapped';
  }
  if (bars.length === 2 && bars.every((bar) => bar.gapState === 'complete')) {
    return 'complete';
  }
  return 'unknown';
}

export function latestReceivedAtFromCanonicalEvents(
  canonicalEvents: readonly string[],
): UtcTimestamp | undefined {
  let latest: UtcTimestamp | undefined;
  for (const canonicalJson of canonicalEvents) {
    const receivedAt = deserializeOneMinuteBarEvent(canonicalJson).receivedAt;
    if (latest === undefined || receivedAt > latest) {
      latest = receivedAt;
    }
  }
  return latest;
}

function repositorySnapshot(
  bars: readonly LatestPersistedBar[],
  redisDelivery: OperationalHealth,
  postgresPersistence: OperationalHealth,
): MarketStatusRepositorySnapshot {
  return Object.freeze({
    latest: latestBySymbol(bars),
    redisDelivery,
    postgresPersistence,
  });
}

function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new MarketDataCliError('operation timed out')),
      timeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolvePromise(value);
      },
      () => {
        clearTimeout(timeout);
        reject(new MarketDataCliError('operation failed'));
      },
    );
  });
}

async function closeAll(
  operations: readonly (() => Promise<unknown>)[],
  timeoutMs: number,
): Promise<void> {
  let failed = false;
  for (const operation of operations) {
    try {
      await bounded(Promise.resolve().then(operation), timeoutMs);
    } catch {
      failed = true;
    }
  }
  if (failed) {
    throw new MarketDataCliError('shutdown failed');
  }
}

export async function waitForPersistedReplay(
  dependencies: ReplayPersistenceWaitDependencies,
  targetSessionId: string,
  eventIds: readonly string[],
  timeoutMs = REPLAY_PERSIST_TIMEOUT_MS,
): Promise<void> {
  const expected = new Set(eventIds);
  if (expected.size === 0 || expected.size !== eventIds.length || timeoutMs < 1) {
    throw new MarketDataCliError('invalid persistence wait');
  }
  const seen = new Set<string>();
  const deadline = dependencies.nowMilliseconds() + timeoutMs;
  while (dependencies.nowMilliseconds() < deadline) {
    const remaining = deadline - dependencies.nowMilliseconds();
    const entries = await dependencies.consumer.readNew(
      Math.max(1, Math.min(REPLAY_READ_BLOCK_MS, remaining)),
    );
    await dependencies.consumer.process(entries, async (entry): Promise<void> => {
      if (entry.sessionId === targetSessionId) {
        if (!expected.has(entry.eventId)) {
          throw new MarketDataCliError('unexpected replay event');
        }
        seen.add(entry.eventId);
      }
      await dependencies.persistEntry(entry);
    });
    const persisted = await dependencies.countPersisted(eventIds);
    if (seen.size === expected.size && persisted === expected.size) {
      return;
    }
  }
  throw new MarketDataCliError('persistence wait timed out');
}

export function assertReplaySessionEvents(
  recording: VerifiedMarketDataRecording,
  persistedCanonicalEvents: readonly string[],
): void {
  if (
    persistedCanonicalEvents.length !== recording.events.length ||
    persistedCanonicalEvents.some(
      (canonicalJson, index) => canonicalJson !== recording.events[index]?.canonicalJson,
    )
  ) {
    throw new MarketDataCliError('replay session contains unexpected events or ordering');
  }
}

function createReplaySessionId(recording: VerifiedMarketDataRecording): string {
  return `replay-${recording.manifest.checksum.slice(0, 48)}`;
}

function createConsumerName(): string {
  return `replay-${randomUUID()}`;
}

function createPool(config: ApplicationConfig): SqlPool {
  return createPgMarketDataPool({
    connectionString: config.services.database.url,
    connectionTimeoutMs: config.services.database.connectionTimeoutMs,
  });
}

function createRedisClient(config: ApplicationConfig): RedisCommandClient {
  return createRedisCommandClient(
    config.services.redis.url,
    config.services.redis.connectionTimeoutMs,
    config.marketData.queueCapacity,
  );
}

async function countPersistedEvents(
  pool: SqlPool,
  sessionId: string,
  eventIds: readonly string[],
): Promise<number> {
  type CountRow = SqlRow & { readonly persisted_count: unknown };
  const result = await pool.query<CountRow>(REPLAY_COUNT_SQL, [sessionId, eventIds]);
  const value = result.rows[0]?.persisted_count;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new MarketDataCliError('invalid persistence count');
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new MarketDataCliError('invalid persistence count');
  }
  return count;
}

async function readVerifiedRecording(path: string | URL): Promise<VerifiedMarketDataRecording> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_RECORDING_BYTES) {
    throw new MarketDataCliError('recording size invalid');
  }
  return verifyPortableRecording(await readFile(path, 'utf8'));
}

async function runRecordingVerify(path: string | URL): Promise<string> {
  const recording = await readVerifiedRecording(path);
  return `${JSON.stringify(summarizeVerifiedRecording(recording))}\n`;
}

async function runReplay(path: string | URL, clock: Clock): Promise<string> {
  const recording = await readVerifiedRecording(path);
  loadOptionalEnvironmentFile();
  const config = loadConfig();
  const targetSessionId = createReplaySessionId(recording);
  const pool = createPool(config);
  const repository = new MarketDataRepository(pool, {
    freshnessThresholdMs: recording.manifest.freshnessThresholdMs,
  });
  const publisher = new RedisMarketDataPublisher(createRedisClient(config));
  const consumer = new RedisMarketDataConsumer(createRedisClient(config), createConsumerName(), {
    groupName: createConsumerName(),
    initialStreamId: '$',
  });
  let sessionOpen = false;
  let consumerGroupCreated = false;
  let completed = false;
  let output = '';

  try {
    const replaySession = await repository.ensureReplayIngestionSession({
      sessionId: targetSessionId,
      configurationVersion: recording.manifest.configurationVersion,
      startedAt: clock.now(),
    });
    sessionOpen = replaySession.open;
    await consumer.connect();
    consumerGroupCreated = true;
    await publisher.connect();
    const replayWaitDependencies = {
      consumer,
      persistEntry: createRedisPersistenceHandler(repository),
      countPersisted: (ids: readonly string[]) => countPersistedEvents(pool, targetSessionId, ids),
      nowMilliseconds: Date.now,
    };
    await replayVerifiedRecording(
      recording,
      {
        publish: async (sessionId, event): Promise<string> => {
          const redisEntryId = await publisher.publish(sessionId, event);
          await waitForPersistedReplay(replayWaitDependencies, targetSessionId, [event.eventId]);
          return redisEntryId;
        },
      },
      targetSessionId,
    );

    const replayEvents = await repository.readCanonicalEvents(targetSessionId);
    assertReplaySessionEvents(recording, replayEvents);

    const observedAt = createUtcTimestamp(recording.manifest.sessionEnd);
    const latest = await repository.findLatestBars(observedAt);
    const snapshot = repositorySnapshot(latest, 'healthy', 'healthy');
    const status = buildMarketStatusModel({
      repository: snapshot,
      connection: 'stopped',
      lastSuccessfulEvent: latestReceivedAtFromCanonicalEvents(replayEvents),
      gap: overallGapState(latest),
      clock: new FixedClock(observedAt),
      freshnessThresholdMs: recording.manifest.freshnessThresholdMs,
    });
    output = [
      `MARKET REPLAY | target_session=${targetSessionId} | source_session=${recording.manifest.sourceSessionId} | event_count=${String(recording.manifest.eventCount)} | checksum=${recording.manifest.checksum}`,
      renderMarketStatus(status),
      '',
    ].join('\n');
    completed = true;
  } finally {
    const cleanup: Array<() => Promise<unknown>> = [];
    if (completed && sessionOpen) {
      cleanup.push(async (): Promise<void> => {
        await repository.closeIngestionSession(targetSessionId, clock.now());
        sessionOpen = false;
      });
    }
    if (consumerGroupCreated) {
      cleanup.push(() => consumer.destroyGroup());
    }
    cleanup.push(
      () => publisher.close(),
      () => consumer.close(),
      () => repository.close(),
    );
    await closeAll(cleanup, config.marketData.shutdownTimeoutMs);
  }
  return output;
}

async function pingRedis(client: RedisCommandClient): Promise<OperationalHealth> {
  try {
    if (!client.isOpen) {
      await client.connect();
    }
    return (await client.sendCommand(['PING'])) === 'PONG' ? 'healthy' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function closeRedisClient(client: RedisCommandClient): Promise<void> {
  if (!client.isOpen) {
    return;
  }
  try {
    await client.close();
  } catch {
    client.destroy();
    throw new MarketDataCliError('redis shutdown failed');
  }
}

async function runStatus(clock: Clock): Promise<string> {
  loadOptionalEnvironmentFile();
  const config = loadConfig();
  const observedAt = clock.now();
  const repository = new MarketDataRepository(createPool(config), {
    freshnessThresholdMs: config.marketData.freshnessThresholdMs,
  });
  const redis = createRedisClient(config);
  let redisHealth: OperationalHealth = 'unknown';
  let postgresHealth: OperationalHealth = 'unknown';
  let latest: readonly LatestPersistedBar[] = [];
  let lastSuccessfulEvent: UtcTimestamp | undefined;

  try {
    redisHealth = await pingRedis(redis);
    try {
      latest = await repository.findLatestBars(observedAt);
      lastSuccessfulEvent = await repository.findLastEventReceivedAt();
      postgresHealth = 'healthy';
    } catch {
      latest = [];
      lastSuccessfulEvent = undefined;
      postgresHealth = 'unavailable';
    }
  } finally {
    await closeAll(
      [() => closeRedisClient(redis), () => repository.close()],
      config.marketData.shutdownTimeoutMs,
    );
  }

  const status = buildMarketStatusModel({
    repository: repositorySnapshot(latest, redisHealth, postgresHealth),
    connection: 'disabled',
    lastSuccessfulEvent,
    gap: overallGapState(latest),
    clock: new FixedClock(observedAt),
    freshnessThresholdMs: config.marketData.freshnessThresholdMs,
  });
  return `${renderMarketStatus(status)}\n`;
}

function failureEvent(command: string | undefined): Readonly<Record<string, string>> {
  switch (command) {
    case 'recording:verify':
      return Object.freeze({
        event: 'market_data.recording_verify.failed',
        code: 'MARKET_DATA_RECORDING_VERIFY_FAILED',
      });
    case 'replay':
      return Object.freeze({
        event: 'market_data.replay.failed',
        code: 'MARKET_DATA_REPLAY_FAILED',
      });
    case 'status':
      return Object.freeze({
        event: 'market_data.status.failed',
        code: 'MARKET_DATA_STATUS_FAILED',
      });
    case undefined:
    default:
      return Object.freeze({
        event: 'market_data.cli.usage',
        code: 'MARKET_DATA_CLI_USAGE',
      });
  }
}

export async function runMarketDataCli(
  argv: readonly string[],
  io: CliIo = process,
  clock: Clock = new SystemClock(),
): Promise<number> {
  try {
    const command = parseMarketDataCliArguments(argv);
    const output =
      command.name === 'recording:verify'
        ? await runRecordingVerify(command.path)
        : command.name === 'replay'
          ? await runReplay(command.path, clock)
          : await runStatus(clock);
    io.stdout.write(output);
    return 0;
  } catch {
    io.stderr.write(`${JSON.stringify(failureEvent(argv[0]))}\n`);
    return 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  void runMarketDataCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
