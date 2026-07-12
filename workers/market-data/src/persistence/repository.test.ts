import { createUtcTimestamp } from '@daily-trader/domain';
import {
  MARKET_DATA_SCHEMA_VERSION,
  createOneMinuteBarEvent,
  deserializeOneMinuteBarEvent,
  serializeOneMinuteBarEvent,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import { describe, expect, it } from 'vitest';

import {
  MarketDataPersistenceError,
  MarketDataRepository,
  type PersistMarketDataEntry,
  type SqlPool,
  type SqlPoolClient,
  type SqlQueryResult,
  type SqlRow,
} from './repository.js';

interface FakeSession {
  readonly sessionId: string;
  readonly mode: string;
  readonly provider: string;
  readonly feed: string;
  readonly entitlement: string;
  readonly configurationVersion: string;
  readonly freshnessThresholdMs: number;
  readonly startedAt: string;
  endedAt: string | undefined;
}

interface FakeLedgerEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly orderingKey: string;
  readonly classification: string;
  readonly timeliness: string;
  readonly gapState: string;
  readonly symbol: string;
  readonly venue: string;
  readonly interval: string;
  readonly barStart: string;
  readonly receivedAt: string;
  readonly eventJson: string;
  readonly queryValues: readonly unknown[];
}

interface FakeCanonicalBar {
  readonly symbol: string;
  readonly venue: string;
  readonly barStart: string;
  readonly eventId: string;
  readonly receivedAt: string;
}

interface FakeGap {
  readonly symbol: string;
  readonly venue: string;
  readonly barStart: string;
  readonly sourceEventId: string;
  status: 'detected' | 'observed_later';
}

interface FakeSnapshot {
  readonly ledger: Map<string, FakeLedgerEvent>;
  readonly canonical: Map<string, FakeCanonicalBar>;
  readonly gaps: Map<string, FakeGap>;
  readonly sessionEvents: readonly FakeSessionEvent[];
}

interface FakeSessionEvent {
  readonly sessionId: string;
  readonly eventId: string;
  readonly sequence: number;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a string`);
  }
  return value;
}

function requiredStrings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${field} must contain strings`);
  }
  return value as readonly string[];
}

function sqlResult<Row extends SqlRow>(
  rows: readonly SqlRow[] = [],
  rowCount: number | null = rows.length,
): SqlQueryResult<Row> {
  return { rows: rows as readonly Row[], rowCount };
}

function marker(text: string): string {
  return /market-data:([a-z-]+)/u.exec(text)?.[1] ?? text.trim();
}

function comparePrecedence(
  left: Pick<FakeCanonicalBar, 'receivedAt' | 'eventId'>,
  right: Pick<FakeCanonicalBar, 'receivedAt' | 'eventId'>,
): number {
  const receivedComparison = left.receivedAt.localeCompare(right.receivedAt);
  return receivedComparison === 0 ? left.eventId.localeCompare(right.eventId) : receivedComparison;
}

class FakeSqlDatabase {
  public sessions = new Map<string, FakeSession>();
  public ledger = new Map<string, FakeLedgerEvent>();
  public canonical = new Map<string, FakeCanonicalBar>();
  public gaps = new Map<string, FakeGap>();
  public sessionEvents: FakeSessionEvent[] = [];
  public readonly commands: string[] = [];
  public readonly calls: Array<{
    readonly command: string;
    readonly values: readonly unknown[];
  }> = [];
  public failCommand: string | undefined;
  #snapshot: FakeSnapshot | undefined;

  public async query<Row extends SqlRow = SqlRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    await Promise.resolve();
    const command = marker(text);
    this.commands.push(command);
    this.calls.push({ command, values: [...values] });
    if (command === this.failCommand) {
      throw new Error('scripted SQL failure with sensitive detail');
    }

