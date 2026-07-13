import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { createOneMinuteBarEvent, type OneMinuteBarEvent } from '@daily-trader/market-data';

import { createSignalConfiguration } from '../configuration.js';
import { SignalError } from '../errors.js';
import { createSignalReplayRecording, verifySignalReplayRecording } from './recording.js';
import { projectVerifiedSignalReplay } from './replay.js';
import {
  MAX_SIGNAL_REPLAY_CATALOG_EVENTS,
  MAX_SIGNAL_REPLAY_RECORDING_CHARACTERS,
  MAX_SIGNAL_REPLAY_SCHEDULE_ENTRIES,
  type SignalReplayRecordingInput,
  type VerifiedSignalReplayRecording,
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

function mutate(serialized: string, update: (root: Record<string, unknown>) => void): string {
  const root = JSON.parse(serialized) as Record<string, unknown>;
  update(root);
  return `${JSON.stringify(root, null, 2)}\n`;
}

function recordingInput(
  recording: VerifiedSignalReplayRecording,
  overrides: Partial<SignalReplayRecordingInput> = {},
): SignalReplayRecordingInput {
  return {
    events: recording.catalog.events,
    scheduleEventIds: recording.schedule.entries.map(({ eventId }) => eventId),
    configuration,
    expectedOutputChecksum: '0'.repeat(64),
    sourceDescription: 'Bounded synthetic replay validation scenario.',
    ...overrides,
  };
}

function barAt(providerTimestamp: string, symbol: 'AAPL' | 'SPY' = 'AAPL'): OneMinuteBarEvent {
  const receivedAt = new Date(Date.parse(providerTimestamp) + 60_100).toISOString();
  return createOneMinuteBarEvent({
    symbol,
    venue: symbol === 'AAPL' ? 'XNAS' : 'ARCX',
    providerTimestamp,
    receivedAt,
    processedAt: receivedAt,
    open: '100',
    high: '101',
    low: '99',
    close: '100',
    volume: '200',
  });
}

describe('signal replay recording rejection', () => {
  it.each([
    ['truncated', (value: string) => value.slice(0, -20)],
    ['noncanonical bytes', (value: string) => value.replace('  "catalog":', '   "catalog":')],
  ] as const)('rejects %s input', async (_name, update) => {
    const serialized = await fixture();
    expect(() => verifySignalReplayRecording(update(serialized), configuration)).toThrowError(
      expect.objectContaining({ code: 'replay_invalid' }),
    );
  });

  it('rejects corruption, unsupported versions, unknown references, and duplicate catalog IDs', async () => {
    const serialized = await fixture();
    const mutations = [
      (root: Record<string, unknown>) => {
        (root.manifest as Record<string, unknown>).version = 'unsupported';
      },
      (root: Record<string, unknown>) => {
        const entries = (root.schedule as { entries: Array<Record<string, unknown>> }).entries;
        entries[0]!.eventId = 'f'.repeat(64);
      },
      (root: Record<string, unknown>) => {
        const events = (root.catalog as { events: unknown[] }).events;
        events.push(events[0]);
      },
      (root: Record<string, unknown>) => {
        (root.manifest as Record<string, unknown>).catalogChecksum = '0'.repeat(64);
      },
    ];
    for (const update of mutations) {
      expect(() =>
        verifySignalReplayRecording(mutate(serialized, update), configuration),
      ).toThrowError(expect.objectContaining({ code: 'replay_invalid' }));
    }
  });

  it('rejects ambient configuration mismatch before replay', async () => {
    const mismatch = createSignalConfiguration({
      configurationVersion: 'phase3-synthetic-replay-v1',
      lookbackBars: 4,
      volumeMultiplier: '1.5',
      freshnessThresholdMs: 120_000,
    });
    const serialized = await fixture();
    expect(() => verifySignalReplayRecording(serialized, mismatch)).toThrowError(
      expect.objectContaining({ code: 'replay_configuration_mismatch' }),
    );
  });

  it('refuses structurally forged input that did not cross the verifier', () => {
    expect(() => projectVerifiedSignalReplay({} as VerifiedSignalReplayRecording)).toThrowError(
      new SignalError('replay_invalid'),
    );
  });

  it('rejects recordings before parsing when their serialized input exceeds the byte budget', () => {
    expect(() =>
      verifySignalReplayRecording(
        ' '.repeat(MAX_SIGNAL_REPLAY_RECORDING_CHARACTERS + 1),
        configuration,
      ),
    ).toThrowError(expect.objectContaining({ code: 'replay_invalid' }));
  });

  it('bounds catalog and schedule cardinality before building recording structures', async () => {
    const recording = verifySignalReplayRecording(await fixture(), configuration);
    const firstEvent = recording.catalog.events[0];
    const firstEventId = recording.schedule.entries[0]?.eventId;
    if (firstEvent === undefined || firstEventId === undefined) {
      throw new Error('fixture must contain an event and schedule entry');
    }

    expect(() =>
      createSignalReplayRecording(
        recordingInput(recording, {
          events: Array.from({ length: MAX_SIGNAL_REPLAY_CATALOG_EVENTS + 1 }, () => firstEvent),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'replay_invalid' }));

    const referencedCatalog = recording.schedule.entries.map(({ eventId }) => eventId);
    expect(() =>
      createSignalReplayRecording(
        recordingInput(recording, {
          scheduleEventIds: [
            ...referencedCatalog,
            ...Array.from(
              {
                length: MAX_SIGNAL_REPLAY_SCHEDULE_ENTRIES + 1 - referencedCatalog.length,
              },
              () => firstEventId,
            ),
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'replay_invalid' }));
  });

  it.each([
    ['outside the core session', '2026-07-13T13:29:00Z'],
    ['outside the embedded calendar snapshot', '2029-01-02T14:30:00Z'],
    ['in a different core session', '2026-07-14T13:30:00Z'],
  ] as const)('rejects a catalog event %s', async (_case, providerTimestamp) => {
    const recording = verifySignalReplayRecording(await fixture(), configuration);
    const candidate = barAt(providerTimestamp);

    expect(() =>
      createSignalReplayRecording(
        recordingInput(recording, {
          events: [...recording.catalog.events, candidate],
          scheduleEventIds: [
            ...recording.schedule.entries.map(({ eventId }) => eventId),
            candidate.eventId,
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'replay_invalid' }));
  });

  it('requires enough contiguous coverage for the configured lookback in both series', async () => {
    const recording = verifySignalReplayRecording(await fixture(), configuration);
    const removed = recording.catalog.events.find(
      (event) => event.instrument.symbol === 'SPY' && event.barStart === '2026-07-13T13:32:00.000Z',
    );
    if (removed === undefined) throw new Error('fixture must contain the SPY gap candidate');

    expect(() =>
      createSignalReplayRecording(
        recordingInput(recording, {
          events: recording.catalog.events.filter(({ eventId }) => eventId !== removed.eventId),
          scheduleEventIds: recording.schedule.entries
            .map(({ eventId }) => eventId)
            .filter((eventId) => eventId !== removed.eventId),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'replay_invalid' }));
  });
});
