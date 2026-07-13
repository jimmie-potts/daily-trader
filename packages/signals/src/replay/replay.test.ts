import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { createSignalConfiguration } from '../configuration.js';
import { SignalError } from '../errors.js';
import { serializeSignalEvaluation } from '../serialization.js';
import { createSignalReplayRecording, verifySignalReplayRecording } from './recording.js';
import {
  persistVerifiedSignalReplay,
  projectVerifiedSignalReplay,
  serializeSignalReplayOutput,
} from './replay.js';
import type {
  SignalReplayArtifact,
  SignalReplayCanonicalOutput,
  SignalReplayPersistencePort,
  SignalReplayTargetDescriptor,
  VerifiedSignalReplayRecording,
} from './types.js';

const fixtureUrl = new URL(
  '../../fixtures/recordings/synthetic-phase3-signal-session-v1.json',
  import.meta.url,
);

const configuration = createSignalConfiguration({
  configurationVersion: 'phase3-synthetic-replay-v1',
  lookbackBars: 3,
  volumeMultiplier: '1.5',
  freshnessThresholdMs: 120_000,
});

async function fixture(): Promise<string> {
  return readFile(fixtureUrl, 'utf8');
}

interface ConvergedEvaluation {
  readonly evaluationBarKey: string;
  readonly evaluation: string;
}

interface ConvergedOccurrence {
  readonly evaluationBarKey: string;
  readonly occurrence: string;
}

function recordingWithSchedule(
  source: VerifiedSignalReplayRecording,
  scheduleEventIds: readonly string[],
): VerifiedSignalReplayRecording {
  const input = {
    events: source.catalog.events,
    scheduleEventIds,
    configuration,
    sourceDescription: 'Equivalent synthetic correction-order replay scenario.',
  } as const;
  const placeholder = createSignalReplayRecording({
    ...input,
    expectedOutputChecksum: '0'.repeat(64),
  });
  const expectedOutputChecksum = projectVerifiedSignalReplay(
    verifySignalReplayRecording(placeholder, configuration),
  ).output.checksum;
  return verifySignalReplayRecording(
    createSignalReplayRecording({ ...input, expectedOutputChecksum }),
    configuration,
  );
}

function convergedEvaluations(
  projection: ReturnType<typeof projectVerifiedSignalReplay>,
): readonly ConvergedEvaluation[] {
  return projection.output.latestEvaluations.map(({ evaluationBarKey, evaluation }) => ({
    evaluationBarKey,
    evaluation: serializeSignalEvaluation(evaluation),
  }));
}

function convergedOccurrences(
  projection: ReturnType<typeof projectVerifiedSignalReplay>,
): readonly ConvergedOccurrence[] {
  return projection.output.activeFiredHistory.map(({ evaluationBarKey, occurrence }) => ({
    evaluationBarKey,
    occurrence: JSON.stringify(occurrence),
  }));
}

class CapturingPort implements SignalReplayPersistencePort {
  public descriptor: SignalReplayTargetDescriptor | undefined;
  public readonly artifacts: SignalReplayArtifact[] = [];
  public output: SignalReplayCanonicalOutput | undefined;
  public failedTarget: string | undefined;
  public failAtOrdinal: number | undefined;

  public beginTarget(target: SignalReplayTargetDescriptor): Promise<void> {
    this.descriptor = target;
    return Promise.resolve();
  }

  public persistAssociation(_targetId: string, artifact: SignalReplayArtifact): Promise<void> {
    if (artifact.association.targetOrdinal === this.failAtOrdinal) {
      return Promise.reject(new Error('private sink detail'));
    }
    this.artifacts.push(artifact);
    return Promise.resolve();
  }

  public completeTarget(_targetId: string, output: SignalReplayCanonicalOutput): Promise<void> {
    this.output = output;
    return Promise.resolve();
  }

  public failTarget(targetId: string): Promise<void> {
    this.failedTarget = targetId;
    return Promise.resolve();
  }
}

