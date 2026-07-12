import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import { FixedClock, createUtcTimestamp, type UtcTimestamp } from '@daily-trader/domain';
import {
  deserializeOneMinuteBarEvent,
  utcEpochMilliseconds,
  type GapState,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import { readFile, writeFile } from 'node:fs/promises';

import {
  RedisDeliveryError,
  RedisMarketDataConsumer,
  RedisMarketDataPublisher,
  createRedisCommandClient,
  type RedisEntryHandler,
} from './delivery/redis-stream.js';
import {
  MarketDataPersistenceError,
  MarketDataRepository,
  createPgMarketDataPool,
  createRedisPersistenceHandler,
  type LatestPersistedBar,
} from './persistence/index.js';
import {
  MarketDataRecordingError,
  MarketDataReplayError,
  UNPACED_REPLAY,
  exportPortableRecording,
  replayVerifiedRecording,
  verifyPortableRecording,
  type VerifiedMarketDataRecording,
} from './replay/index.js';
import { buildMarketStatusModel, renderMarketStatus } from './status/index.js';
import {
  Phase2VerificationError,
  assertPhase2VerificationStateEqual,
  createPhase2VerificationState,
  parsePhase2VerificationState,
  serializePhase2VerificationState,
  type Phase2VerificationErrorCode,
  type Phase2VerificationState,
} from './phase2-verify-support.js';

const RECORDING_URL = new URL(
  '../fixtures/recordings/synthetic-aapl-spy-session-v1.json',
  import.meta.url,
);
const TARGET_SESSION_ID = 'phase2-verify-replay';
const CLEAN_TARGET_SESSION_ID = 'phase2-verify-replay-clean';
const STATE_FILE = /^\/tmp\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const VERIFICATION_RUN_ID = /^v[0-9]+-[0-9]{10,16}$/u;
const DELIVERY_DEADLINE_MS = 15_000;
const POLL_INTERVAL_MS = 50;

type VerificationPass = 'initial' | 'restart';

interface VerificationInputs {
  readonly pass: VerificationPass;
  readonly stateFile: string;
  readonly runId: string;
  readonly config: ReturnType<typeof loadConfig>;
}

interface ConsumerRuntime {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  error: unknown;
  exited: boolean;
}

interface VerificationOutput {
  readonly terminalStatus: string;
  readonly result: Readonly<{
    event: 'phase2.verify.passed';
    pass: VerificationPass;
    targetSessionId: typeof TARGET_SESSION_ID;
    cleanTargetSessionId: typeof CLEAN_TARGET_SESSION_ID;
    replayCount: number;
    cleanReplayCount: number;
    eventCount: number;
    eventIds: readonly string[];
    recordingChecksum: string;
    recordingBytesSha256: string;
    statusSha256: string;
    providerConnectionOpened: false;
    brokerConnectionOpened: false;
  }>;
}

function verificationInputs(): VerificationInputs {
  loadOptionalEnvironmentFile();
  const config = loadConfig();
  const pass = process.env.PHASE2_VERIFY_PASS;
  const stateFile = process.env.PHASE2_VERIFY_STATE_FILE;
  const runId = process.env.PHASE2_VERIFY_RUN_ID;
  if (
    (pass !== 'initial' && pass !== 'restart') ||
    stateFile === undefined ||
    !STATE_FILE.test(stateFile) ||
    runId === undefined ||
    !VERIFICATION_RUN_ID.test(runId) ||
    config.marketData.mode !== 'disabled'
  ) {
    throw new Phase2VerificationError('PHASE2_VERIFY_CONFIGURATION_INVALID');
  }
  return Object.freeze({ pass, stateFile, runId, config });
}

async function readRecording(): Promise<VerifiedMarketDataRecording> {
  let serialized: string;
  try {
    serialized = await readFile(RECORDING_URL, 'utf8');
  } catch {
    throw new Phase2VerificationError('PHASE2_VERIFY_RECORDING_INVALID');
  }
  return verifyPortableRecording(serialized);
}

async function readPriorState(path: string): Promise<Phase2VerificationState> {
  try {
    return parsePhase2VerificationState(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof Phase2VerificationError) {
      throw error;
    }
    throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
  }
}

async function writeInitialState(path: string, state: Phase2VerificationState): Promise<void> {
  try {
    await writeFile(path, serializePhase2VerificationState(state), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  code: Phase2VerificationErrorCode,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Phase2VerificationError(code)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        reject(new Phase2VerificationError(code));
      },
    );
  });
}

