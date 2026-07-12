import { utcEpochMilliseconds } from '@daily-trader/market-data';

import { MarketDataReplayError } from './errors.js';
import { isVerifiedMarketDataRecording } from './recording.js';
import {
  type ReplayMarketDataSink,
  type ReplayPacing,
  type ReplayResult,
  type VerifiedMarketDataRecording,
} from './types.js';

const TARGET_SESSION_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export const UNPACED_REPLAY: ReplayPacing = Object.freeze({ mode: 'unpaced' });

function validatePacing(pacing: ReplayPacing): void {
  if (
    pacing.mode === 'paced' &&
    (!Number.isFinite(pacing.speed) || pacing.speed <= 0 || pacing.speed > 1_000)
  ) {
    throw new MarketDataReplayError('invalid_pacing');
  }
}

async function pace(
  recording: VerifiedMarketDataRecording,
  index: number,
  pacing: ReplayPacing,
): Promise<void> {
  if (pacing.mode === 'unpaced' || index === 0) {
    return;
  }
  const previous = recording.events[index - 1];
  const current = recording.events[index];
  if (previous === undefined || current === undefined) {
    throw new MarketDataReplayError('unverified_recording');
  }
  const sourceDelay = Math.max(
    0,
    utcEpochMilliseconds(current.event.receivedAt) -
      utcEpochMilliseconds(previous.event.receivedAt),
  );
  const replayDelay = Math.round(sourceDelay / pacing.speed);
  if (replayDelay === 0) {
    return;
  }
  try {
    await pacing.sleep(replayDelay);
  } catch {
    throw new MarketDataReplayError('sleeper_failed');
  }
}

export async function replayVerifiedRecording(
  recording: VerifiedMarketDataRecording,
  sink: ReplayMarketDataSink,
  targetSessionId: string,
  pacing: ReplayPacing = UNPACED_REPLAY,
): Promise<ReplayResult> {
  if (!isVerifiedMarketDataRecording(recording)) {
    throw new MarketDataReplayError('unverified_recording');
  }
  if (!TARGET_SESSION_ID.test(targetSessionId)) {
    throw new MarketDataReplayError('invalid_target_session');
  }
  validatePacing(pacing);

  const eventIds: string[] = [];
  for (const [index, item] of recording.events.entries()) {
    await pace(recording, index, pacing);
    try {
      await sink.publish(
        targetSessionId,
        Object.freeze({
          schemaVersion: item.event.schemaVersion,
          eventId: item.event.eventId,
          orderingKey: item.event.orderingKey,
          canonicalJson: item.canonicalJson,
        }),
      );
    } catch {
      throw new MarketDataReplayError('sink_failed');
    }
    eventIds.push(item.event.eventId);
  }

  return Object.freeze({
    targetSessionId,
    publishedEventCount: eventIds.length,
    eventIds: Object.freeze(eventIds),
  });
}
