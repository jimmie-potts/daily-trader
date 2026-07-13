import { describe, expect, it } from 'vitest';

import { MARKET_DATA_SCHEMA_VERSION } from '@daily-trader/market-data';

import {
  MARKET_DATA_CONSUMER_GROUP,
  MARKET_DATA_MAX_BATCH_SIZE,
  MARKET_DATA_STREAM,
  RedisDeliveryError,
  RedisMarketDataConsumer,
  RedisMarketDataPublisher,
  parseRedisMarketDataEntry,
  type RedisCommandClient,
} from './redis-stream.js';

const EVENT_ID = 'a'.repeat(64);

class FakeRedisClient implements RedisCommandClient {
  public isOpen = false;
  public readonly commands: string[][] = [];
  public readonly responses: unknown[] = [];
  public failWith: Error | undefined;

  public connect(): Promise<void> {
    this.isOpen = true;
    return Promise.resolve();
  }

  public sendCommand(arguments_: readonly string[]): Promise<unknown> {
    this.commands.push([...arguments_]);
    if (this.failWith !== undefined) {
      return Promise.reject(this.failWith);
    }
    return Promise.resolve(this.responses.shift());
  }

  public close(): Promise<void> {
    this.isOpen = false;
    return Promise.resolve();
  }

  public destroy(): void {
    this.isOpen = false;
  }
}

const fields = (schemaVersion: string = MARKET_DATA_SCHEMA_VERSION): string[] => [
  'schema_version',
  schemaVersion,
  'session_id',
  'fixture-2026-07-06',
  'event_id',
  EVENT_ID,
  'ordering_key',
  'XNAS:AAPL|PT1M|2026-07-06T13:30:00.000Z',
  'event_json',
  '{"schemaVersion":1}',
];

describe('Redis market-data publisher', () => {
  it('publishes only the versioned canonical fields with bounded retention', async () => {
    const client = new FakeRedisClient();
    client.responses.push('100-0');
    const publisher = new RedisMarketDataPublisher(client);

    await expect(
      publisher.publish('fixture-2026-07-06', {
        canonicalJson: '{"schemaVersion":1}',
        eventId: EVENT_ID,
        orderingKey: 'XNAS:AAPL|PT1M|2026-07-06T13:30:00.000Z',
        schemaVersion: MARKET_DATA_SCHEMA_VERSION,
      }),
    ).resolves.toBe('100-0');

    expect(client.commands[0]).toEqual([
      'XADD',
      MARKET_DATA_STREAM,
      'MAXLEN',
      '~',
      '10000',
      '*',
      ...fields(),
    ]);
  });

  it('translates command errors without exposing their message', async () => {
    const client = new FakeRedisClient();
    client.failWith = new Error('redis://user:secret@private.example');

    await expect(
      new RedisMarketDataPublisher(client).publish('fixture', {
        canonicalJson: '{}',
        eventId: EVENT_ID,
        orderingKey: 'key',
        schemaVersion: MARKET_DATA_SCHEMA_VERSION,
      }),
    ).rejects.toEqual(new RedisDeliveryError('publish_failed'));
  });
});