    if (command === 'BEGIN') {
      this.#snapshot = {
        ledger: new Map(this.ledger),
        canonical: new Map(this.canonical),
        gaps: new Map([...this.gaps].map(([key, gap]) => [key, { ...gap }])),
        sessionEvents: [...this.sessionEvents],
      };
      return sqlResult<Row>([], null);
    }
    if (command === 'COMMIT') {
      this.#snapshot = undefined;
      return sqlResult<Row>([], null);
    }
    if (command === 'ROLLBACK') {
      if (this.#snapshot !== undefined) {
        this.ledger = this.#snapshot.ledger;
        this.canonical = this.#snapshot.canonical;
        this.gaps = this.#snapshot.gaps;
        this.sessionEvents = [...this.#snapshot.sessionEvents];
      }
      this.#snapshot = undefined;
      return sqlResult<Row>([], null);
    }
    if (command === 'create-session') {
      const sessionId = requiredString(values[0], 'sessionId');
      if (this.sessions.has(sessionId)) {
        throw new Error('duplicate session');
      }
      this.sessions.set(sessionId, {
        sessionId,
        mode: requiredString(values[1], 'mode'),
        provider: requiredString(values[2], 'provider'),
        feed: requiredString(values[3], 'feed'),
        entitlement: requiredString(values[4], 'entitlement'),
        configurationVersion: requiredString(values[5], 'configurationVersion'),
        freshnessThresholdMs: Number(values[6]),
        startedAt: requiredString(values[7], 'startedAt'),
        endedAt: undefined,
      });
      return sqlResult<Row>([], 1);
    }
    if (command === 'ensure-replay-session') {
      const sessionId = requiredString(values[0], 'sessionId');
      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, {
          sessionId,
          mode: 'replay',
          provider: requiredString(values[1], 'provider'),
          feed: requiredString(values[2], 'feed'),
          entitlement: requiredString(values[3], 'entitlement'),
          configurationVersion: requiredString(values[4], 'configurationVersion'),
          freshnessThresholdMs: Number(values[5]),
          startedAt: requiredString(values[6], 'startedAt'),
          endedAt: undefined,
        });
      }
      return sqlResult<Row>([], 1);
    }
    if (command === 'select-replay-session') {
      const session = this.sessions.get(requiredString(values[0], 'sessionId'));
      return session === undefined
        ? sqlResult<Row>()
        : sqlResult<Row>([
            {
              mode: session.mode,
              provider: session.provider,
              feed: session.feed,
              entitlement: session.entitlement,
              configuration_version: session.configurationVersion,
              freshness_threshold_ms: session.freshnessThresholdMs,
              is_open: session.endedAt === undefined,
            },
          ]);
    }
    if (command === 'close-session') {
      const endedAt = requiredString(values[0], 'endedAt');
      const sessionId = requiredString(values[1], 'sessionId');
      const session = this.sessions.get(sessionId);
      if (session === undefined || session.endedAt !== undefined) {
        return sqlResult<Row>([], 0);
      }
      session.endedAt = endedAt;
      return sqlResult<Row>([], 1);
    }
    if (command === 'select-open-session') {
      const session = this.sessions.get(requiredString(values[0], 'sessionId'));
      return session === undefined
        ? sqlResult<Row>()
        : sqlResult<Row>([{ is_open: session.endedAt === undefined }]);
    }
    if (command === 'select-duplicate') {
      const stored = this.ledger.get(requiredString(values[0], 'eventId'));
      return stored === undefined
        ? sqlResult<Row>()
        : sqlResult<Row>([
            {
              event_json: stored.eventJson,
              arrival_classification: stored.classification,
              timeliness: stored.timeliness,
              gap_state: stored.gapState,
            },
          ]);
    }
    if (command === 'lock-market-series') {
      return sqlResult<Row>([], 1);
    }
    if (command === 'select-session-event-link') {
      const sessionId = requiredString(values[0], 'sessionId');
      const eventId = requiredString(values[1], 'eventId');
      return this.sessionEvents.some(
        (item) => item.sessionId === sessionId && item.eventId === eventId,
      )
        ? sqlResult<Row>([{ linked: 1 }])
        : sqlResult<Row>();
    }
    if (command === 'insert-session-event-link') {
      const sessionId = requiredString(values[0], 'sessionId');
      const eventId = requiredString(values[1], 'eventId');
      if (
        !this.sessionEvents.some((item) => item.sessionId === sessionId && item.eventId === eventId)
      ) {
        this.sessionEvents.push({
          sessionId,
          eventId,
          sequence: this.sessionEvents.length + 1,
        });
      }
      return sqlResult<Row>([], 1);
    }
    if (command === 'select-correction') {
      const orderingKey = requiredString(values[0], 'orderingKey');
      const stored = [...this.ledger.values()]
        .filter((candidate) => candidate.orderingKey === orderingKey)
        .sort(
          (left, right) =>
            right.receivedAt.localeCompare(left.receivedAt) ||
            right.eventId.localeCompare(left.eventId),
        )[0];
      return stored === undefined
        ? sqlResult<Row>()
        : sqlResult<Row>([{ gap_state: stored.gapState }]);
    }
    if (command === 'select-latest-series-event') {
      const [symbol, venue, interval] = values.map((value, index) =>
        requiredString(value, `series[${index}]`),
      );
      const stored = [...this.ledger.values()]
        .filter(
          (candidate) =>
            candidate.symbol === symbol &&
            candidate.venue === venue &&
            candidate.interval === interval &&
            (candidate.timeliness === 'fresh' || candidate.timeliness === 'late'),
        )
        .sort(
          (left, right) =>
            right.barStart.localeCompare(left.barStart) ||
            right.receivedAt.localeCompare(left.receivedAt) ||
            right.eventId.localeCompare(left.eventId),
        )[0];
      return stored === undefined
        ? sqlResult<Row>()
        : sqlResult<Row>([{ event_json: stored.eventJson, gap_state: stored.gapState }]);
    }
    if (command === 'insert-ledger-event') {
      const stored: FakeLedgerEvent = {
        eventId: requiredString(values[0], 'eventId'),
        sessionId: requiredString(values[1], 'sessionId'),
        orderingKey: requiredString(values[4], 'orderingKey'),
        classification: requiredString(values[5], 'classification'),
        timeliness: requiredString(values[6], 'timeliness'),
        gapState: requiredString(values[7], 'gapState'),
        symbol: requiredString(values[8], 'symbol'),
        venue: requiredString(values[9], 'venue'),
        interval: requiredString(values[10], 'interval'),
        barStart: requiredString(values[20], 'barStart'),
        receivedAt: requiredString(values[22], 'receivedAt'),
        eventJson: requiredString(values[29], 'eventJson'),
        queryValues: [...values],
      };
      this.ledger.set(stored.eventId, stored);
      return sqlResult<Row>([], 1);
    }
    if (command === 'mark-gap-observed') {
      const key = values
        .slice(0, 3)
        .map((value) => requiredString(value, 'gapKey'))
        .join('|');
      const gap = this.gaps.get(key);
      if (gap !== undefined) {
        gap.status = 'observed_later';
        return sqlResult<Row>([], 1);
      }
      return sqlResult<Row>([], 0);
    }
    if (command === 'insert-gaps') {
      const symbol = requiredString(values[0], 'symbol');
      const venue = requiredString(values[1], 'venue');
      const sourceEventId = requiredString(values[3], 'sourceEventId');
      for (const barStart of requiredStrings(values[4], 'missingIntervals')) {
        const key = `${symbol}|${venue}|${barStart}`;
        if (!this.gaps.has(key)) {
          this.gaps.set(key, {
            symbol,
            venue,
            barStart,
            sourceEventId,
            status: 'detected',
          });
        }
      }
      return sqlResult<Row>([], 1);
    }
    if (command === 'upsert-canonical-bar') {
      const candidate: FakeCanonicalBar = {
        symbol: requiredString(values[0], 'symbol'),
        venue: requiredString(values[1], 'venue'),
        barStart: requiredString(values[2], 'barStart'),
        eventId: requiredString(values[4], 'eventId'),
        receivedAt: requiredString(values[20], 'receivedAt'),
      };
      const key = `${candidate.symbol}|${candidate.venue}|${candidate.barStart}`;
      const existing = this.canonical.get(key);
      if (existing === undefined || comparePrecedence(candidate, existing) > 0) {
        this.canonical.set(key, candidate);
        return sqlResult<Row>([{ event_id: candidate.eventId }], 1);
      }
      return sqlResult<Row>([], 0);
    }
    if (command === 'select-latest-bars') {
      const observedAt = requiredString(values[0], 'observedAt');
      const latestBySymbol = new Map<string, FakeCanonicalBar>();
      for (const canonical of this.canonical.values()) {
        const ledger = this.ledger.get(canonical.eventId);
        if (ledger === undefined) {
          throw new Error('canonical row missing ledger');
        }
        const event = deserializeOneMinuteBarEvent(ledger.eventJson);
        if (event.barEnd > observedAt) {
          continue;
        }
        const latest = latestBySymbol.get(canonical.symbol);
        if (
          latest === undefined ||
          canonical.barStart > latest.barStart ||
          (canonical.barStart === latest.barStart && canonical.eventId > latest.eventId)
        ) {
          latestBySymbol.set(canonical.symbol, canonical);
        }
      }
      const rows = [...latestBySymbol.values()]
        .sort((left, right) => left.symbol.localeCompare(right.symbol))
        .map((canonical) => {
          const ledger = this.ledger.get(canonical.eventId);
          if (ledger === undefined) {
            throw new Error('canonical row missing ledger');
          }
          return {
            event_json: ledger.eventJson,
            arrival_classification: ledger.classification,
            timeliness: ledger.timeliness,
            gap_state: ledger.gapState,
          };
        });
      return sqlResult<Row>(rows);
    }
    if (command === 'select-last-event') {
      const event = [...this.ledger.values()].sort(
        (left, right) =>
          right.receivedAt.localeCompare(left.receivedAt) ||
          right.eventId.localeCompare(left.eventId),
      )[0];
      return event === undefined
        ? sqlResult<Row>()
        : sqlResult<Row>([{ event_json: event.eventJson }]);
    }
    if (command === 'select-session-events') {
      const sessionId = requiredString(values[0], 'sessionId');
      return sqlResult<Row>(
        this.sessionEvents
          .filter((link) => link.sessionId === sessionId)
          .sort((left, right) => left.sequence - right.sequence)
          .map((link) => this.ledger.get(link.eventId))
          .map((event) => {
            if (event === undefined) throw new Error('session link missing ledger event');
            return { event_json: event.eventJson };
          }),
      );
    }

    throw new Error(`Unexpected SQL command: ${command}`);
  }
}

