import { readFile } from 'node:fs/promises';

import {
  SignalError,
  createSignalConfiguration,
  persistVerifiedSignalReplay,
  projectVerifiedSignalReplay,
  verifySignalReplayProjection,
  verifySignalReplayRecording,
  type SignalReplayArtifact,
  type SignalReplayCanonicalOutput,
  type SignalReplayPersistencePort,
  type SignalReplayProjection,
  type SignalReplayTargetDescriptor,
  type VerifiedSignalReplayRecording,
} from '@daily-trader/signals';

import type { SqlPool } from '../persistence/sql.js';
import {
  PostgresSignalReplayPersistencePort,
  type ReplayTargetInspection,
} from './postgres-port.js';
import { seedVerifiedReplayCatalog } from './seed.js';

export const CHECKED_SIGNAL_REPLAY_FIXTURE = new URL(
  '../../../../packages/signals/fixtures/recordings/synthetic-phase3-signal-session-v1.json',
  import.meta.url,
);

export interface ReplayVerificationOptions {
  readonly repeat?: boolean;
  readonly interruptAfterAssociations?: number;
  readonly restartAfterInterruption?: boolean;
}

export interface ReplayVerificationResult {
  readonly recording: VerifiedSignalReplayRecording;
  readonly projection: SignalReplayProjection;
  readonly inspection: ReplayTargetInspection;
  readonly repeated: boolean;
  readonly restarted: boolean;
}

export async function loadCheckedSignalReplayRecording(): Promise<VerifiedSignalReplayRecording> {
  const serialized = await readFile(CHECKED_SIGNAL_REPLAY_FIXTURE, 'utf8');
  const expectedConfiguration = createSignalConfiguration({
    configurationVersion: 'phase3-synthetic-replay-v1',
    lookbackBars: 3,
    volumeMultiplier: '1.5',
    freshnessThresholdMs: 120_000,
  });
  return verifySignalReplayRecording(serialized, expectedConfiguration);
}

export async function verifyCheckedSignalReplayFixture(): Promise<SignalReplayProjection> {
  const recording = await loadCheckedSignalReplayRecording();
  const projection = projectVerifiedSignalReplay(recording);
  verifySignalReplayProjection(projection, recording.manifest.expectedOutputChecksum);
  return projection;
}

export class InterruptingSignalReplayPort implements SignalReplayPersistencePort {
  readonly #delegate: SignalReplayPersistencePort;
  readonly #limit: number;
  #persisted = 0;

  public constructor(delegate: SignalReplayPersistencePort, limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('limit must be nonnegative');
    this.#delegate = delegate;
    this.#limit = limit;
  }

  public beginTarget(target: SignalReplayTargetDescriptor): Promise<unknown> {
    return this.#delegate.beginTarget(target);
  }

  public async persistAssociation(targetId: string, artifact: SignalReplayArtifact): Promise<void> {
    if (this.#persisted === this.#limit) throw new Error('injected replay interruption');
    await this.#delegate.persistAssociation(targetId, artifact);
    this.#persisted += 1;
  }

  public completeTarget(targetId: string, output: SignalReplayCanonicalOutput): Promise<unknown> {
    return this.#delegate.completeTarget(targetId, output);
  }

  public failTarget(targetId: string): Promise<unknown> {
    return this.#delegate.failTarget(targetId);
  }
}

async function persistOnce(
  recording: VerifiedSignalReplayRecording,
  pool: SqlPool,
  interruptionAfter?: number,
): Promise<SignalReplayProjection> {
  const adapter = new PostgresSignalReplayPersistencePort(pool);
  const port =
    interruptionAfter === undefined
      ? adapter
      : new InterruptingSignalReplayPort(adapter, interruptionAfter);
  return persistVerifiedSignalReplay(recording, port);
}

function assertStoredOutput(
  projection: SignalReplayProjection,
  inspection: ReplayTargetInspection,
): void {
  if (
    inspection.state !== 'completed' ||
    inspection.cursor !== String(projection.artifacts.length) ||
    inspection.expectedCount !== projection.artifacts.length ||
    inspection.outputChecksum !== projection.output.checksum ||
    inspection.outputPayload !== projection.serializedOutput
  ) {
    throw new SignalError('replay_sink_failed');
  }
}

export async function runCheckedSignalReplay(
  pool: SqlPool,
  options: ReplayVerificationOptions = {},
): Promise<ReplayVerificationResult> {
  const recording = await loadCheckedSignalReplayRecording();
  const expected = projectVerifiedSignalReplay(recording);
  verifySignalReplayProjection(expected, recording.manifest.expectedOutputChecksum);
  if (
    options.interruptAfterAssociations !== undefined &&
    (options.interruptAfterAssociations < 0 ||
      !Number.isSafeInteger(options.interruptAfterAssociations) ||
      options.interruptAfterAssociations >= expected.artifacts.length)
  ) {
    throw new SignalError('replay_invalid');
  }
  await seedVerifiedReplayCatalog(pool, recording);

  let restarted = false;
  let projection: SignalReplayProjection;
  if (options.interruptAfterAssociations !== undefined) {
    try {
      await persistOnce(recording, pool, options.interruptAfterAssociations);
      throw new SignalError('replay_sink_failed');
    } catch (error) {
      if (!(error instanceof SignalError) || error.code !== 'replay_sink_failed') throw error;
      if (options.restartAfterInterruption !== true) throw error;
    }
    restarted = true;
    projection = await persistOnce(recording, pool);
  } else {
    projection = await persistOnce(recording, pool);
  }

  if (projection.serializedOutput !== expected.serializedOutput) {
    throw new SignalError('replay_sink_failed');
  }
  let repeated = false;
  if (options.repeat === true) {
    const repeatedProjection = await persistOnce(recording, pool);
    if (repeatedProjection.serializedOutput !== projection.serializedOutput) {
      throw new SignalError('replay_sink_failed');
    }
    repeated = true;
  }
  const inspectionPort = new PostgresSignalReplayPersistencePort(pool);
  const inspection = await inspectionPort.inspectTarget(projection.output.targetId);
  assertStoredOutput(projection, inspection);
  return Object.freeze({ recording, projection, inspection, repeated, restarted });
}
