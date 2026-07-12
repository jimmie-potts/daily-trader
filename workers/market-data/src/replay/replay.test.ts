import { deserializeOneMinuteBarEvent } from '@daily-trader/market-data';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { MarketDataReplayError } from './errors.js';
import { verifyPortableRecording } from './recording.js';
import { replayVerifiedRecording } from './replay.js';
import {
  type ReplayMarketDataSink,
  type ReplayPublishableMarketDataEvent,
  type VerifiedMarketDataRecording,
} from './types.js';

const fixtureUrl = new URL(
  '../../fixtures/recordings/synthetic-aapl-spy-session-v1.json',
  import.meta.url,
);

class CapturingSink implements ReplayMarketDataSink {
  public readonly published: Array<{
    targetSessionId: string;
    event: ReplayPublishableMarketDataEvent;
  }> = [];
  public fail = false;

  public publish(targetSessionId: string, event: ReplayPublishableMarketDataEvent): Promise<void> {
    if (this.fail) return Promise.reject(new Error('redis://secret'));
    this.published.push({ targetSessionId, event });
    return Promise.resolve();
  }
}

async function verifiedFixture(): Promise<VerifiedMarketDataRecording> {
  return verifyPortableRecording(await readFile(fixtureUrl, 'utf8'));
}

describe('replayVerifiedRecording', () => {
  it('publishes production-shaped canonical events without changing source times or IDs', async () => {
    const recording = await verifiedFixture();
    const sink = new CapturingSink();
    const result = await replayVerifiedRecording(recording, sink, 'replay-target-v1');

    expect(result).toEqual({
      targetSessionId: 'replay-target-v1',
      publishedEventCount: 6,
      eventIds: recording.events.map(({ event }) => event.eventId),
    });
    expect(sink.published).toHaveLength(6);
    for (const [index, published] of sink.published.entries()) {
      const original = recording.events[index];
      if (original === undefined) throw new Error('missing fixture event');
      expect(published.targetSessionId).toBe('replay-target-v1');
      expect(published.event).toEqual({
        schemaVersion: original.event.schemaVersion,
        eventId: original.event.eventId,
        orderingKey: original.event.orderingKey,
        canonicalJson: original.canonicalJson,
      });
      expect(deserializeOneMinuteBarEvent(published.event.canonicalJson)).toMatchObject({
        providerTimestamp: original.event.providerTimestamp,
        receivedAt: original.event.receivedAt,
        processedAt: original.event.processedAt,
      });
    }
  });

  it('matches two clean targets byte-for-byte and stays idempotent in existing state', async () => {
    const recording = await verifiedFixture();
    const firstTarget = new CapturingSink();
    const secondTarget = new CapturingSink();

    await replayVerifiedRecording(recording, firstTarget, 'clean-target-a');
    await replayVerifiedRecording(recording, secondTarget, 'clean-target-b');
    await replayVerifiedRecording(recording, firstTarget, 'clean-target-a');

    const expectedCanonical = recording.events.map(({ canonicalJson }) => canonicalJson);
    const firstClean = firstTarget.published.slice(0, 6).map(({ event }) => event.canonicalJson);
    const secondClean = secondTarget.published.map(({ event }) => event.canonicalJson);
    const existingStateReplay = firstTarget.published
      .slice(6)
      .map(({ event }) => event.canonicalJson);
    expect(firstClean).toEqual(expectedCanonical);
    expect(secondClean).toEqual(firstClean);
    expect(existingStateReplay).toEqual(firstClean);
  });

  it('uses injected pacing based on preserved receive-time deltas', async () => {
    const recording = await verifiedFixture();
    const delays: number[] = [];
    await replayVerifiedRecording(recording, new CapturingSink(), 'paced-replay', {
      mode: 'paced',
      speed: 2,
      sleep: (delayMilliseconds) => {
        delays.push(delayMilliseconds);
        return Promise.resolve();
      },
    });

    expect(delays).toEqual([50, 59_950, 50, 4_900, 5_000]);
  });

  it('rejects invalid pacing, target sessions, unverified input, and sink failures', async () => {
    const recording = await verifiedFixture();
    await expect(
      replayVerifiedRecording(recording, new CapturingSink(), 'INVALID SESSION'),
    ).rejects.toEqual(new MarketDataReplayError('invalid_target_session'));
    await expect(
      replayVerifiedRecording(recording, new CapturingSink(), 'target', {
        mode: 'paced',
        speed: 0,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toEqual(new MarketDataReplayError('invalid_pacing'));
    await expect(
      replayVerifiedRecording(
        { manifest: recording.manifest, events: recording.events } as VerifiedMarketDataRecording,
        new CapturingSink(),
        'target',
      ),
    ).rejects.toEqual(new MarketDataReplayError('unverified_recording'));

    const sink = new CapturingSink();
    sink.fail = true;
    await expect(replayVerifiedRecording(recording, sink, 'target')).rejects.toEqual(
      new MarketDataReplayError('sink_failed'),
    );
  });

  it('translates sleeper failure without exposing its message', async () => {
    const recording = await verifiedFixture();
    await expect(
      replayVerifiedRecording(recording, new CapturingSink(), 'paced-target', {
        mode: 'paced',
        speed: 1,
        sleep: () => Promise.reject(new Error('private timer details')),
      }),
    ).rejects.toEqual(new MarketDataReplayError('sleeper_failed'));
  });
});