class FakeSqlClient implements SqlPoolClient {
  readonly #database: FakeSqlDatabase;
  readonly #onRelease: () => void;

  public constructor(database: FakeSqlDatabase, onRelease: () => void) {
    this.#database = database;
    this.#onRelease = onRelease;
  }

  public query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    return this.#database.query<Row>(text, values);
  }

  public release(): void {
    this.#onRelease();
  }
}

class FakeSqlPool implements SqlPool {
  public readonly database = new FakeSqlDatabase();
  public releasedClients = 0;
  public endCalls = 0;
  public destroyCalls = 0;

  public connect(): Promise<SqlPoolClient> {
    return Promise.resolve(
      new FakeSqlClient(this.database, () => {
        this.releasedClients += 1;
      }),
    );
  }

  public query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    return this.database.query<Row>(text, values);
  }

  public end(): Promise<void> {
    this.endCalls += 1;
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    this.destroyCalls += 1;
    return Promise.resolve();
  }
}

interface EventOverrides {
  readonly symbol?: 'AAPL' | 'SPY';
  readonly providerTimestamp?: string;
  readonly receivedAt?: string;
  readonly processedAt?: string;
  readonly open?: string;
  readonly high?: string;
  readonly low?: string;
  readonly close?: string;
  readonly volume?: string;
}

