import { createClient } from 'redis';

import { MARKET_DATA_SCHEMA_VERSION } from '@daily-trader/market-data';

export const MARKET_DATA_STREAM = 'daily-trader.market-data.v1';
export const MARKET_DATA_CONSUMER_GROUP = 'market-data-persistence-v1';
export const MARKET_DATA_STREAM_MAX_LENGTH = 10_000;
export const MARKET_DATA_CLAIM_IDLE_MILLISECONDS = 60_000;
export const MARKET_DATA_MAX_BATCH_SIZE = 100;

const EVENT_ID = /^[0-9a-f]{64}$/u;
const SESSION_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const ORDERING_KEY = /^[\x20-\x7e]{1,512}$/u;
const REDIS_ENTRY_ID = /^(?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/u;
const CONSUMER_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const STREAM_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const EXPECTED_FIELDS = new Set([
  'schema_version',
  'session_id',
  'event_id',
  'ordering_key',
  'event_json',
]);

export type RedisDeliveryErrorCode =
  | 'acknowledgement_failed'
  | 'connection_failed'
  | 'entry_malformed'
  | 'group_failed'
  | 'publish_failed'
  | 'read_failed'
  | 'retention_gap'
  | 'schema_unsupported'
  | 'shutdown_failed';

export class RedisDeliveryError extends Error {
  public readonly code: RedisDeliveryErrorCode;

  public constructor(code: RedisDeliveryErrorCode) {
    super(`Redis market-data delivery failed: ${code}`);
    this.name = 'RedisDeliveryError';
    this.code = code;
  }
}

export interface RedisCommandClient {
  readonly isOpen: boolean;
  connect(): Promise<void>;
  sendCommand(arguments_: readonly string[]): Promise<unknown>;
  close(): Promise<void>;
  destroy(): void;
}

export interface PublishableMarketDataEvent {
  readonly canonicalJson: string;
  readonly eventId: string;
  readonly orderingKey: string;
  readonly schemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
}

export interface RedisMarketDataEntry {
  readonly redisEntryId: string;
  readonly sessionId: string;
  readonly eventId: string;
  readonly orderingKey: string;
  readonly eventJson: string;
  readonly schemaVersion: typeof MARKET_DATA_SCHEMA_VERSION;
}

export interface RedisMarketDataConsumerOptions {
  readonly groupName?: string;
  readonly initialStreamId?: '0' | '$';
  readonly streamName?: string;
}

export interface RedisMarketDataPublisherOptions {
  readonly streamName?: string;
}

export function createRedisCommandClient(
  url: string,
  connectionTimeoutMs: number,
  queueCapacity: number,
): RedisCommandClient {
  const client = createClient({
    commandsQueueMaxLength: queueCapacity,
    socket: {
      connectTimeout: connectionTimeoutMs,
      reconnectStrategy: false,
    },
    url,
  });
  client.on('error', () => undefined);

  return {
    get isOpen(): boolean {
      return client.isOpen;
    },
    connect: async (): Promise<void> => {
      await client.connect();
    },
    sendCommand: (arguments_: readonly string[]): Promise<unknown> =>
      client.sendCommand([...arguments_]),
    close: async (): Promise<void> => {
      await client.close();
    },
    destroy: (): void => client.destroy(),
  };
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID.test(sessionId)) {
    throw new TypeError('sessionId must be a bounded lowercase application identifier');
  }
}

function validatePublishableEvent(event: PublishableMarketDataEvent): void {
  if (!EVENT_ID.test(event.eventId)) {
    throw new TypeError('eventId must be a lowercase SHA-256 digest');
  }
  if (!ORDERING_KEY.test(event.orderingKey)) {
    throw new TypeError('orderingKey must be bounded printable ASCII');
  }
  const runtimeSchemaVersion: unknown = event.schemaVersion;
  if (runtimeSchemaVersion !== MARKET_DATA_SCHEMA_VERSION) {
    throw new RedisDeliveryError('schema_unsupported');
  }
  const byteLength = Buffer.byteLength(event.canonicalJson, 'utf8');
  if (byteLength === 0 || byteLength > 65_536) {
    throw new TypeError('canonical event JSON must contain 1-65536 UTF-8 bytes');
  }
}