describe('synthetic Phase 3 signal recording', () => {
  it('verifies the unique catalog, duplicate schedule reference, semantic identity, and bounds', async () => {
    const recording = verifySignalReplayRecording(await fixture(), configuration);

    expect(recording.manifest).toMatchObject({
      recordingVersion: 'daily-trader.signals.replay-recording.v1',
      catalogVersion: 'daily-trader.signals.replay-catalog.v1',
      scheduleVersion: 'daily-trader.signals.replay-schedule.v1',
      outputVersion: 'daily-trader.signals.replay-output.v1',
      sessionStart: '2026-07-13T13:30:00.000Z',
      sessionEnd: '2026-07-13T13:37:00.000Z',
      catalogEventCount: 14,
      scheduleEntryCount: 15,
      sourceMetadata: {
        kind: 'synthetic_signal_scenario',
        containsRawProviderFrames: false,
        containsCredentials: false,
        containsDerivedOutputClaims: false,
      },
    });
    expect(new Set(recording.catalog.events.map(({ eventId }) => eventId)).size).toBe(14);
    expect(
      recording.schedule.entries.filter(
        ({ eventId }) => eventId === recording.schedule.entries[4]?.eventId,
      ),
    ).toHaveLength(2);
    expect(recording.manifest.semantics).toMatchObject({
      calendarSnapshotVersion: 'nyse-core-2026-2028.v1',
      dataQualityPolicyVersion: 'daily-trader.market-data.quality.v1',
      configurationHash: configuration.configurationHash,
    });
  });

  it('reproduces warm-up, both fire directions, equality, gap fill, and revision transitions', async () => {
    const recording = verifySignalReplayRecording(await fixture(), configuration);
    const projection = projectVerifiedSignalReplay(recording);

    expect(projection.output.checksum).toBe(recording.manifest.expectedOutputChecksum);
    expect(projection.output).toMatchObject({
      catalogEventCount: 14,
      scheduleEntryCount: 15,
      processedScheduleEntryCount: 15,
      canonicalRevisionCount: 13,
      canonicalNoOpCount: 2,
    });
    expect(projection.output.associations.map(({ targetOrdinal }) => targetOrdinal)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );

    const upward = projection.artifacts.find(
      ({ association, evaluation }) =>
        association.scheduleOrdinal === 10 && evaluation.outcome === 'fired',
    )?.evaluation;
    const downward = projection.artifacts.find(
      ({ association, evaluation }) =>
        association.scheduleOrdinal === 9 && evaluation.outcome === 'fired',
    )?.evaluation;
    expect(upward).toMatchObject({ outcome: 'fired', direction: 'upward' });
    expect(downward).toMatchObject({ outcome: 'fired', direction: 'downward' });
    if (upward?.outcome !== 'fired' || downward?.outcome !== 'fired') {
      throw new Error('fixture must fire in both directions');
    }
    expect(upward.volumeComparison.leftProduct).toBe(upward.volumeComparison.rightProduct);
    expect(downward.volumeComparison.leftProduct).toBe(downward.volumeComparison.rightProduct);

    expect(
      projection.artifacts.find(({ association }) => association.scheduleOrdinal === 12)
        ?.evaluation,
    ).toMatchObject({ outcome: 'suppressed', reason: 'missing_interval' });
    expect(
      projection.artifacts.some(
        ({ association, evaluation, transition }) =>
          association.scheduleOrdinal === 13 &&
          evaluation.outcome === 'fired' &&
          transition.kind === 'supersession',
      ),
    ).toBe(true);
    expect(
      projection.artifacts.find(
        ({ association }) =>
          association.scheduleOrdinal === 14 && association.retractedOccurrenceId !== undefined,
      )?.transition,
    ).toMatchObject({ kind: 'retraction' });
    expect(
      projection.output.activeFiredHistory.map(({ occurrence }) => occurrence.direction),
    ).toEqual(['downward', 'downward']);
  });

  it('produces byte-stable canonical output across clean and existing-state projections', async () => {
    const recording = verifySignalReplayRecording(await fixture(), configuration);
    const first = projectVerifiedSignalReplay(recording);
    const secondRecording = verifySignalReplayRecording(await fixture(), configuration);
    const second = projectVerifiedSignalReplay(secondRecording);

    expect(second.serializedOutput).toBe(first.serializedOutput);
    expect(serializeSignalReplayOutput(first.output)).toBe(first.serializedOutput);
    expect(first.serializedOutput.endsWith('\n')).toBe(true);
  });

  it('converges on identical latest evaluations when equivalent corrections arrive in either order', async () => {
    const baselineRecording = verifySignalReplayRecording(await fixture(), configuration);
    const reorderedSchedule = baselineRecording.schedule.entries.map(({ eventId }) => eventId);
    const winnerIndex = reorderedSchedule.length - 2;
    const loserIndex = reorderedSchedule.length - 1;
    const winner = reorderedSchedule[winnerIndex];
    const loser = reorderedSchedule[loserIndex];
    if (winner === undefined || loser === undefined) {
      throw new Error('fixture must end with winner and loser corrections');
    }
    reorderedSchedule[winnerIndex] = loser;
    reorderedSchedule[loserIndex] = winner;

    const baseline = projectVerifiedSignalReplay(baselineRecording);
    const reordered = projectVerifiedSignalReplay(
      recordingWithSchedule(baselineRecording, reorderedSchedule),
    );

    expect(reordered.output.canonicalRevisionCount).toBe(
      baseline.output.canonicalRevisionCount + 1,
    );
    expect(reordered.output.canonicalNoOpCount).toBe(baseline.output.canonicalNoOpCount - 1);
    expect(reordered.artifacts.map(({ transition }) => transition.kind)).not.toEqual(
      baseline.artifacts.map(({ transition }) => transition.kind),
    );
    expect(convergedEvaluations(reordered)).toEqual(convergedEvaluations(baseline));
    expect(convergedOccurrences(reordered)).toEqual(convergedOccurrences(baseline));
  });
});

describe('signal replay persistence port', () => {
  it('passes complete production artifacts in deterministic target order', async () => {
    const recording = verifySignalReplayRecording(await fixture(), configuration);
    const port = new CapturingPort();
    const projection = await persistVerifiedSignalReplay(recording, port);

    expect(port.descriptor?.targetId).toBe(projection.output.targetId);
    expect(port.descriptor).toMatchObject({
      expectedAssociationCount: 16,
      expectedOutputChecksum: projection.output.checksum,
      outputVersion: 'daily-trader.signals.replay-output.v1',
    });
    expect(port.artifacts.map(({ association }) => association.targetOrdinal)).toEqual(
      projection.artifacts.map(({ association }) => association.targetOrdinal),
    );
    expect(port.output).toEqual(projection.output);
    expect(port.failedTarget).toBeUndefined();
  });

  it('classifies a sink failure and asks the owner to leave the target failed', async () => {
    const recording = verifySignalReplayRecording(await fixture(), configuration);
    const port = new CapturingPort();
    port.failAtOrdinal = 4;

    await expect(persistVerifiedSignalReplay(recording, port)).rejects.toEqual(
      new SignalError('replay_sink_failed'),
    );
    expect(port.failedTarget).toBe(port.descriptor?.targetId);
    expect(port.output).toBeUndefined();
  });
});