function event(overrides: EventOverrides = {}): OneMinuteBarEvent {
  const symbol = overrides.symbol ?? 'AAPL';
  const receivedAt = overrides.receivedAt ?? '2026-07-13T13:31:00.100Z';
  return createOneMinuteBarEvent({
    symbol,
    venue: symbol === 'AAPL' ? 'XNAS' : 'ARCX',
    providerTimestamp: overrides.providerTimestamp ?? '2026-07-13T13:30:00Z',
    receivedAt,
    processedAt: overrides.processedAt ?? receivedAt,
    open: overrides.open ?? '100',
    high: overrides.high ?? '102',
    low: overrides.low ?? '99',
    close: overrides.close ?? '101',
    volume: overrides.volume ?? '1000',
  });
}

function entry(value: OneMinuteBarEvent, sessionId = 'fixture-2026-07-13'): PersistMarketDataEntry {
  return {
    sessionId,
    eventId: value.eventId,
    orderingKey: value.orderingKey,
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    eventJson: serializeOneMinuteBarEvent(value),
  };
}

async function repositoryWithSession(): Promise<{
  readonly pool: FakeSqlPool;
  readonly repository: MarketDataRepository;
}> {
  const pool = new FakeSqlPool();
  const repository = new MarketDataRepository(pool);
  await repository.createIngestionSession({
    sessionId: 'fixture-2026-07-13',
    mode: 'fixture',
    configurationVersion: 'phase2-v1',
    startedAt: createUtcTimestamp('2026-07-13T13:29:00.000Z'),
  });
  return { pool, repository };
}

