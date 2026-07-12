import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import type { LatestPersistedBar } from './persistence/index.js';
import type { RedisEntryHandler, RedisMarketDataEntry } from './delivery/redis-stream.js';
import { verifyPortableRecording, type VerifiedMarketDataRecording } from './replay/index.js';
import {
  assertReplaySessionEvents,
  latestReceivedAtFromCanonicalEvents,
  overallGapState,
  parseMarketDataCliArguments,
  runMarketDataCli,
  summarizeVerifiedRecording,
  waitForPersistedReplay,
} from './market-data-cli.js';

const fixtureUrl = new URL(
  '../fixtures/recordings/synthetic-aapl-spy-session-v1.json',
  import.meta.url,
);

async function recording(): Promise<VerifiedMarketDataRecording> {
  return verifyPortableRecording(await readFile(fixtureUrl, 'utf8'));
}

async function asyncRedisEntry(
  index: number,
  targetSessionId = 'replay-target',
): Promise<RedisMarketDataEntry> {
  const item = (await recording()).events[index];
  if (item === undefined) {
    throw new TypeError('fixture event missing');
  }
  return Object.freeze({
    redisEntryId: `${String(index + 1)}-0`,
    sessionId: targetSessionId,
    eventId: item.event.eventId,
    orderingKey: item.event.orderingKey,
    eventJson: item.canonicalJson,
    schemaVersion: item.event.schemaVersion,
  });
}

class FakeConsumer {
  public readonly batches: Array<readonly RedisMarketDataEntry[]>;
  public processed = 0;
  public now = 0;

  public constructor(batches: Array<readonly RedisMarketDataEntry[]>) {
    this.batches = batches;
  }

  public readNew(blockMilliseconds: number): Promise<readonly RedisMarketDataEntry[]> {
    this.now += blockMilliseconds;
    return Promise.resolve(this.batches.shift() ?? []);
  }

  public async process(
    entries: readonly RedisMarketDataEntry[],
    handler: RedisEntryHandler,
  ): Promise<void> {
    for (const entry of entries) {
      await handler(entry);
      this.processed += 1;
    }
  }
}

describe('market-data CLI arguments and safe output', () => {
  it('parses the three bounded commands and default recording', () => {
    const verification = parseMarketDataCliArguments(['recording:verify']);
    expect(verification.name).toBe('recording:verify');
    if (verification.name !== 'recording:verify') throw new TypeError('unexpected command');
    expect(verification.path).toBeInstanceOf(URL);

    const replay = parseMarketDataCliArguments(['replay', './fixture.json']);
    expect(replay.name).toBe('replay');
    if (replay.name !== 'replay') throw new TypeError('unexpected command');
    expect(replay.path).toContain('fixture.json');
    expect(parseMarketDataCliArguments(['status'])).toEqual({ name: 'status' });
    expect(() => parseMarketDataCliArguments([])).toThrow();
    expect(() => parseMarketDataCliArguments(['status', 'extra'])).toThrow();
    expect(() => parseMarketDataCliArguments(['replay', 'one', 'two'])).toThrow();
  });

  it('summarizes only safe manifest and scope fields', async () => {
    const summary = summarizeVerifiedRecording(await recording());
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      event: 'market_data.recording.verified',
      eventCount: 6,
      provider: 'alpaca',
      feed: 'iex',
      entitlement: 'real_time',
      delayMilliseconds: 0,
    });
    expect(serialized).not.toContain('events');
    expect(serialized).not.toContain('description');
    expect(serialized).not.toContain('canonicalJson');
    expect(serialized).not.toContain('providerTimestamp');
  });

  it('runs credential-free verification and emits fixed safe failures', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    await expect(
      runMarketDataCli(['recording:verify'], {
        stdout: { write: (value) => stdout.push(value) },
        stderr: { write: (value) => stderr.push(value) },
      }),
    ).resolves.toBe(0);
    expect(stdout.join('')).toContain('market_data.recording.verified');
    expect(stderr).toEqual([]);

    await expect(
      runMarketDataCli(['unknown'], {
        stdout: { write: (value) => stdout.push(value) },
        stderr: { write: (value) => stderr.push(value) },
      }),
    ).resolves.toBe(1);
    expect(stderr.at(-1)).toBe(
      '{"event":"market_data.cli.usage","code":"MARKET_DATA_CLI_USAGE"}\n',
    );
  });
});