function createConsumerRuntime(
  consumer: RedisMarketDataConsumer,
  handler: RedisEntryHandler,
): ConsumerRuntime {
  const runtime: ConsumerRuntime = {
    controller: new AbortController(),
    done: Promise.resolve(),
    error: undefined,
    exited: false,
  };
  const run = consumer.run(runtime.controller.signal, handler);
  const done = run.then(
    () => {
      runtime.exited = true;
    },
    (error: unknown) => {
      runtime.error = error;
      runtime.exited = true;
    },
  );
  return Object.assign(runtime, { done });
}

function assertConsumerHealthy(runtime: ConsumerRuntime): void {
  if (runtime.error !== undefined || (runtime.exited && !runtime.controller.signal.aborted)) {
    throw new Phase2VerificationError('PHASE2_VERIFY_CONSUMER_FAILED');
  }
}

async function waitForDelivery(input: {
  readonly targetSessionId: string;
  readonly repository: MarketDataRepository;
  readonly consumer: ConsumerRuntime;
  readonly publishedEntryIds: ReadonlySet<string>;
  readonly processedEntryIds: ReadonlySet<string>;
  readonly expectedLedgerCount: number;
}): Promise<readonly string[]> {
  const deadline = performance.now() + DELIVERY_DEADLINE_MS;
  while (performance.now() <= deadline) {
    assertConsumerHealthy(input.consumer);
    const canonicalEvents = await input.repository.readCanonicalEvents(input.targetSessionId);
    if (canonicalEvents.length > input.expectedLedgerCount) {
      throw new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH');
    }
    const allPublishedProcessed = [...input.publishedEntryIds].every((entryId) =>
      input.processedEntryIds.has(entryId),
    );
    if (canonicalEvents.length === input.expectedLedgerCount && allPublishedProcessed) {
      return canonicalEvents;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Phase2VerificationError('PHASE2_VERIFY_TIMED_OUT');
}

async function stopConsumer(runtime: ConsumerRuntime, timeoutMs: number): Promise<void> {
  runtime.controller.abort();
  await withDeadline(runtime.done, timeoutMs, 'PHASE2_VERIFY_CLEANUP_FAILED');
  if (runtime.error !== undefined) {
    throw new Phase2VerificationError('PHASE2_VERIFY_CONSUMER_FAILED');
  }
}

function eventIds(canonicalEvents: readonly string[]): readonly string[] {
  return Object.freeze(
    canonicalEvents.map((canonicalJson) => deserializeOneMinuteBarEvent(canonicalJson).eventId),
  );
}

function latestEvents(latestBars: readonly LatestPersistedBar[]): Readonly<{
  AAPL: OneMinuteBarEvent | undefined;
  SPY: OneMinuteBarEvent | undefined;
}> {
  let AAPL: OneMinuteBarEvent | undefined;
  let SPY: OneMinuteBarEvent | undefined;
  for (const bar of latestBars) {
    if (bar.event.instrument.symbol === 'AAPL') {
      AAPL = bar.event;
    } else if (bar.event.instrument.symbol === 'SPY') {
      SPY = bar.event;
    }
  }
  if (AAPL === undefined || SPY === undefined) {
    throw new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH');
  }
  return Object.freeze({ AAPL, SPY });
}

function overallGap(latestBars: readonly LatestPersistedBar[]): GapState {
  if (latestBars.some((bar) => bar.gapState === 'gapped')) {
    return 'gapped';
  }
  if (latestBars.length !== 2 || latestBars.some((bar) => bar.gapState === 'unknown')) {
    return 'unknown';
  }
  return 'complete';
}

function lastReceivedAt(canonicalEvents: readonly string[]): UtcTimestamp {
  const received = canonicalEvents
    .map((canonicalJson) => deserializeOneMinuteBarEvent(canonicalJson).receivedAt)
    .sort((left, right) => utcEpochMilliseconds(left) - utcEpochMilliseconds(right))
    .at(-1);
  if (received === undefined) {
    throw new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH');
  }
  return received;
}

function terminalStatus(
  latestBars: readonly LatestPersistedBar[],
  canonicalEvents: readonly string[],
  observedAt: UtcTimestamp,
  freshnessThresholdMs: number,
): string {
  return renderMarketStatus(
    buildMarketStatusModel({
      repository: Object.freeze({
        latest: latestEvents(latestBars),
        redisDelivery: 'healthy',
        postgresPersistence: 'healthy',
      }),
      connection: 'disconnected',
      lastSuccessfulEvent: lastReceivedAt(canonicalEvents),
      gap: overallGap(latestBars),
      clock: new FixedClock(observedAt),
      freshnessThresholdMs,
    }),
  );
}

async function classifyCleanup(
  operation: () => Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await withDeadline(operation(), timeoutMs, 'PHASE2_VERIFY_CLEANUP_FAILED');
    return false;
  } catch {
    return true;
  }
}

async function executeVerification(): Promise<VerificationOutput> {
  const { pass, stateFile, runId, config } = verificationInputs();
  const streamName = `daily-trader.market-data.verify.${runId}`;
  const groupName = `phase2-verify-${runId}`;
  const consumerName = `phase2-${pass}-${runId}`;
  const recording = await readRecording();
  const priorState = pass === 'restart' ? await readPriorState(stateFile) : undefined;
  const pool = createPgMarketDataPool({
    connectionString: config.services.database.url,
    connectionTimeoutMs: config.services.database.connectionTimeoutMs,
    statementTimeoutMs: config.marketData.shutdownTimeoutMs,
  });
  const repository = new MarketDataRepository(pool, {
    freshnessThresholdMs: recording.manifest.freshnessThresholdMs,
  });
  const publisherClient = createRedisCommandClient(
    config.services.redis.url,
    config.services.redis.connectionTimeoutMs,
    config.marketData.queueCapacity,
  );
  const consumerClient = createRedisCommandClient(
    config.services.redis.url,
    config.services.redis.connectionTimeoutMs,
    config.marketData.queueCapacity,
  );
  const publisher = new RedisMarketDataPublisher(publisherClient, { streamName });
  const consumer = new RedisMarketDataConsumer(consumerClient, consumerName, {
    groupName,
    streamName,
  });
  const processedEntryIds = new Set<string>();
  const publishedEntryIds = new Set<string>();
  let consumerRuntime: ConsumerRuntime | undefined;
  let consumerStopped = false;
  let output: VerificationOutput | undefined;
  let initialState: Phase2VerificationState | undefined;
  let primaryFailure: Error | undefined;

  try {
    if (pass === 'initial') {
      await repository.createIngestionSession({
        sessionId: TARGET_SESSION_ID,
        mode: 'replay',
        configurationVersion: recording.manifest.configurationVersion,
        startedAt: createUtcTimestamp(recording.manifest.sessionStart),
      });
      await repository.createIngestionSession({
        sessionId: CLEAN_TARGET_SESSION_ID,
        mode: 'replay',
        configurationVersion: recording.manifest.configurationVersion,
        startedAt: createUtcTimestamp(recording.manifest.sessionStart),
      });
    } else {
      const durableEvents = await repository.readCanonicalEvents(TARGET_SESSION_ID);
      if (priorState === undefined || durableEvents.length !== priorState.eventCount) {
        throw new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH');
      }
      const durableIds = eventIds(durableEvents);
      if (durableIds.some((eventId, index) => eventId !== priorState.eventIds[index])) {
        throw new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH');
      }
      const cleanDurableEvents = await repository.readCanonicalEvents(CLEAN_TARGET_SESSION_ID);
      if (
        cleanDurableEvents.length !== durableEvents.length ||
        cleanDurableEvents.some((event, index) => event !== durableEvents[index])
      ) {
        throw new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH');
      }
    }

    await consumer.connect();
    await publisher.connect();
    const persistenceHandler = createRedisPersistenceHandler(repository);
    const handler: RedisEntryHandler = async (entry): Promise<void> => {
      await persistenceHandler(entry);
      processedEntryIds.add(entry.redisEntryId);
    };
    consumerRuntime = createConsumerRuntime(consumer, handler);

    const sink = Object.freeze({
      publish: async (
        targetSessionId: string,
        event: Parameters<RedisMarketDataPublisher['publish']>[1],
      ): Promise<string> => {
        const redisEntryId = await publisher.publish(targetSessionId, event);
        publishedEntryIds.add(redisEntryId);
        return redisEntryId;
      },
    });
    const replayCount = pass === 'initial' ? 2 : 1;
    const cleanReplayCount = pass === 'initial' ? 1 : 0;
    if (pass === 'initial') {
      await replayVerifiedRecording(recording, sink, CLEAN_TARGET_SESSION_ID, UNPACED_REPLAY);
    }
    for (let index = 0; index < replayCount; index += 1) {
      await replayVerifiedRecording(recording, sink, TARGET_SESSION_ID, UNPACED_REPLAY);
    }

    const canonicalEvents = await waitForDelivery({
      targetSessionId: TARGET_SESSION_ID,
      repository,
      consumer: consumerRuntime,
      publishedEntryIds,
      processedEntryIds,
      expectedLedgerCount: recording.manifest.eventCount,
    });
    const cleanCanonicalEvents = await waitForDelivery({
      targetSessionId: CLEAN_TARGET_SESSION_ID,
      repository,
      consumer: consumerRuntime,
      publishedEntryIds,
      processedEntryIds,
      expectedLedgerCount: recording.manifest.eventCount,
    });
    if (
      cleanCanonicalEvents.length !== canonicalEvents.length ||
      cleanCanonicalEvents.some((event, index) => event !== canonicalEvents[index])
    ) {
      throw new Phase2VerificationError('PHASE2_VERIFY_VERIFICATION_MISMATCH');
    }
    await stopConsumer(consumerRuntime, config.marketData.shutdownTimeoutMs);
    consumerStopped = true;

    const exportedRecording = await exportPortableRecording(repository, {
      sourceSessionId: TARGET_SESSION_ID,
      configurationVersion: recording.manifest.configurationVersion,
      freshnessThresholdMs: recording.manifest.freshnessThresholdMs,
      sourceMetadata: {
        kind: 'normalized_ledger',
        description: 'Credential-free deterministic Phase 2 verification ledger.',
        containsRawProviderFrames: false,
      },
    });
    const verifiedExport = verifyPortableRecording(exportedRecording);
    const observedAt = createUtcTimestamp(recording.manifest.sessionEnd);
    const latestBars = await repository.findLatestBars(observedAt);
    const renderedStatus = terminalStatus(
      latestBars,
      canonicalEvents,
      observedAt,
      recording.manifest.freshnessThresholdMs,
    );
    const state = createPhase2VerificationState({
      exportedRecording,
      recordingChecksum: verifiedExport.manifest.checksum,
      eventIds: verifiedExport.events.map(({ event }) => event.eventId),
      terminalStatus: renderedStatus,
    });

    if (pass === 'initial') {
      initialState = state;
      await repository.closeIngestionSession(
        CLEAN_TARGET_SESSION_ID,
        lastReceivedAt(cleanCanonicalEvents),
      );
    } else {
      if (priorState === undefined) {
        throw new Phase2VerificationError('PHASE2_VERIFY_STATE_INVALID');
      }
      assertPhase2VerificationStateEqual(priorState, state);
      await repository.closeIngestionSession(TARGET_SESSION_ID, lastReceivedAt(canonicalEvents));
    }

    output = Object.freeze({
      terminalStatus: renderedStatus,
      result: Object.freeze({
        event: 'phase2.verify.passed',
        pass,
        targetSessionId: TARGET_SESSION_ID,
        cleanTargetSessionId: CLEAN_TARGET_SESSION_ID,
        replayCount,
        cleanReplayCount,
        eventCount: state.eventCount,
        eventIds: state.eventIds,
        recordingChecksum: state.recordingChecksum,
        recordingBytesSha256: state.recordingBytesSha256,
        statusSha256: state.statusSha256,
        providerConnectionOpened: false,
        brokerConnectionOpened: false,
      }),
    });
  } catch (error) {
    primaryFailure =
      error instanceof Error ? error : new Phase2VerificationError('PHASE2_VERIFY_UNKNOWN_FAILED');
  }

  let cleanupFailed = false;
  if (consumerRuntime !== undefined && !consumerStopped) {
    consumerRuntime.controller.abort();
    cleanupFailed =
      (await classifyCleanup(() => consumerRuntime.done, config.marketData.shutdownTimeoutMs)) ||
      cleanupFailed;
  }
  if (primaryFailure !== undefined || pass === 'restart') {
    cleanupFailed =
      (await classifyCleanup(() => consumer.destroyGroup(), config.marketData.shutdownTimeoutMs)) ||
      cleanupFailed;
    cleanupFailed =
      (await classifyCleanup(
        () => publisher.destroyStream(),
        config.marketData.shutdownTimeoutMs,
      )) || cleanupFailed;
  }
  cleanupFailed =
    (await classifyCleanup(() => publisher.close(), config.marketData.shutdownTimeoutMs)) ||
    cleanupFailed;
  cleanupFailed =
    (await classifyCleanup(() => consumer.close(), config.marketData.shutdownTimeoutMs)) ||
    cleanupFailed;
  cleanupFailed =
    (await classifyCleanup(() => repository.close(), config.marketData.shutdownTimeoutMs)) ||
    cleanupFailed;

  if (primaryFailure !== undefined) {
    throw primaryFailure;
  }
  if (cleanupFailed) {
    throw new Phase2VerificationError('PHASE2_VERIFY_CLEANUP_FAILED');
  }
  if (output === undefined) {
    throw new Phase2VerificationError('PHASE2_VERIFY_UNKNOWN_FAILED');
  }
  if (pass === 'initial') {
    if (initialState === undefined) {
      throw new Phase2VerificationError('PHASE2_VERIFY_UNKNOWN_FAILED');
    }
    await writeInitialState(stateFile, initialState);
  }
  return output;
}

function safeErrorCode(error: unknown): Phase2VerificationErrorCode {
  if (error instanceof Phase2VerificationError) {
    return error.code;
  }
  if (error instanceof ConfigurationError) {
    return 'PHASE2_VERIFY_CONFIGURATION_INVALID';
  }
  if (error instanceof MarketDataRecordingError) {
    return 'PHASE2_VERIFY_RECORDING_INVALID';
  }
  if (error instanceof MarketDataReplayError) {
    return 'PHASE2_VERIFY_REPLAY_FAILED';
  }
  if (error instanceof RedisDeliveryError) {
    return 'PHASE2_VERIFY_REDIS_FAILED';
  }
  if (error instanceof MarketDataPersistenceError) {
    return 'PHASE2_VERIFY_PERSISTENCE_FAILED';
  }
  return 'PHASE2_VERIFY_UNKNOWN_FAILED';
}

void executeVerification().then(
  ({ terminalStatus: renderedStatus, result }) => {
    process.stdout.write(`${renderedStatus}\n${JSON.stringify(result)}\n`);
  },
  (error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ event: 'phase2.verify.failed', code: safeErrorCode(error) })}\n`,
    );
    process.exitCode = 1;
  },
);