async function connect(client: RedisCommandClient): Promise<void> {
  if (client.isOpen) {
    return;
  }
  try {
    await client.connect();
  } catch {
    throw new RedisDeliveryError('connection_failed');
  }
}

export class RedisMarketDataPublisher {
  readonly #client: RedisCommandClient;
  readonly #streamName: string;

  public constructor(client: RedisCommandClient, options: RedisMarketDataPublisherOptions = {}) {
    const streamName = options.streamName ?? MARKET_DATA_STREAM;
    if (!STREAM_NAME.test(streamName)) {
      throw new TypeError('streamName must be a bounded lowercase application identifier');
    }
    this.#client = client;
    this.#streamName = streamName;
  }

  public async connect(): Promise<void> {
    await connect(this.#client);
  }

  public async publish(sessionId: string, event: PublishableMarketDataEvent): Promise<string> {
    validateSessionId(sessionId);
    validatePublishableEvent(event);
    await connect(this.#client);

    let response: unknown;
    try {
      response = await this.#client.sendCommand([
        'XADD',
        this.#streamName,
        'MAXLEN',
        '~',
        String(MARKET_DATA_STREAM_MAX_LENGTH),
        '*',
        'schema_version',
        String(event.schemaVersion),
        'session_id',
        sessionId,
        'event_id',
        event.eventId,
        'ordering_key',
        event.orderingKey,
        'event_json',
        event.canonicalJson,
      ]);
    } catch {
      throw new RedisDeliveryError('publish_failed');
    }

    if (typeof response !== 'string' || !REDIS_ENTRY_ID.test(response)) {
      throw new RedisDeliveryError('publish_failed');
    }
    return response;
  }

  public async close(): Promise<void> {
    if (!this.#client.isOpen) {
      return;
    }
    try {
      await this.#client.close();
    } catch {
      this.#client.destroy();
      throw new RedisDeliveryError('shutdown_failed');
    }
  }

  public async destroyStream(): Promise<void> {
    if (!this.#client.isOpen) return;
    let response: unknown;
    try {
      response = await this.#client.sendCommand(['DEL', this.#streamName]);
    } catch {
      throw new RedisDeliveryError('shutdown_failed');
    }
    if (response !== 0 && response !== 1) {
      throw new RedisDeliveryError('shutdown_failed');
    }
  }
}

function stringAt(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new RedisDeliveryError(
      field === 'schema_version' ? 'schema_unsupported' : 'entry_malformed',
    );
  }
  return value;
}

function parseFieldPairs(value: unknown): ReadonlyMap<string, string> {
  if (!Array.isArray(value) || value.length % 2 !== 0) {
    throw new RedisDeliveryError('entry_malformed');
  }
  const fields = new Map<string, string>();
  for (let index = 0; index < value.length; index += 2) {
    const name = stringAt(value[index], 'field');
    const fieldValue = stringAt(value[index + 1], name);
    if (!EXPECTED_FIELDS.has(name) || fields.has(name)) {
      throw new RedisDeliveryError('entry_malformed');
    }
    fields.set(name, fieldValue);
  }
  if (fields.size !== EXPECTED_FIELDS.size) {
    throw new RedisDeliveryError('entry_malformed');
  }
  return fields;
}

