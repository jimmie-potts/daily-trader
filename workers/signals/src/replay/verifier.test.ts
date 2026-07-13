import {
  persistVerifiedSignalReplay,
  type SignalReplayPersistencePort,
} from '@daily-trader/signals';
import { describe, expect, it } from 'vitest';

import {
  InterruptingSignalReplayPort,
  loadCheckedSignalReplayRecording,
  verifyCheckedSignalReplayFixture,
} from './verifier.js';

class CapturingPort implements SignalReplayPersistencePort {
  public persisted = 0;
  public failed = 0;

  public beginTarget(): Promise<void> {
    return Promise.resolve();
  }

  public persistAssociation(): Promise<void> {
    this.persisted += 1;
    return Promise.resolve();
  }

  public completeTarget(): Promise<void> {
    return Promise.resolve();
  }

  public failTarget(): Promise<void> {
    this.failed += 1;
    return Promise.resolve();
  }
}

describe('checked Phase 3 replay verifier', () => {
  it('verifies the reviewed recording and expected canonical output', async () => {
    const projection = await verifyCheckedSignalReplayFixture();
    expect(projection.output.checksum).toBe(
      'a8d0192b5d0c1797ba04ae708685a3be01918743668d6f37580c605c99ed2e7b',
    );
    expect(projection.artifacts.length).toBeGreaterThan(0);
  });

  it('commits an exact prefix before the injected restart seam marks the run failed', async () => {
    const recording = await loadCheckedSignalReplayRecording();
    const delegate = new CapturingPort();
    await expect(
      persistVerifiedSignalReplay(recording, new InterruptingSignalReplayPort(delegate, 3)),
    ).rejects.toMatchObject({ code: 'replay_sink_failed' });
    expect(delegate.persisted).toBe(3);
    expect(delegate.failed).toBe(1);
  });
});
