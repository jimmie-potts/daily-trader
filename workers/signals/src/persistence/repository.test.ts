import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import {
  MARKET_DATA_SCHEMA_VERSION,
  PHASE_2_INSTRUMENTS,
  addUtcMilliseconds,
  createCanonicalRevision,
  createOneMinuteBarEvent,
  serializeOneMinuteBarEvent,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import {
  computeFeatureResult,
  createSignalConfiguration,
  evaluateBreakoutPlusVolume,
  serializeSignalEvaluation,
  type SignalEvaluation,
} from '@daily-trader/signals';
import { describe, expect, it } from 'vitest';

import type { SignalsWorkerError } from '../errors.js';
import { SignalsRepository, type JournalRevision, type LiveRunClaim } from './repository.js';
import type { SqlClient, SqlPool, SqlQueryResult, SqlRow } from './sql.js';

const WORKER_OWNER_ID = 'signal-worker-test';

class FakePool implements SqlPool {
  public constructor(private readonly response: SqlQueryResult) {}

  public query<Row extends SqlRow = SqlRow>(): Promise<SqlQueryResult<Row>> {
    return Promise.resolve(this.response as SqlQueryResult<Row>);
  }

  public connect(): Promise<SqlClient> {
    throw new Error('not used');
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    return Promise.resolve();
  }
}

class CutoverPool implements SqlPool {
  public readonly queries: string[] = [];
  public readonly parameterSets: (readonly unknown[] | undefined)[] = [];

  public constructor(
    public writerCapabilityAvailable: boolean,
    public statusLeaseAvailable = true,
    public captureRows: readonly SqlRow[] = [],
    public closingPresent = false,
  ) {}

  public query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    return this.execute<Row>(text, values);
  }

  public connect(): Promise<SqlClient> {
    return Promise.resolve({
      query: <Row extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]) =>
        this.execute<Row>(text, values),
      release: () => undefined,
    });
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    return Promise.resolve();
  }

  private execute<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    this.queries.push(text);
    this.parameterSets.push(values);
    if (text.includes("to_regclass('market_data_canonical_revisions')")) {
      return Promise.resolve({
        rows: [{ available: true }] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    if (text.includes('FROM market_data_canonical_revision_counter')) {
      return Promise.resolve({
        rows: [{ next_position: '1' }] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    if (
      text.includes('FROM market_data_ingestion_sessions AS session') &&
      text.includes('market_data_writer_capabilities')
    ) {
      return Promise.resolve({
        rows: [{ available: this.writerCapabilityAvailable }] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    if (text.includes("FROM signal_runs WHERE source_kind = 'live_journal' AND capture_active")) {
      return Promise.resolve({
        rows: this.captureRows as unknown as readonly Row[],
        rowCount: this.captureRows.length,
      });
    }
    if (
      text.includes('SELECT EXISTS') &&
      text.includes("source_kind = 'live_journal' AND state = 'closing'")
    ) {
      return Promise.resolve({
        rows: [{ present: this.closingPresent }] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    if (text.includes('WITH ranked AS')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('UPDATE signal_worker_status') && text.includes('RETURNING claim_fence')) {
      return Promise.resolve({
        rows: (this.statusLeaseAvailable
          ? [{ claim_fence: '1' }]
          : []) as unknown as readonly Row[],
        rowCount: this.statusLeaseAvailable ? 1 : 0,
      });
    }
    if (text.includes('UPDATE signal_runs SET claim_fence = claim_fence + 1')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
}

class RecordingTransactionPool implements SqlPool {
  public readonly queries: { readonly text: string; readonly values?: readonly unknown[] }[] = [];

  public query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    return this.execute(text, values);
  }

  public connect(): Promise<SqlClient> {
    return Promise.resolve({
      query: <Row extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]) =>
        this.execute<Row>(text, values),
      release: () => undefined,
    });
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    return Promise.resolve();
  }

  private execute<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    this.queries.push({ text, ...(values === undefined ? {} : { values }) });
    if (text.includes('SELECT count(*)::bigint AS backlog_count')) {
      return Promise.resolve({
        rows: [{ backlog_count: '0' }] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
}

function statusBar(symbol: 'AAPL' | 'SPY'): OneMinuteBarEvent {
  const start = createUtcTimestamp('2026-07-13T13:58:00.000Z');
  const receivedAt = addUtcMilliseconds(start, 65_000);
  return createOneMinuteBarEvent({
    symbol,
    venue: PHASE_2_INSTRUMENTS[symbol].venue,
    providerTimestamp: start,
    receivedAt,
    processedAt: receivedAt,
    open: symbol === 'AAPL' ? '199' : '599',
    high: symbol === 'AAPL' ? '201.125' : '601.125',
    low: symbol === 'AAPL' ? '198.875' : '598.875',
    close: symbol === 'AAPL' ? '200.5' : '600.5',
    volume: symbol === 'AAPL' ? '1500' : '2500',
  });
}

class StatusPool implements SqlPool {
  public readonly queries: string[] = [];
  public readonly AAPL = statusBar('AAPL');
  public readonly SPY = statusBar('SPY');

  public query<Row extends SqlRow = SqlRow>(text: string): Promise<SqlQueryResult<Row>> {
    this.queries.push(text);
    if (text.includes('WITH selected_run AS')) {
      return Promise.resolve({
        rowCount: 1,
        rows: [
          {
            lifecycle: 'running',
            active_run_id: 'live-test',
            heartbeat_at: new Date('2026-07-13T14:00:00.000Z'),
            last_evaluated_bar_start: new Date('2026-07-13T13:58:00.000Z'),
            revision_gap_detected: false,
            backlog_count: '0',
            failure_code: null,
            run_id: 'live-test',
            state: 'active',
            cursor_position: '5',
            stop_position: null,
            definition_version: 'breakout_plus_volume.v1',
            configuration_version: 'phase3-v1',
            configuration_hash: 'a'.repeat(64),
            arithmetic_policy_version: 'daily-trader.signals.arithmetic.bigjs.v1',
            calendar_version: 'nyse-core-2026-2028.v1',
            market_event_schema_version: 'daily-trader.market-data.one-minute-bar.v1',
            revision_schema_version: 'daily-trader.market-data.canonical-revision.v1',
            feature_schema_version: 'daily-trader.signals.feature-result.v1',
            evaluation_schema_version: 'daily-trader.signals.evaluation.v1',
            data_quality_policy_version: 'daily-trader.market-data.quality.v1',
            freshness_threshold_ms: 120_000,
            lookback_window: 20,
            volume_multiplier: '1.5',
          },
        ] as unknown as readonly Row[],
      });
    }
    if (text.includes('FROM signal_run_latest_evaluations AS current')) {
      return Promise.resolve({
        rowCount: 2,
        rows: [
          {
            projection_kind: 'latest',
            instrument_symbol: 'AAPL',
            instrument_venue: 'XNAS',
            evaluation_bar_start: new Date('2026-07-13T13:58:00.000Z'),
            outcome: 'not_fired',
            reason: 'conditions_not_met',
            direction: null,
            observation_as_of: new Date('2026-07-13T13:59:05.000Z'),
            knowledge_as_of: new Date('2026-07-13T13:59:05.000Z'),
            evaluation_mode: 'on_time',
            close_price: '200.5',
            source_provider: 'alpaca',
            source_feed: 'iex',
            source_entitlement: 'real_time',
            breakout_reference: null,
            prior_high: '201.125',
            prior_low: '198.875',
            current_volume: '1500',
            prior_volume_sum: '20000',
            prior_count: 20,
            volume_multiplier: '1.5',
            window_start: new Date('2026-07-13T13:38:00.000Z'),
            window_end: new Date('2026-07-13T13:57:00.000Z'),
            invalidation_condition: null,
            occurrence_id: null,
          },
          {
            projection_kind: 'latest_fired',
            instrument_symbol: 'AAPL',
            instrument_venue: 'XNAS',
            evaluation_bar_start: new Date('2026-07-13T13:57:00.000Z'),
            outcome: 'fired',
            reason: 'upward_breakout_with_confirmed_volume',
            direction: 'upward',
            observation_as_of: new Date('2026-07-13T13:58:05.000Z'),
            knowledge_as_of: new Date('2026-07-13T13:58:05.000Z'),
            evaluation_mode: 'on_time',
            close_price: '202',
            source_provider: 'alpaca',
            source_feed: 'iex',
            source_entitlement: 'real_time',
            breakout_reference: '201.125',
            prior_high: '201.125',
            prior_low: '198.875',
            current_volume: '3000',
            prior_volume_sum: '20000',
            prior_count: 20,
            volume_multiplier: '1.5',
            window_start: new Date('2026-07-13T13:37:00.000Z'),
            window_end: new Date('2026-07-13T13:56:00.000Z'),
            invalidation_condition:
              '{"kind":"close_returns_inside_prior_range","operator":"less_than_or_equal","reference":"201.125"}',
            occurrence_id: 'b'.repeat(64),
          },
        ] as unknown as readonly Row[],
      });
    }
    if (text.includes('SELECT DISTINCT ON (bar.instrument_symbol)')) {
      return Promise.resolve({
        rowCount: 2,
        rows: [
          { event_json: serializeOneMinuteBarEvent(this.AAPL), freshness_threshold_ms: 120_000 },
          { event_json: serializeOneMinuteBarEvent(this.SPY), freshness_threshold_ms: 180_000 },
        ] as unknown as readonly Row[],
      });
    }
    throw new TypeError(`unexpected status query: ${text}`);
  }

  public connect(): Promise<SqlClient> {
    throw new Error('not used');
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    return Promise.resolve();
  }
}

function signalBar(input: {
  readonly minute: number;
  readonly high: string;
  readonly low: string;
  readonly close?: string;
  readonly volume: string;
}): OneMinuteBarEvent {
  const start = createUtcTimestamp(
    new Date(Date.parse('2026-07-13T13:30:00.000Z') + input.minute * 60_000).toISOString(),
  );
  const receivedAt = addUtcMilliseconds(start, 70_000);
  return createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: start,
    receivedAt,
    processedAt: addUtcMilliseconds(receivedAt, 1_000),
    open: '100',
    high: input.high,
    low: input.low,
    close: input.close ?? '100',
    volume: input.volume,
  });
}

function liveCommitFixture(): Readonly<{
  evaluation: SignalEvaluation;
  revision: JournalRevision;
}> {
  const configuration = createSignalConfiguration({
    configurationVersion: 'phase3-conflict-test-v1',
    lookbackBars: 3,
    volumeMultiplier: '1.5',
    freshnessThresholdMs: 120_000,
  });
  const bars = Object.freeze([
    signalBar({ minute: 0, high: '101', low: '98', volume: '100' }),
    signalBar({ minute: 1, high: '103', low: '97', volume: '200' }),
    signalBar({ minute: 2, high: '102', low: '96', volume: '300' }),
    signalBar({ minute: 3, high: '110', low: '95', close: '106', volume: '400' }),
  ]);
  const event = bars[3];
  if (event === undefined) throw new TypeError('missing evaluation event');
  const feature = computeFeatureResult({
    canonicalBars: bars,
    evaluationEventId: event.eventId,
    configuration,
  });
  const evaluation = evaluateBreakoutPlusVolume(feature, configuration);
  if (evaluation.outcome !== 'fired') throw new TypeError('expected fired evaluation fixture');
  const revision = createCanonicalRevision({
    operation: 'insert',
    processingPosition: '1',
    logicalBarKey: event.orderingKey,
    previousCanonicalEventId: null,
    newCanonicalEventId: event.eventId,
    marketEventSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    arrival: { classification: 'accepted', historical: false, outOfOrder: false },
    gap: { state: 'complete', filledKnownGap: false },
  });
  return Object.freeze({
    evaluation,
    revision: Object.freeze({
      revision,
      event,
      journaledAt: createUtcTimestamp('2026-07-13T13:35:00.000Z'),
      arrivalClassification: 'accepted',
      gapState: 'complete',
    }),
  });
}

type LiveConflictKind = 'extra_evidence' | 'missing_evidence' | 'occurrence';

class LiveConflictPool implements SqlPool {
  public readonly queries: string[] = [];

  public constructor(
    private readonly evaluation: SignalEvaluation,
    private readonly conflict: LiveConflictKind,
    private readonly cursorValue = '0',
  ) {}

  public query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    return this.execute(text, values);
  }

  public connect(): Promise<SqlClient> {
    return Promise.resolve({
      query: <Row extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]) =>
        this.execute<Row>(text, values),
      release: () => undefined,
    });
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    return Promise.resolve();
  }

  private execute<Row extends SqlRow = SqlRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    void _values;
    this.queries.push(text);
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('UPDATE signal_worker_status') && text.includes('SET claim_expires_at')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('UPDATE signal_runs') && text.includes('SET claim_expires_at')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('FROM signal_runs AS run JOIN signal_run_cursors AS cursor')) {
      return Promise.resolve({
        rows: [
          {
            run_id: 'live-test',
            state: 'active',
            configuration_hash: this.evaluation.featureResult.semantics.configurationHash,
            operational_configuration_hash: 'b'.repeat(64),
            start_position: '0',
            stop_position: null,
            cursor_position: '0',
            cursor_value: this.cursorValue,
            claim_fence: '7',
            claim_owner_id: WORKER_OWNER_ID,
            claim_lease_ms: 30_000,
            claim_renew_interval_ms: 10_000,
            capture_active: true,
          },
        ] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    if (text.includes('INSERT INTO signal_evaluations')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('SELECT canonical_payload FROM signal_evaluations WHERE evaluation_id')) {
      return Promise.resolve({
        rows: [
          { canonical_payload: serializeSignalEvaluation(this.evaluation) },
        ] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    if (text.includes('INSERT INTO signal_evaluation_evidence')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('SELECT role, ordinal, event_id FROM signal_evaluation_evidence')) {
      const expected = [...this.evaluation.featureResult.evidence]
        .map(({ role, ordinal, eventId }) => ({ role, ordinal, event_id: eventId }))
        .sort((left, right) => left.role.localeCompare(right.role) || left.ordinal - right.ordinal);
      const rows =
        this.conflict === 'missing_evidence'
          ? expected.slice(0, -1)
          : this.conflict === 'extra_evidence'
            ? [...expected, { role: 'reference' as const, ordinal: 999, event_id: 'f'.repeat(64) }]
            : expected;
      return Promise.resolve({
        rows: rows as unknown as readonly Row[],
        rowCount: rows.length,
      });
    }
    if (text.includes('INSERT INTO signal_occurrences')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('FROM signal_occurrences WHERE evaluation_id')) {
      if (this.evaluation.outcome !== 'fired') throw new TypeError('expected fired evaluation');
      return Promise.resolve({
        rows: [
          {
            occurrence_id: this.evaluation.occurrence.occurrenceId,
            direction: this.evaluation.direction,
            canonical_payload: '{"mismatched":true}',
          },
        ] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    throw new TypeError(`unexpected live conflict query: ${text}`);
  }
}

const signalConfiguration = createSignalConfiguration({
  configurationVersion: 'phase3-v1',
  lookbackBars: 20,
  volumeMultiplier: '1.5',
  freshnessThresholdMs: 120_000,
});

const operationalConfiguration = {
  journalPollIntervalMs: 250,
  claimBatchSize: 50,
  queueCapacity: 1_000,
  claimLeaseMs: 30_000,
  claimRenewIntervalMs: 10_000,
  retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 5_000, jitterPercent: 10 },
  backlogLimit: 10_000,
  statementTimeoutMs: 10_000,
  shutdownTimeoutMs: 10_000,
} as const;

const cutoverClock = new FixedClock(createUtcTimestamp('2026-07-13T13:30:00.000Z'));

describe('SignalsRepository journal ordering', () => {
  const claim: LiveRunClaim = {
    runId: 'live-test',
    state: 'active',
    cursorPosition: '0',
    stopPosition: null,
    fenceToken: '1',
    ownerId: WORKER_OWNER_ID,
    statusFenceToken: '1',
    leaseDurationMs: 30_000,
    renewIntervalMs: 10_000,
  };

  it('stops on a genuine commit-position gap before decoding payload content', async () => {
    const repository = new SignalsRepository(
      new FakePool({
        rowCount: 1,
        rows: [
          {
            position: '2',
            revision_id: '0'.repeat(64),
            operation: 'insert',
            ordering_key: 'XNAS:AAPL|1m|2026-07-06T14:00:00.000Z',
            previous_event_id: null,
            new_event_id: '1'.repeat(64),
            historical: false,
            arrival_classification: 'accepted',
            gap_state: 'complete',
            filled_known_gap: false,
            journaled_at: new Date('2026-07-06T14:01:00.000Z'),
            event_json: 'not-decoded-after-gap',
          },
        ],
      }),
      WORKER_OWNER_ID,
    );

    await expect(repository.readRevisions(claim, 10)).rejects.toMatchObject({
      code: 'journal_gap',
    } satisfies Partial<SignalsWorkerError>);
  });

  it('rejects a JavaScript number at the BIGINT position boundary', async () => {
    const repository = new SignalsRepository(
      new FakePool({ rowCount: 1, rows: [{ position: 1 }] }),
      WORKER_OWNER_ID,
    );
    await expect(repository.readRevisions(claim, 10)).rejects.toMatchObject({
      code: 'stored_data_invalid',
    } satisfies Partial<SignalsWorkerError>);
  });
});

describe('SignalsRepository paper writer capability cutover', () => {
  it('rejects a missing, future-dated, retired, or incompatible open paper writer before run mutation', async () => {
    const pool = new CutoverPool(false);
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.enableOrResume(signalConfiguration, operationalConfiguration, cutoverClock),
    ).rejects.toMatchObject({
      code: 'writer_contract_unavailable',
    } satisfies Partial<SignalsWorkerError>);

    const counterLock = pool.queries.findIndex((query) =>
      query.includes('FROM market_data_canonical_revision_counter'),
    );
    const capabilityCheck = pool.queries.findIndex((query) =>
      query.includes('FROM market_data_ingestion_sessions AS session'),
    );
    expect(counterLock).toBeGreaterThan(-1);
    expect(capabilityCheck).toBeGreaterThan(counterLock);
    const capabilitySql = pool.queries[capabilityCheck] ?? '';
    expect(capabilitySql).toContain("session.mode = 'paper'");
    expect(capabilitySql).toContain('session.ended_at IS NULL');
    expect(capabilitySql).toContain("capability.capability_state <> 'accepted'");
    expect(capabilitySql).toContain('capability.revision_contract_version <> $1');
    expect(capabilitySql).toContain('capability.session_id IS NULL');
    expect(pool.queries.some((query) => query.includes('INSERT INTO signal_runs'))).toBe(false);
    expect(pool.queries.at(-1)).toBe('ROLLBACK');
  });

  it('binds cutover to the signal freshness threshold and data-quality policy', async () => {
    const pool = new CutoverPool(false);
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.enableOrResume(signalConfiguration, operationalConfiguration, cutoverClock),
    ).rejects.toMatchObject({
      code: 'writer_contract_unavailable',
    } satisfies Partial<SignalsWorkerError>);

    const capabilityCheck = pool.queries.findIndex((query) =>
      query.includes('FROM market_data_ingestion_sessions AS session'),
    );
    const capabilitySql = pool.queries[capabilityCheck] ?? '';
    expect(capabilitySql).toContain('capability.freshness_threshold_ms <> $2');
    expect(capabilitySql).toContain('capability.data_quality_policy_version <> $3');
    expect(pool.parameterSets[capabilityCheck]).toEqual([
      'daily-trader.market-data.canonical-revision.v1',
      120_000,
      'daily-trader.market-data.quality.v1',
    ]);
    expect(pool.queries.some((query) => query.includes('INSERT INTO signal_runs'))).toBe(false);
  });

  it('treats an exact accepted expired capability as an inactive writer', async () => {
    const pool = new CutoverPool(true);
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.enableOrResume(signalConfiguration, operationalConfiguration, cutoverClock),
    ).resolves.toMatchObject({ state: 'active' });

    const capabilitySql =
      pool.queries.find((query) =>
        query.includes('FROM market_data_ingestion_sessions AS session'),
      ) ?? '';
    expect(capabilitySql).not.toContain('capability.expires_at <= CURRENT_TIMESTAMP');
    expect(capabilitySql).toContain('capability.session_id IS NULL');
    expect(pool.queries.at(-1)).toBe('COMMIT');
  });

  it('rejects a second configuration rollover while a predecessor is still closing', async () => {
    const pool = new CutoverPool(
      true,
      true,
      [
        {
          run_id: 'live-pending-replacement',
          state: 'pending',
          configuration_hash: 'b'.repeat(64),
          operational_configuration_hash: 'c'.repeat(64),
        },
      ],
      true,
    );
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.enableOrResume(signalConfiguration, operationalConfiguration, cutoverClock),
    ).rejects.toMatchObject({
      code: 'configuration_conflict',
    } satisfies Partial<SignalsWorkerError>);

    expect(
      pool.queries.some(
        (query) =>
          query.includes('UPDATE signal_worker_status') && query.includes('RETURNING claim_fence'),
      ),
    ).toBe(false);
    expect(pool.queries.some((query) => query.includes('SET capture_active = false'))).toBe(false);
    expect(pool.queries.some((query) => query.includes('INSERT INTO signal_runs'))).toBe(false);
    expect(pool.queries.at(-1)).toBe('ROLLBACK');
  });

  it('enables capture when every open paper writer has a fresh accepted exact capability', async () => {
    const pool = new CutoverPool(true);
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.enableOrResume(signalConfiguration, operationalConfiguration, cutoverClock),
    ).resolves.toMatchObject({ state: 'active', cursorPosition: '0', fenceToken: '1' });

    expect(pool.queries.some((query) => query.includes('INSERT INTO signal_runs'))).toBe(true);
    expect(
      pool.queries.some(
        (query) =>
          query.includes('claim_owner_id = $1') &&
          query.includes('claim_expires_at > CURRENT_TIMESTAMP'),
      ),
    ).toBe(true);
    expect(pool.queries.at(-1)).toBe('COMMIT');
  });

  it('refuses to steal an unexpired worker status lease', async () => {
    const pool = new CutoverPool(true, false);
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.enableOrResume(signalConfiguration, operationalConfiguration, cutoverClock),
    ).rejects.toMatchObject({ code: 'cursor_conflict' } satisfies Partial<SignalsWorkerError>);

    expect(pool.queries.some((query) => query.includes('INSERT INTO signal_runs'))).toBe(false);
    expect(pool.queries.at(-1)).toBe('ROLLBACK');
  });

  it('allows the safer disable cutover without requiring a fresh writer capability', async () => {
    const pool = new CutoverPool(false);
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.disable(cutoverClock, operationalConfiguration.claimLeaseMs),
    ).resolves.toBeNull();

    expect(
      pool.queries.some((query) =>
        query.includes('FROM market_data_ingestion_sessions AS session'),
      ),
    ).toBe(false);
    expect(pool.queries.at(-1)).toBe('COMMIT');
  });
});

describe('SignalsRepository worker-status fencing', () => {
  const claim: LiveRunClaim = {
    runId: 'live-test',
    state: 'active',
    cursorPosition: '0',
    stopPosition: null,
    fenceToken: '7',
    ownerId: WORKER_OWNER_ID,
    statusFenceToken: '11',
    leaseDurationMs: 30_000,
    renewIntervalMs: 10_000,
  };

  it('marks an enabled idle worker running during its fenced backlog heartbeat', async () => {
    const pool = new RecordingTransactionPool();
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(repository.refreshBacklog(claim, 10_000, cutoverClock)).resolves.toBe('0');

    const heartbeat = pool.queries.find(({ text }) => text.includes('backlog_count = $3'));
    expect(heartbeat?.text).toContain(
      "lifecycle = CASE WHEN lifecycle = 'starting' THEN 'running' ELSE lifecycle END",
    );
    expect(heartbeat?.text).toContain('claim_owner_id = $4 AND claim_fence = $5');
    expect(heartbeat?.values).toEqual([
      claim.runId,
      cutoverClock.now(),
      '0',
      claim.ownerId,
      claim.statusFenceToken,
    ]);
  });

  it('conditions terminal heartbeat and failure writes on owner and status fence', async () => {
    const pool = new RecordingTransactionPool();
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await repository.heartbeat(claim, 'stopped', cutoverClock);
    await repository.fail(claim, 'journal_gap', cutoverClock);

    const singletonWrites = pool.queries.filter(({ text }) =>
      text.includes('UPDATE signal_worker_status SET'),
    );
    expect(singletonWrites).toHaveLength(2);
    for (const write of singletonWrites) {
      expect(write.text).toContain('claim_owner_id =');
      expect(write.text).toContain('claim_fence =');
      expect(write.values).toContain(WORKER_OWNER_ID);
      expect(write.values).toContain('11');
    }
  });
});

describe('SignalsRepository terminal status projection', () => {
  it('loads exact ready prior-range evidence and latest canonical market bars', async () => {
    const pool = new StatusPool();
    const status = await new SignalsRepository(pool, WORKER_OWNER_ID).status();

    expect(status.latest).toHaveLength(1);
    expect(status.latest[0]).toMatchObject({
      symbol: 'AAPL',
      outcome: 'not_fired',
      priorHigh: '201.125',
      priorLow: '198.875',
      priorVolumeSum: '20000',
      priorCount: 20,
    });
    expect(status.latestValidFired).toHaveLength(1);
    expect(status.latestValidFired[0]).toMatchObject({
      symbol: 'AAPL',
      evaluationBarStart: '2026-07-13T13:57:00.000Z',
      outcome: 'fired',
      direction: 'upward',
    });
    expect(status.latestMarketData.AAPL).toMatchObject({
      event: { eventId: pool.AAPL.eventId },
      freshnessThresholdMs: 120_000,
    });
    expect(status.latestMarketData.SPY).toMatchObject({
      event: { eventId: pool.SPY.eventId },
      freshnessThresholdMs: 180_000,
    });
    const signalProjectionQuery = pool.queries.find((query) =>
      query.includes('FROM signal_run_latest_evaluations AS current'),
    );
    expect(signalProjectionQuery).toContain('evaluation.prior_high, evaluation.prior_low');
    expect(signalProjectionQuery).toContain("VALUES ('AAPL'::text), ('SPY'::text)");
    expect(signalProjectionQuery).toContain('current.occurrence_id IS NOT NULL');
    expect(signalProjectionQuery).toContain('current.definition_version = run.definition_version');
    expect(signalProjectionQuery?.match(/LIMIT 1/gu)).toHaveLength(2);
    expect(
      pool.queries.find((query) => query.includes('SELECT DISTINCT ON (bar.instrument_symbol)')),
    ).toContain("bar.instrument_symbol IN ('AAPL', 'SPY')");
    expect(
      pool.queries.find((query) => query.includes('SELECT DISTINCT ON (bar.instrument_symbol)')),
    ).toContain('ledger.freshness_threshold_ms');
  });
});

describe('SignalsRepository idempotent evaluation conflicts', () => {
  const claim: LiveRunClaim = {
    runId: 'live-test',
    state: 'active',
    cursorPosition: '0',
    stopPosition: null,
    fenceToken: '7',
    ownerId: WORKER_OWNER_ID,
    statusFenceToken: '11',
    leaseDurationMs: 30_000,
    renewIntervalMs: 10_000,
  };

  it.each<LiveConflictKind>(['missing_evidence', 'extra_evidence'])(
    'rolls back and leaves the cursor unchanged for %s',
    async (conflict) => {
      const fixture = liveCommitFixture();
      const pool = new LiveConflictPool(fixture.evaluation, conflict);
      const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

      await expect(
        repository.commitRevision(claim, fixture.revision, [fixture.evaluation], cutoverClock),
      ).rejects.toMatchObject({
        code: 'stored_data_invalid',
      } satisfies Partial<SignalsWorkerError>);

      expect(pool.queries.some((query) => query.includes('UPDATE signal_run_cursors'))).toBe(false);
      expect(pool.queries.at(-1)).toBe('ROLLBACK');
    },
  );

  it('fails closed when the run and source cursor representations drift', async () => {
    const fixture = liveCommitFixture();
    const pool = new LiveConflictPool(fixture.evaluation, 'occurrence', '1');
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.commitRevision(claim, fixture.revision, [fixture.evaluation], cutoverClock),
    ).rejects.toMatchObject({
      code: 'cursor_conflict',
    } satisfies Partial<SignalsWorkerError>);

    expect(pool.queries.some((query) => query.includes('INSERT INTO signal_evaluations'))).toBe(
      false,
    );
    expect(pool.queries.at(-1)).toBe('ROLLBACK');
  });

  it('rolls back and leaves the cursor unchanged for a mismatched stored occurrence', async () => {
    const fixture = liveCommitFixture();
    const pool = new LiveConflictPool(fixture.evaluation, 'occurrence');
    const repository = new SignalsRepository(pool, WORKER_OWNER_ID);

    await expect(
      repository.commitRevision(claim, fixture.revision, [fixture.evaluation], cutoverClock),
    ).rejects.toMatchObject({
      code: 'stored_data_invalid',
    } satisfies Partial<SignalsWorkerError>);

    expect(pool.queries.some((query) => query.includes('UPDATE signal_run_cursors'))).toBe(false);
    expect(pool.queries.at(-1)).toBe('ROLLBACK');
  });
});