export function parseRedisMarketDataEntry(value: unknown): RedisMarketDataEntry {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new RedisDeliveryError('entry_malformed');
  }
  const redisEntryId = stringAt(value[0], 'redis_entry_id');
  if (!REDIS_ENTRY_ID.test(redisEntryId)) {
    throw new RedisDeliveryError('entry_malformed');
  }
  const fields = parseFieldPairs(value[1]);
  const schemaVersion = fields.get('schema_version');
  if (schemaVersion !== MARKET_DATA_SCHEMA_VERSION) {
    throw new RedisDeliveryError('schema_unsupported');
  }
  const sessionId = fields.get('session_id');
  const eventId = fields.get('event_id');
  const orderingKey = fields.get('ordering_key');
  const eventJson = fields.get('event_json');
  if (
    sessionId === undefined ||
    !SESSION_ID.test(sessionId) ||
    eventId === undefined ||
    !EVENT_ID.test(eventId) ||
    orderingKey === undefined ||
    !ORDERING_KEY.test(orderingKey) ||
    eventJson === undefined ||
    Buffer.byteLength(eventJson, 'utf8') > 65_536
  ) {
    throw new RedisDeliveryError('entry_malformed');
  }
  return Object.freeze({
    redisEntryId,
    sessionId,
    eventId,
    orderingKey,
    eventJson,
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
  });
}

function parseReadResponse(
  response: unknown,
  expectedStream: string,
): readonly RedisMarketDataEntry[] {
  if (response === null) {
    return [];
  }

  let entries: unknown;
  if (Array.isArray(response)) {
    // Redis returns a nested stream array under RESP2.
    if (response.length !== 1) {
      throw new RedisDeliveryError('entry_malformed');
    }
    const stream: unknown = response[0];
    if (!Array.isArray(stream) || stream.length !== 2 || stream[0] !== expectedStream) {
      throw new RedisDeliveryError('entry_malformed');
    }
    entries = stream[1];
  } else if (typeof response === 'object') {
    // Redis returns a stream-name map under RESP3, which is node-redis 6's default.
    const streamNames = Reflect.ownKeys(response);
    if (streamNames.length !== 1 || streamNames[0] !== expectedStream) {
      throw new RedisDeliveryError('entry_malformed');
    }
    entries = Object.getOwnPropertyDescriptor(response, expectedStream)?.value;
  } else {
    throw new RedisDeliveryError('entry_malformed');
  }

  if (!Array.isArray(entries)) {
    throw new RedisDeliveryError('entry_malformed');
  }
  return Object.freeze(entries.map((entry) => parseRedisMarketDataEntry(entry)));
}

function parseClaimResponse(response: unknown): readonly RedisMarketDataEntry[] {
  if (
    !Array.isArray(response) ||
    (response.length !== 2 && response.length !== 3) ||
    !Array.isArray(response[1])
  ) {
    throw new RedisDeliveryError('entry_malformed');
  }
  const deletedEntryIds: unknown = response[2] ?? [];
  if (
    !Array.isArray(deletedEntryIds) ||
    deletedEntryIds.some((entryId) => typeof entryId !== 'string' || !REDIS_ENTRY_ID.test(entryId))
  ) {
    throw new RedisDeliveryError('entry_malformed');
  }
  if (deletedEntryIds.length > 0) {
    throw new RedisDeliveryError('retention_gap');
  }
  return Object.freeze(response[1].map((entry) => parseRedisMarketDataEntry(entry)));
}

export type RedisEntryHandler = (entry: RedisMarketDataEntry) => Promise<void>;

function abortRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

export class RedisMarketDataConsumer {
  readonly #client: RedisCommandClient;
  readonly #consumerName: string;
  readonly #groupName: string;
  readonly #initialStreamId: '0' | '$';
  readonly #streamName: string;

  public constructor(
    client: RedisCommandClient,
    consumerName: string,
    options: RedisMarketDataConsumerOptions = {},
  ) {
    if (!CONSUMER_NAME.test(consumerName)) {
      throw new TypeError('consumerName must be a bounded lowercase application identifier');
    }
    const groupName = options.groupName ?? MARKET_DATA_CONSUMER_GROUP;
    if (!SESSION_ID.test(groupName)) {
      throw new TypeError('groupName must be a bounded lowercase application identifier');
    }
    const streamName = options.streamName ?? MARKET_DATA_STREAM;
    if (!STREAM_NAME.test(streamName)) {
      throw new TypeError('streamName must be a bounded lowercase application identifier');
    }
    this.#client = client;
    this.#consumerName = consumerName;
    this.#groupName = groupName;
    this.#initialStreamId = options.initialStreamId ?? '0';
    this.#streamName = streamName;
  }