describe('Redis market-data entry parsing and consumption', () => {
  it('round-trips the fixed field contract', () => {
    expect(parseRedisMarketDataEntry(['101-0', fields()])).toEqual({
      redisEntryId: '101-0',
      sessionId: 'fixture-2026-07-06',
      eventId: EVENT_ID,
      orderingKey: 'XNAS:AAPL|PT1M|2026-07-06T13:30:00.000Z',
      eventJson: '{"schemaVersion":1}',
      schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    });
  });

  it('fails explicitly for unsupported schemas and unexpected fields', () => {
    expect(() => parseRedisMarketDataEntry(['101-0', fields('2')])).toThrowError(
      new RedisDeliveryError('schema_unsupported'),
    );
    expect(() =>
      parseRedisMarketDataEntry(['101-0', [...fields(), 'raw_payload', 'secret']]),
    ).toThrowError(new RedisDeliveryError('entry_malformed'));
  });

  it('creates the group, reclaims pending work, processes, then acknowledges', async () => {
    const client = new FakeRedisClient();
    client.responses.push('OK', ['0-0', [['101-0', fields()]], []], 1);
    const consumer = new RedisMarketDataConsumer(client, 'worker-1');
    const processed: string[] = [];

    await consumer.connect();
    const pending = await consumer.claimPending();
    await consumer.process(pending, (entry) => {
      processed.push(entry.eventId);
      return Promise.resolve();
    });

    expect(processed).toEqual([EVENT_ID]);
    expect(client.commands[0]).toEqual([
      'XGROUP',
      'CREATE',
      MARKET_DATA_STREAM,
      MARKET_DATA_CONSUMER_GROUP,
      '0',
      'MKSTREAM',
    ]);
    expect(client.commands[1]?.slice(0, 4)).toEqual([
      'XAUTOCLAIM',
      MARKET_DATA_STREAM,
      MARKET_DATA_CONSUMER_GROUP,
      'worker-1',
    ]);
    expect(client.commands[2]).toEqual([
      'XACK',
      MARKET_DATA_STREAM,
      MARKET_DATA_CONSUMER_GROUP,
      '101-0',
    ]);
  });

  it('reads RESP3 map replies without weakening the single-stream contract', async () => {
    const client = new FakeRedisClient();
    client.isOpen = true;
    client.responses.push({ [MARKET_DATA_STREAM]: [['101-0', fields()]] });
    const consumer = new RedisMarketDataConsumer(client, 'worker-1');

    await expect(consumer.readNew(25)).resolves.toEqual([
      expect.objectContaining({ redisEntryId: '101-0', eventId: EVENT_ID }),
    ]);
    expect(client.commands).toEqual([
      [
        'XREADGROUP',
        'GROUP',
        MARKET_DATA_CONSUMER_GROUP,
        'worker-1',
        'COUNT',
        String(MARKET_DATA_MAX_BATCH_SIZE),
        'BLOCK',
        '25',
        'STREAMS',
        MARKET_DATA_STREAM,
        '>',
      ],
    ]);
  });

  it('continues to read RESP2 array replies and rejects extra RESP3 streams', async () => {
    const client = new FakeRedisClient();
    client.isOpen = true;
    client.responses.push([[MARKET_DATA_STREAM, [['101-0', fields()]]]], {
      [MARKET_DATA_STREAM]: [],
      'daily-trader.market-data.unexpected': [],
    });
    const consumer = new RedisMarketDataConsumer(client, 'worker-1');

    await expect(consumer.readNew(25)).resolves.toHaveLength(1);
    await expect(consumer.readNew(25)).rejects.toEqual(new RedisDeliveryError('entry_malformed'));
  });

  it('does not acknowledge when durable handling fails', async () => {
    const client = new FakeRedisClient();
    client.isOpen = true;
    const consumer = new RedisMarketDataConsumer(client, 'worker-1');
    const entry = parseRedisMarketDataEntry(['101-0', fields()]);

    await expect(
      consumer.process([entry], () => Promise.reject(new Error('database unavailable'))),
    ).rejects.toThrow('database unavailable');
    expect(client.commands).toHaveLength(0);
  });

  it('fails explicitly when XAUTOCLAIM reports trimmed pending entries', async () => {
    const client = new FakeRedisClient();
    client.isOpen = true;
    client.responses.push(['0-0', [], ['99-0']]);

    await expect(new RedisMarketDataConsumer(client, 'worker-1').claimPending()).rejects.toEqual(
      new RedisDeliveryError('retention_gap'),
    );
  });

  it('supports isolated replay groups and destroys them explicitly', async () => {
    const client = new FakeRedisClient();
    client.responses.push('OK', 1);
    const consumer = new RedisMarketDataConsumer(client, 'replay-1', {
      groupName: 'replay-group-1',
      initialStreamId: '$',
    });

    await consumer.connect();
    await consumer.destroyGroup();

    expect(client.commands).toEqual([
      ['XGROUP', 'CREATE', MARKET_DATA_STREAM, 'replay-group-1', '$', 'MKSTREAM'],
      ['XGROUP', 'DESTROY', MARKET_DATA_STREAM, 'replay-group-1'],
    ]);
  });

  it('isolates a verification stream and removes its group and entries', async () => {
    const client = new FakeRedisClient();
    client.responses.push('OK', 1, 1);
    const streamName = 'daily-trader.market-data.verify.v1-1234567890';
    const consumer = new RedisMarketDataConsumer(client, 'verify-1', {
      groupName: 'verify-group-1',
      streamName,
    });
    const publisher = new RedisMarketDataPublisher(client, { streamName });

    await consumer.connect();
    await consumer.destroyGroup();
    await publisher.destroyStream();

    expect(client.commands).toEqual([
      ['XGROUP', 'CREATE', streamName, 'verify-group-1', '0', 'MKSTREAM'],
      ['XGROUP', 'DESTROY', streamName, 'verify-group-1'],
      ['DEL', streamName],
    ]);
  });

  it('leaves the next entry pending when shutdown is requested between entries', async () => {
    const client = new FakeRedisClient();
    client.isOpen = true;
    client.responses.push(1);
    const consumer = new RedisMarketDataConsumer(client, 'worker-1');
    const controller = new AbortController();
    const entries = [
      parseRedisMarketDataEntry(['101-0', fields()]),
      parseRedisMarketDataEntry(['102-0', fields()]),
    ];

    await consumer.process(
      entries,
      () => {
        controller.abort();
        return Promise.resolve();
      },
      controller.signal,
    );

    expect(client.commands).toEqual([
      ['XACK', MARKET_DATA_STREAM, MARKET_DATA_CONSUMER_GROUP, '101-0'],
    ]);
  });
});