describe('market-data CLI status and persistence helpers', () => {
  it('derives the last successful event from every ledger arrival, not only latest bars', async () => {
    const canonicalEvents = (await recording()).events.map(({ canonicalJson }) => canonicalJson);

    expect(latestReceivedAtFromCanonicalEvents([...canonicalEvents].reverse())).toBe(
      '2026-07-13T13:33:20.000Z',
    );
    expect(latestReceivedAtFromCanonicalEvents([])).toBeUndefined();
  });

  it('reports gapped first, complete only for both symbols, otherwise unknown', async () => {
    const events = (await recording()).events;
    const base = {
      event: events[0]?.event,
      arrivalClassification: 'accepted',
      timeliness: 'fresh',
      freshness: { state: 'fresh', ageMs: 0, session: { state: 'open' } },
      current: true,
    } as unknown as LatestPersistedBar;
    const spy = { ...base, event: events[1]?.event } as LatestPersistedBar;

    expect(overallGapState([{ ...base, gapState: 'gapped' }])).toBe('gapped');
    expect(
      overallGapState([
        { ...base, gapState: 'complete' },
        { ...spy, gapState: 'complete' },
      ]),
    ).toBe('complete');
    expect(overallGapState([{ ...base, gapState: 'complete' }])).toBe('unknown');
  });

  it('waits until every target event is durably processed and counted', async () => {
    const entries = [await asyncRedisEntry(0), await asyncRedisEntry(1)];
    const consumer = new FakeConsumer([entries]);
    const persisted = new Set<string>();
    await waitForPersistedReplay(
      {
        consumer,
        persistEntry: (entry) => {
          persisted.add(entry.eventId);
          return Promise.resolve();
        },
        countPersisted: () => Promise.resolve(persisted.size),
        nowMilliseconds: () => consumer.now,
      },
      'replay-target',
      entries.map(({ eventId }) => eventId),
      1_000,
    );

    expect(consumer.processed).toBe(2);
    expect(persisted.size).toBe(2);
  });

  it('fails bounded waits for timeout and unexpected target events', async () => {
    const expected = await asyncRedisEntry(0);
    const empty = new FakeConsumer([]);
    await expect(
      waitForPersistedReplay(
        {
          consumer: empty,
          persistEntry: () => Promise.resolve(),
          countPersisted: () => Promise.resolve(0),
          nowMilliseconds: () => empty.now,
        },
        'replay-target',
        [expected.eventId],
        10,
      ),
    ).rejects.toThrow('persistence wait timed out');

    const unexpected = await asyncRedisEntry(1);
    const consumer = new FakeConsumer([[unexpected]]);
    let persistenceCalls = 0;
    await expect(
      waitForPersistedReplay(
        {
          consumer,
          persistEntry: () => {
            persistenceCalls += 1;
            return Promise.resolve();
          },
          countPersisted: () => Promise.resolve(0),
          nowMilliseconds: () => consumer.now,
        },
        'replay-target',
        [expected.eventId],
        1_000,
      ),
    ).rejects.toThrow('unexpected replay event');
    expect(persistenceCalls).toBe(0);
  });

  it('requires exact target-session membership and event ordering', async () => {
    const verified = await recording();
    const canonicalEvents = verified.events.map(({ canonicalJson }) => canonicalJson);

    expect(() => assertReplaySessionEvents(verified, canonicalEvents)).not.toThrow();
    expect(() => assertReplaySessionEvents(verified, canonicalEvents.slice(1))).toThrow(
      'unexpected events or ordering',
    );
    expect(() => assertReplaySessionEvents(verified, [...canonicalEvents].reverse())).toThrow(
      'unexpected events or ordering',
    );
  });
});