describe('MarketDataRepository sessions and transactions', () => {
  it('creates and closes a named fixed-provider ingestion session', async () => {
    const { pool, repository } = await repositoryWithSession();

    expect(pool.database.sessions.get('fixture-2026-07-13')).toMatchObject({
      mode: 'fixture',
      provider: 'alpaca',
      feed: 'iex',
      entitlement: 'real_time',
      configurationVersion: 'phase2-v1',
      freshnessThresholdMs: 120_000,
    });

    await repository.closeIngestionSession(
      'fixture-2026-07-13',
      createUtcTimestamp('2026-07-13T20:00:00.000Z'),
    );
    await expect(repository.persistEntry(entry(event()))).rejects.toEqual(
      new MarketDataPersistenceError('session_not_open'),
    );
    expect(pool.database.commands).toContain('ROLLBACK');
  });

  it('ensures a deterministic replay session without reopening a completed session', async () => {
    const pool = new FakeSqlPool();
    const repository = new MarketDataRepository(pool);
    const input = {
      sessionId: 'replay-checksum',
      configurationVersion: 'phase2-v1',
      startedAt: createUtcTimestamp('2026-07-13T13:29:00.000Z'),
    };

    await expect(repository.ensureReplayIngestionSession(input)).resolves.toEqual({ open: true });
    await repository.closeIngestionSession(
      input.sessionId,
      createUtcTimestamp('2026-07-13T20:00:00.000Z'),
    );
    await expect(repository.ensureReplayIngestionSession(input)).resolves.toEqual({ open: false });

    const incompatible = new MarketDataRepository(pool, { freshnessThresholdMs: 180_000 });
    await expect(incompatible.ensureReplayIngestionSession(input)).rejects.toEqual(
      new MarketDataPersistenceError('session_invalid'),
    );
  });

  it('commits an accepted event once and detects redelivery idempotently', async () => {
    const { pool, repository } = await repositoryWithSession();
    const first = event();

    await expect(repository.persistEntry(entry(first))).resolves.toMatchObject({
      classification: 'accepted',
      timeliness: 'fresh',
      gapState: 'unknown',
      canonicalized: true,
    });
    await expect(repository.persistEntry(entry(first))).resolves.toMatchObject({
      classification: 'duplicate',
      canonicalized: false,
    });
    await repository.closeIngestionSession(
      'fixture-2026-07-13',
      createUtcTimestamp('2026-07-13T20:00:00.000Z'),
    );
    await expect(repository.persistEntry(entry(first))).resolves.toMatchObject({
      classification: 'duplicate',
      canonicalized: false,
    });

    expect(pool.database.ledger).toHaveLength(1);
    expect(pool.database.sessionEvents).toHaveLength(1);
    expect(pool.database.canonical).toHaveLength(1);
    expect(pool.database.commands.filter((command) => command === 'COMMIT')).toHaveLength(3);
    expect(pool.releasedClients).toBe(3);
    expect(pool.database.commands.indexOf('lock-market-series')).toBeLessThan(
      pool.database.commands.indexOf('select-duplicate'),
    );
  });

  it('links a globally duplicate event to a second open replay session', async () => {
    const { pool, repository } = await repositoryWithSession();
    const first = event();
    await repository.persistEntry(entry(first));
    await repository.createIngestionSession({
      sessionId: 'replay-second',
      mode: 'replay',
      configurationVersion: 'phase2-v1',
      startedAt: createUtcTimestamp('2026-07-13T13:29:00.000Z'),
    });

    await expect(repository.persistEntry(entry(first, 'replay-second'))).resolves.toMatchObject({
      classification: 'duplicate',
    });
    await expect(repository.readCanonicalEvents('replay-second')).resolves.toEqual([
      serializeOneMinuteBarEvent(first),
    ]);
    expect(pool.database.ledger).toHaveLength(1);
    expect(pool.database.sessionEvents).toHaveLength(2);
  });

  it('rolls back all writes when a later SQL operation fails', async () => {
    const { pool, repository } = await repositoryWithSession();
    pool.database.failCommand = 'upsert-canonical-bar';

    await expect(repository.persistEntry(entry(event()))).rejects.toEqual(
      new MarketDataPersistenceError('query_failed'),
    );

    expect(pool.database.commands.at(-1)).toBe('ROLLBACK');
    expect(pool.database.ledger).toHaveLength(0);
    expect(pool.database.canonical).toHaveLength(0);
    expect(pool.releasedClients).toBe(1);
  });

  it('deserializes and rejects malformed canonical JSON inside the transaction', async () => {
    const { pool, repository } = await repositoryWithSession();
    const valid = event();
    const malformed = { ...entry(valid), eventJson: '{"not":"canonical"}' };

    await expect(repository.persistEntry(malformed)).rejects.toThrowError();
    expect(pool.database.commands).toContain('BEGIN');
    expect(pool.database.commands.at(-1)).toBe('ROLLBACK');
    expect(pool.database.ledger).toHaveLength(0);
  });
});