  public async connect(): Promise<void> {
    await connect(this.#client);
    try {
      await this.#client.sendCommand([
        'XGROUP',
        'CREATE',
        this.#streamName,
        this.#groupName,
        this.#initialStreamId,
        'MKSTREAM',
      ]);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
        throw new RedisDeliveryError('group_failed');
      }
    }
  }

  public async readNew(blockMilliseconds = 1_000): Promise<readonly RedisMarketDataEntry[]> {
    if (
      !Number.isInteger(blockMilliseconds) ||
      blockMilliseconds < 1 ||
      blockMilliseconds > 5_000
    ) {
      throw new TypeError('blockMilliseconds must be between 1 and 5000');
    }
    let response: unknown;
    try {
      response = await this.#client.sendCommand([
        'XREADGROUP',
        'GROUP',
        this.#groupName,
        this.#consumerName,
        'COUNT',
        String(MARKET_DATA_MAX_BATCH_SIZE),
        'BLOCK',
        String(blockMilliseconds),
        'STREAMS',
        this.#streamName,
        '>',
      ]);
    } catch {
      throw new RedisDeliveryError('read_failed');
    }
    return parseReadResponse(response, this.#streamName);
  }

  public async claimPending(): Promise<readonly RedisMarketDataEntry[]> {
    let response: unknown;
    try {
      response = await this.#client.sendCommand([
        'XAUTOCLAIM',
        this.#streamName,
        this.#groupName,
        this.#consumerName,
        String(MARKET_DATA_CLAIM_IDLE_MILLISECONDS),
        '0-0',
        'COUNT',
        String(MARKET_DATA_MAX_BATCH_SIZE),
      ]);
    } catch {
      throw new RedisDeliveryError('read_failed');
    }
    return parseClaimResponse(response);
  }

  public async acknowledge(redisEntryId: string): Promise<void> {
    if (!REDIS_ENTRY_ID.test(redisEntryId)) {
      throw new TypeError('redisEntryId must use Redis stream ID syntax');
    }
    let response: unknown;
    try {
      response = await this.#client.sendCommand([
        'XACK',
        this.#streamName,
        this.#groupName,
        redisEntryId,
      ]);
    } catch {
      throw new RedisDeliveryError('acknowledgement_failed');
    }
    if (response !== 1) {
      throw new RedisDeliveryError('acknowledgement_failed');
    }
  }

  public async process(
    entries: readonly RedisMarketDataEntry[],
    handler: RedisEntryHandler,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const entry of entries) {
      if (signal?.aborted === true) {
        return;
      }
      await handler(entry);
      await this.acknowledge(entry.redisEntryId);
    }
  }

  public async run(signal: AbortSignal, handler: RedisEntryHandler): Promise<void> {
    while (!signal.aborted) {
      const pending = await this.claimPending();
      await this.process(pending, handler, signal);
      if (abortRequested(signal)) {
        return;
      }
      const entries = await this.readNew();
      await this.process(entries, handler, signal);
    }
  }

  public async destroyGroup(): Promise<void> {
    if (!this.#client.isOpen) {
      return;
    }
    let response: unknown;
    try {
      response = await this.#client.sendCommand([
        'XGROUP',
        'DESTROY',
        this.#streamName,
        this.#groupName,
      ]);
    } catch {
      throw new RedisDeliveryError('group_failed');
    }
    if (response !== 0 && response !== 1) {
      throw new RedisDeliveryError('group_failed');
    }
  }

  public async close(): Promise<void> {
    if (!this.#client.isOpen) {
      return;
    }
    try {
      await this.#client.close();
    } catch {
      this.#client.destroy();
      throw new RedisDeliveryError('shutdown_failed');
    }
  }
}
