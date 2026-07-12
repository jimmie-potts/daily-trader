import { MarketEventOrderingTracker } from '@daily-trader/market-data';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { MarketDataRecordingError } from './errors.js';
import { exportPortableRecording, verifyPortableRecording } from './recording.js';

const fixtureUrl = new URL(
  '../../fixtures/recordings/synthetic-aapl-spy-session-v1.json',
  import.meta.url,
);

async function fixture(): Promise<string> {
  return readFile(fixtureUrl, 'utf8');
}

function decodedFixture(serialized: string): {
  manifest: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
} {
  return JSON.parse(serialized) as {
    manifest: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
  };
}

function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe('portable recording fixture', () => {
  it('verifies immutable fixed scope, bounds, count, and canonical events', async () => {
    const serialized = await fixture();
    const recording = verifyPortableRecording(serialized);

    expect(recording.manifest).toMatchObject({
      formatVersion: 'daily-trader.market-data.recording.v1',
      eventSchemaVersion: 'daily-trader.market-data.one-minute-bar.v1',
      sourceSessionId: 'synthetic-aapl-spy-2026-07-13',
      instruments: [
        { symbol: 'AAPL', venue: 'XNAS' },
        { symbol: 'SPY', venue: 'ARCX' },
      ],
      provider: 'alpaca',
      feed: 'iex',
      entitlement: 'real_time',
      delayMilliseconds: 0,
      sessionStart: '2026-07-13T13:30:00.000Z',
      sessionEnd: '2026-07-13T13:33:00.000Z',
      eventCount: 6,
      configurationVersion: 'phase2-fixture-v1',
      freshnessThresholdMs: 120_000,
      sourceMetadata: {
        kind: 'synthetic_fixture',
        containsRawProviderFrames: false,
      },
    });
    expect(recording.manifest.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(recording.events).toHaveLength(6);
    expect(Object.isFrozen(recording)).toBe(true);
    expect(Object.isFrozen(recording.manifest)).toBe(true);
    for (const item of recording.events) {
      expect(JSON.stringify(item.event)).not.toContain('rawPayload');
      expect(item.canonicalJson).toBe(JSON.stringify(item.event));
    }
  });

  it('contains compatible gap, correction, and out-of-order cases without duplicate IDs', async () => {
    const recording = verifyPortableRecording(await fixture());
    const tracker = new MarketEventOrderingTracker();
    const results = recording.events.map(({ event }) => tracker.classify(event, event.receivedAt));

    expect(results.map(({ classification }) => classification)).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'accepted',
      'correction',
      'out_of_order',
    ]);
    expect(results[2]).toMatchObject({ gap: { state: 'gapped', missingIntervalCount: 1 } });
    expect(new Set(recording.events.map(({ event }) => event.eventId)).size).toBe(6);
  });

  it('exports the ordered ledger events to the exact committed canonical bytes', async () => {
    const expected = await fixture();
    const verified = verifyPortableRecording(expected);
    const exported = await exportPortableRecording(
      {
        readCanonicalEvents: (sourceSessionId) => {
          expect(sourceSessionId).toBe('synthetic-aapl-spy-2026-07-13');
          return Promise.resolve(verified.events.map(({ canonicalJson }) => canonicalJson));
        },
      },
      {
        sourceSessionId: 'synthetic-aapl-spy-2026-07-13',
        configurationVersion: 'phase2-fixture-v1',
        freshnessThresholdMs: 120_000,
        sourceMetadata: {
          kind: 'synthetic_fixture',
          description: 'Synthetic AAPL and SPY bars for deterministic Phase 2 replay tests.',
          containsRawProviderFrames: false,
        },
      },
    );

    expect(exported).toBe(expected);
  });
});