describe('MarketDataRepository ordering, gaps, and canonical precedence', () => {
  it('classifies corrections and chooses canonical content by receivedAt then eventId', async () => {
    const { pool, repository } = await repositoryWithSession();
    const laterReceipt = event({
      close: '101',
      receivedAt: '2026-07-13T13:31:10.000Z',
      processedAt: '2026-07-13T13:31:10.001Z',
    });
    const earlierReceipt = event({
      close: '100.5',
      receivedAt: '2026-07-13T13:31:05.000Z',
      processedAt: '2026-07-13T13:40:00.000Z',
    });

    await repository.persistEntry(entry(laterReceipt));
    await expect(repository.persistEntry(entry(earlierReceipt))).resolves.toMatchObject({
      classification: 'correction',
      canonicalized: false,
    });

    expect(pool.database.canonical.values().next().value).toMatchObject({
      eventId: laterReceipt.eventId,
      receivedAt: laterReceipt.receivedAt,
    });
    const reverse = await repositoryWithSession();
    await reverse.repository.persistEntry(entry(earlierReceipt));
    await reverse.repository.persistEntry(entry(laterReceipt));
    expect(reverse.pool.database.canonical.values().next().value).toMatchObject({
      eventId: laterReceipt.eventId,
      receivedAt: laterReceipt.receivedAt,
    });
  });

  it('classifies a newly seen older bar as out of order', async () => {
    const { repository } = await repositoryWithSession();
    await repository.persistEntry(
      entry(
        event({
          providerTimestamp: '2026-07-13T13:33:00Z',
          receivedAt: '2026-07-13T13:34:00.000Z',
        }),
      ),
    );

    await expect(
      repository.persistEntry(
        entry(
          event({
            providerTimestamp: '2026-07-13T13:32:00Z',
            receivedAt: '2026-07-13T13:34:01.000Z',
          }),
        ),
      ),
    ).resolves.toMatchObject({ classification: 'out_of_order' });
  });

  it('records every detectable missing core-session interval', async () => {
    const { pool, repository } = await repositoryWithSession();
    await repository.persistEntry(entry(event()));
    const later = event({
      providerTimestamp: '2026-07-13T13:33:00Z',
      receivedAt: '2026-07-13T13:34:00.000Z',
    });

    await expect(repository.persistEntry(entry(later))).resolves.toMatchObject({
      classification: 'accepted',
      gapState: 'gapped',
    });

    expect([...pool.database.gaps.values()]).toEqual([
      expect.objectContaining({ barStart: '2026-07-13T13:31:00.000Z', status: 'detected' }),
      expect.objectContaining({ barStart: '2026-07-13T13:32:00.000Z', status: 'detected' }),
    ]);

    await repository.persistEntry(
      entry(
        event({
          providerTimestamp: '2026-07-13T13:31:00Z',
          receivedAt: '2026-07-13T13:34:01.000Z',
        }),
      ),
    );
    expect(pool.database.gaps.get('AAPL|XNAS|2026-07-13T13:31:00.000Z')?.status).toBe(
      'observed_later',
    );
    expect(pool.database.gaps.get('AAPL|XNAS|2026-07-13T13:32:00.000Z')?.status).toBe('detected');
  });

  it('appends outside-session and unknown-calendar events without canonicalizing them', async () => {
    const { pool, repository } = await repositoryWithSession();
    const outside = event({
      providerTimestamp: '2026-07-13T12:30:00Z',
      receivedAt: '2026-07-13T12:31:00.000Z',
    });
    const unknown = event({
      providerTimestamp: '2029-01-02T14:30:00Z',
      receivedAt: '2029-01-02T14:31:00.000Z',
    });

    await expect(repository.persistEntry(entry(outside))).resolves.toMatchObject({
      timeliness: 'outside_session',
      canonicalized: false,
    });
    await expect(repository.persistEntry(entry(unknown))).resolves.toMatchObject({
      timeliness: 'unknown',
      canonicalized: false,
    });

    expect(pool.database.ledger).toHaveLength(2);
    expect(pool.database.canonical).toHaveLength(0);
  });

  it('passes canonical exact strings directly to PostgreSQL NUMERIC parameters', async () => {
    const { pool, repository } = await repositoryWithSession();
    const exact = event({
      open: '90071992547409931234567890.1200',
      high: '90071992547409931234567890.9900',
      low: '90071992547409931234567890.0100',
      close: '90071992547409931234567890.3400',
      volume: '123456789012345678901234567890.0000',
    });

    await repository.persistEntry(entry(exact));

    const stored = pool.database.ledger.get(exact.eventId);
    expect(stored?.queryValues.slice(24, 29)).toEqual([
      '90071992547409931234567890.12',
      '90071992547409931234567890.99',
      '90071992547409931234567890.01',
      '90071992547409931234567890.34',
      '123456789012345678901234567890',
    ]);
    expect(stored?.eventJson).toBe(serializeOneMinuteBarEvent(exact));
  });
});

