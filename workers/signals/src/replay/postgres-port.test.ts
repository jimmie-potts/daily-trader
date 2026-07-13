import {
  SIGNAL_REPLAY_OUTPUT_VERSION,
  projectVerifiedSignalReplay,
  type SignalReplayTargetDescriptor,
} from '@daily-trader/signals';
import { describe, expect, it } from 'vitest';

import type { SqlClient, SqlPool, SqlQueryResult, SqlRow } from '../persistence/sql.js';
import {
  PostgresSignalReplayPersistencePort,
  replayOperationalMetadata,
  replayTimestampText,
} from './postgres-port.js';
import { loadCheckedSignalReplayRecording } from './verifier.js';

class NoConnectPool implements SqlPool {
  public connect(): Promise<SqlClient> {
    throw new Error('descriptor validation must precede connection');
  }

  public query<Row extends SqlRow = SqlRow>(): Promise<SqlQueryResult<Row>> {
    throw new Error('not used');
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    return Promise.resolve();
  }
}

describe('PostgresSignalReplayPersistencePort boundaries', () => {
  it('uses a stable versioned operational payload and backlog one for an empty target', () => {
    expect(replayOperationalMetadata(0)).toEqual({
      payload:
        '{"schemaVersion":"daily-trader.signals.replay-persistence.v1","claimMode":"transaction_fence","backlogLimit":1}',
      hash: '30cf86df6971ab692159720e6e0ddab18bd878d3bb5fdab805a795ab6f1c0b60',
      backlogLimit: 1,
    });
  });

  it('canonicalizes real pg TIMESTAMPTZ Date rows without passing through string-only codecs', () => {
    expect(replayTimestampText(new Date('2026-07-13T13:35:00.000Z'), 'bar_start')).toBe(
      '2026-07-13T13:35:00.000Z',
    );
  });

  it('rejects a wrong output version before opening PostgreSQL', async () => {
    const recording = await loadCheckedSignalReplayRecording();
    const projection = projectVerifiedSignalReplay(recording);
    const descriptor = {
      targetId: projection.output.targetId,
      inputChecksum: recording.inputChecksum,
      configuration: recording.manifest.configuration,
      manifest: recording.manifest,
      expectedAssociationCount: projection.artifacts.length,
      expectedOutputChecksum: projection.output.checksum,
      outputVersion: 'daily-trader.signals.replay-output.v999',
    } as unknown as SignalReplayTargetDescriptor;
    expect(descriptor.outputVersion).not.toBe(SIGNAL_REPLAY_OUTPUT_VERSION);
    await expect(
      new PostgresSignalReplayPersistencePort(new NoConnectPool()).beginTarget(descriptor),
    ).rejects.toMatchObject({ code: 'descriptor_invalid' });
  });
});