describe('portable recording rejection', () => {
  it.each([
    ['truncated', (value: string) => value.slice(0, -20), 'recording_malformed'],
    [
      'noncanonical whitespace',
      (value: string) => value.replace('  "events":', '   "events":'),
      'recording_noncanonical',
    ],
  ] as const)('rejects %s input', async (_name, mutate, code) => {
    const mutated = mutate(await fixture());
    expect(() => verifyPortableRecording(mutated)).toThrowError(expect.objectContaining({ code }));
  });

  it.each([
    [
      'unknown format',
      (value: ReturnType<typeof decodedFixture>) => {
        value.manifest.formatVersion = 'unknown';
      },
      'format_unsupported',
    ],
    [
      'unknown manifest event schema',
      (value: ReturnType<typeof decodedFixture>) => {
        value.manifest.eventSchemaVersion = 'unknown';
      },
      'event_schema_unsupported',
    ],
    [
      'unknown event schema',
      (value: ReturnType<typeof decodedFixture>) => {
        const first = value.events[0];
        if (first !== undefined) first.schemaVersion = 'unknown';
      },
      'event_schema_unsupported',
    ],
    [
      'unsupported manifest scope',
      (value: ReturnType<typeof decodedFixture>) => {
        value.manifest.instruments = [
          { symbol: 'AAPL', venue: 'XNAS' },
          { symbol: 'SPY', venue: 'XNAS' },
        ];
      },
      'scope_unsupported',
    ],
    [
      'unsupported event instrument',
      (value: ReturnType<typeof decodedFixture>) => {
        const first = value.events[0];
        if (first !== undefined) first.instrument = { symbol: 'MSFT', venue: 'XNAS' };
      },
      'scope_unsupported',
    ],
    [
      'wrong count',
      (value: ReturnType<typeof decodedFixture>) => {
        value.manifest.eventCount = 7;
      },
      'count_mismatch',
    ],
    [
      'wrong bounds',
      (value: ReturnType<typeof decodedFixture>) => {
        value.manifest.sessionEnd = '2026-07-13T13:34:00.000Z';
      },
      'bounds_mismatch',
    ],
    [
      'wrong checksum',
      (value: ReturnType<typeof decodedFixture>) => {
        value.manifest.checksum = '0'.repeat(64);
      },
      'checksum_mismatch',
    ],
    [
      'invalid freshness threshold',
      (value: ReturnType<typeof decodedFixture>) => {
        value.manifest.freshnessThresholdMs = 59_999;
      },
      'manifest_invalid',
    ],
    [
      'incomplete AAPL/SPY scope',
      (value: ReturnType<typeof decodedFixture>) => {
        value.events = value.events.filter((event) => {
          const instrument = event.instrument as Record<string, unknown>;
          return instrument.symbol === 'AAPL';
        });
        value.manifest.eventCount = value.events.length;
      },
      'incomplete_scope',
    ],
    [
      'duplicate ledger event',
      (value: ReturnType<typeof decodedFixture>) => {
        const first = value.events[0];
        if (first !== undefined) value.events.push(first);
        value.manifest.eventCount = value.events.length;
      },
      'duplicate_event',
    ],
  ] as const)('rejects %s', async (_name, mutate, code) => {
    const decoded = decodedFixture(await fixture());
    mutate(decoded);
    expect(() => verifyPortableRecording(canonical(decoded))).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('rejects an event object whose fields are not in canonical order', async () => {
    const decoded = decodedFixture(await fixture());
    const first = decoded.events[0];
    if (first === undefined) throw new Error('fixture must contain an event');
    decoded.events[0] = { kind: first.kind, ...first };

    expect(() => verifyPortableRecording(canonical(decoded))).toThrowError(
      expect.objectContaining({ code: 'event_noncanonical' }),
    );
  });

  it('translates ledger reader failure and noncanonical ledger JSON', async () => {
    const request = {
      sourceSessionId: 'fixture-session',
      configurationVersion: 'phase2-v1',
      freshnessThresholdMs: 120_000,
      sourceMetadata: {
        kind: 'normalized_ledger' as const,
        description: 'Sanitized normalized ledger export.',
        containsRawProviderFrames: false as const,
      },
    };
    await expect(
      exportPortableRecording(
        { readCanonicalEvents: () => Promise.reject(new Error('database secret')) },
        request,
      ),
    ).rejects.toEqual(new MarketDataRecordingError('reader_failed'));
    await expect(
      exportPortableRecording({ readCanonicalEvents: () => Promise.resolve(['{}']) }, request),
    ).rejects.toMatchObject({ code: 'event_noncanonical' });
  });
});