describe('MarketDataRepository latest queries and lifecycle', () => {
  it('reads validated canonical session events in ledger insertion order', async () => {
    const { repository } = await repositoryWithSession();
    const first = event({
      providerTimestamp: '2026-07-13T13:32:00Z',
      receivedAt: '2026-07-13T13:33:00.000Z',
    });
    const second = event({
      providerTimestamp: '2026-07-13T13:30:00Z',
      receivedAt: '2026-07-13T13:33:01.000Z',
    });
    await repository.persistEntry(entry(first));
    await repository.persistEntry(entry(second));

    await expect(repository.readCanonicalEvents('fixture-2026-07-13')).resolves.toEqual([
      serializeOneMinuteBarEvent(first),
      serializeOneMinuteBarEvent(second),
    ]);
  });

  it('returns AAPL/SPY deterministically while excluding future bars', async () => {
    const { repository } = await repositoryWithSession();
    const aaplCurrent = event();
    const spyCurrent = event({ symbol: 'SPY' });
    const aaplFuture = event({
      providerTimestamp: '2026-07-13T13:32:00Z',
      receivedAt: '2026-07-13T13:33:00.000Z',
    });
    await repository.persistEntry(entry(aaplCurrent));
    await repository.persistEntry(entry(spyCurrent));
    await repository.persistEntry(entry(aaplFuture));

    const beforeFutureEnds = await repository.findLatestBars(
      createUtcTimestamp('2026-07-13T13:32:30.000Z'),
    );
    expect(beforeFutureEnds.map((bar) => bar.event.eventId)).toEqual([
      aaplCurrent.eventId,
      spyCurrent.eventId,
    ]);
    expect(beforeFutureEnds.every((bar) => bar.current)).toBe(true);

    const afterFutureEnds = await repository.findLatestBars(
      createUtcTimestamp('2026-07-13T13:34:00.000Z'),
    );
    expect(afterFutureEnds[0]?.event.eventId).toBe(aaplFuture.eventId);
  });

  it('never reports a late or stale bar as current', async () => {
    const { repository } = await repositoryWithSession();
    const late = event({
      receivedAt: '2026-07-13T13:34:00.001Z',
      processedAt: '2026-07-13T13:34:00.001Z',
    });
    await repository.persistEntry(entry(late));

    const bars = await repository.findLatestBars(createUtcTimestamp('2026-07-13T13:34:00.001Z'));
    expect(bars[0]).toMatchObject({
      timeliness: 'late',
      current: false,
      freshness: { state: 'stale' },
    });
  });

  it('reports the last successful ledger arrival even when it is not the latest bar', async () => {
    const { repository } = await repositoryWithSession();
    await repository.persistEntry(
      entry(
        event({
          providerTimestamp: '2026-07-13T13:32:00Z',
          receivedAt: '2026-07-13T13:33:00.000Z',
        }),
      ),
    );
    const laterArrivalForOlderBar = event({
      providerTimestamp: '2026-07-13T13:30:00Z',
      receivedAt: '2026-07-13T13:33:20.000Z',
    });
    await repository.persistEntry(entry(laterArrivalForOlderBar));

    await expect(repository.findLastEventReceivedAt()).resolves.toBe(
      laterArrivalForOlderBar.receivedAt,
    );
  });

  it('uses the configured freshness threshold for persistence and current state', async () => {
    const pool = new FakeSqlPool();
    const repository = new MarketDataRepository(pool, { freshnessThresholdMs: 180_000 });
    await repository.createIngestionSession({
      sessionId: 'fixture-2026-07-13',
      mode: 'fixture',
      configurationVersion: 'phase2-v1',
      startedAt: createUtcTimestamp('2026-07-13T13:29:00.000Z'),
    });
    const delayed = event({
      receivedAt: '2026-07-13T13:34:00.000Z',
      processedAt: '2026-07-13T13:34:00.000Z',
    });

    await expect(repository.persistEntry(entry(delayed))).resolves.toMatchObject({
      timeliness: 'fresh',
    });
    await expect(
      repository.findLatestBars(createUtcTimestamp('2026-07-13T13:34:00.000Z')),
    ).resolves.toEqual([expect.objectContaining({ current: true })]);
  });

  it('closes the production pool at most once', async () => {
    const pool = new FakeSqlPool();
    const repository = new MarketDataRepository(pool);

    const first = repository.close();
    expect(repository.close()).toBe(first);
    await first;
    expect(pool.endCalls).toBe(1);
  });

  it('force-closes the production pool at most once', async () => {
    const pool = new FakeSqlPool();
    const repository = new MarketDataRepository(pool);

    const first = repository.forceClose();
    expect(repository.forceClose()).toBe(first);
    await first;
    expect(pool.destroyCalls).toBe(1);
  });
});
