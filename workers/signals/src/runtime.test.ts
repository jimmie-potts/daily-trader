import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import type { AppLogger, AppMeter, MetricAttributes } from '@daily-trader/observability';
import { createSignalConfiguration } from '@daily-trader/signals';
import type { SignalOperationalConfiguration } from '@daily-trader/config';
import { describe, expect, it, vi } from 'vitest';

import type { SignalsWorkerConfig } from './config.js';
import { SignalsWorkerError } from './errors.js';
import type { LiveRunClaim, SignalsRepository } from './persistence/repository.js';
import {
  classifyRevisionCommitOutcome,
  drainClaim,
  runDisabledSignalsRuntime,
  runSignalsRuntime,
} from './runtime.js';

interface MetricObservation {
  readonly kind: 'counter' | 'gauge' | 'health' | 'histogram';
  readonly name: string;
  readonly value: number;
  readonly attributes?: MetricAttributes | undefined;
}

const CLOCK = new FixedClock(createUtcTimestamp('2026-07-13T14:00:00.000Z'));
const CONFIGURATION = createSignalConfiguration({
  configurationVersion: 'phase3-runtime-test-v1',
  lookbackBars: 3,
  volumeMultiplier: '1.5',
  freshnessThresholdMs: 120_000,
});
const OPERATIONAL: SignalOperationalConfiguration = Object.freeze({
  journalPollIntervalMs: 250,
  claimBatchSize: 50,
  queueCapacity: 1_000,
  retry: Object.freeze({
    maxAttempts: 5,
    baseDelayMs: 100,
    maxDelayMs: 5_000,
    jitterPercent: 10,
  }),
  backlogLimit: 10_000,
  statementTimeoutMs: 10_000,
  claimLeaseMs: 30_000,
  claimRenewIntervalMs: 10_000,
  shutdownTimeoutMs: 10_000,
});
const CLOSING_CLAIM: LiveRunClaim = Object.freeze({
  runId: 'live-runtime-test',
  state: 'closing',
  cursorPosition: '0',
  stopPosition: '0',
  fenceToken: '1',
  ownerId: 'signal-worker-runtime-test',
  statusFenceToken: '1',
  leaseDurationMs: 30_000,
  renewIntervalMs: 10_000,
});
const LOGGER: AppLogger = Object.freeze({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
});

function recordingMeter(observations: MetricObservation[]): AppMeter {
  return {
    addCounter: (name, value = 1, attributes): void => {
      observations.push({ kind: 'counter', name, value, attributes });
    },
    recordGauge: (name, value, _unit, attributes): void => {
      observations.push({ kind: 'gauge', name, value, attributes });
    },
    recordHealth: (state): void => {
      observations.push({
        kind: 'health',
        name: 'daily_trader.process.health',
        value: 1,
        attributes: { state },
      });
    },
    recordHistogram: (name, value, _unit, attributes): void => {
      observations.push({ kind: 'histogram', name, value, attributes });
    },
  };
}

describe('signal revision commit reconciliation', () => {
  it('retries while the durable cursor remains before the attempted revision', () => {
    expect(classifyRevisionCommitOutcome('41', '42')).toBe('pending');
  });

  it('accepts an exact cursor match as proof that an uncertain commit completed', () => {
    expect(classifyRevisionCommitOutcome('42', '42')).toBe('committed');
  });

  it('rejects a cursor that skipped beyond the serialized attempted revision', () => {
    expect(() => classifyRevisionCommitOutcome('43', '42')).toThrowError(
      new SignalsWorkerError('cursor_conflict'),
    );
  });

  it('rejects noncanonical BIGINT text at the boundary', () => {
    expect(() => classifyRevisionCommitOutcome('01', '2')).toThrowError(
      new SignalsWorkerError('stored_data_invalid'),
    );
    expect(() => classifyRevisionCommitOutcome('1', '0')).toThrowError(
      new SignalsWorkerError('stored_data_invalid'),
    );
  });
});

describe('signal runtime metrics', () => {
  it('records bounded reconstruction, backlog, cursor-lag, and drain observations', async () => {
    const observations: MetricObservation[] = [];
    const repository = {
      loadRunSettings: vi.fn(() =>
        Promise.resolve({ configuration: CONFIGURATION, operational: OPERATIONAL }),
      ),
      boundaries: vi.fn(() =>
        Promise.resolve(
          new Map([
            ['AAPL', createUtcTimestamp('2026-07-13T13:30:00.000Z')],
            ['SPY', createUtcTimestamp('2026-07-13T13:30:00.000Z')],
          ]),
        ),
      ),
      refreshBacklog: vi.fn(() => Promise.resolve('0')),
      readRevisions: vi.fn(() => Promise.resolve(Object.freeze([]))),
      completeIfDrained: vi.fn(() => Promise.resolve(true)),
    } as unknown as SignalsRepository;

    await expect(
      drainClaim(
        {
          repository,
          clock: CLOCK,
          logger: LOGGER,
          meter: recordingMeter(observations),
        },
        CLOSING_CLAIM,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();

    expect(observations.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'daily_trader.signal.reconstruction_latency',
        'daily_trader.signal.revision_backlog',
        'daily_trader.signal.cursor_lag',
        'daily_trader.signal.drain_latency',
      ]),
    );
    expect(
      observations.filter(({ name }) => name === 'daily_trader.signal.boundary_results'),
    ).toMatchObject([
      { attributes: { boundary: 'reconstruction', result: 'succeeded' } },
      { attributes: { boundary: 'drain', result: 'succeeded' } },
    ]);
    expect(JSON.stringify(observations)).not.toMatch(/event_id|evidence|run_id|session_id|symbol/u);
  });

  it('records lifecycle, claim latency, and a bounded terminal failure classification', async () => {
    const observations: MetricObservation[] = [];
    const failure = new SignalsWorkerError('capacity_exceeded');
    const fail = vi.fn(() => Promise.resolve());
    const repository = {
      enableOrResume: vi.fn(() => Promise.reject(failure)),
      fail,
      heartbeat: vi.fn(() => Promise.resolve()),
    } as unknown as SignalsRepository;
    const config: SignalsWorkerConfig = Object.freeze({
      environment: 'test',
      runtime: Object.freeze({ logLevel: 'info', telemetryExporter: 'none' }),
      worker: Object.freeze({ heartbeatIntervalMs: 1_000 }),
      signal: Object.freeze({
        mode: 'monitor',
        configuration: CONFIGURATION,
        operational: OPERATIONAL,
      }),
      database: Object.freeze({
        url: 'postgresql://daily_trader:daily_trader@localhost:5432/daily_trader',
        connectionTimeoutMs: 5_000,
      }),
    });

    await expect(
      runSignalsRuntime(
        {
          config,
          repository,
          clock: CLOCK,
          logger: LOGGER,
          meter: recordingMeter(observations),
        },
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);

    expect(
      observations.filter(({ name }) => name === 'daily_trader.signal.worker_lifecycle'),
    ).toMatchObject([{ attributes: { state: 'starting' } }, { attributes: { state: 'failed' } }]);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'daily_trader.signal.claim_latency' }),
        expect.objectContaining({
          name: 'daily_trader.signal.failures',
          attributes: { reason: 'capacity_exceeded' },
        }),
        expect.objectContaining({
          name: 'daily_trader.signal.failure_state',
          attributes: { reason: 'capacity_exceeded' },
        }),
      ]),
    );
    expect(fail).toHaveBeenCalledWith(null, 'capacity_exceeded', CLOCK);
  });

  it('preserves a processing failure when abort races with repository work', async () => {
    const observations: MetricObservation[] = [];
    const controller = new AbortController();
    const failure = new SignalsWorkerError('journal_gap');
    const fail = vi.fn(() => Promise.resolve());
    const heartbeat = vi.fn(() => Promise.resolve());
    const repository = {
      enableOrResume: vi.fn(() => Promise.resolve(CLOSING_CLAIM)),
      loadRunSettings: vi.fn(() =>
        Promise.resolve({ configuration: CONFIGURATION, operational: OPERATIONAL }),
      ),
      boundaries: vi.fn(() =>
        Promise.resolve(
          new Map([
            ['AAPL', createUtcTimestamp('2026-07-13T13:30:00.000Z')],
            ['SPY', createUtcTimestamp('2026-07-13T13:30:00.000Z')],
          ]),
        ),
      ),
      refreshBacklog: vi.fn(() => {
        controller.abort();
        return Promise.reject(failure);
      }),
      fail,
      heartbeat,
    } as unknown as SignalsRepository;
    const config: SignalsWorkerConfig = Object.freeze({
      environment: 'test',
      runtime: Object.freeze({ logLevel: 'info', telemetryExporter: 'none' }),
      worker: Object.freeze({ heartbeatIntervalMs: 1_000 }),
      signal: Object.freeze({
        mode: 'monitor',
        configuration: CONFIGURATION,
        operational: OPERATIONAL,
      }),
      database: Object.freeze({
        url: 'postgresql://daily_trader:daily_trader@localhost:5432/daily_trader',
        connectionTimeoutMs: 5_000,
      }),
    });

    await expect(
      runSignalsRuntime(
        {
          config,
          repository,
          clock: CLOCK,
          logger: LOGGER,
          meter: recordingMeter(observations),
        },
        controller.signal,
      ),
    ).rejects.toBe(failure);

    expect(fail).toHaveBeenCalledWith(CLOSING_CLAIM, 'journal_gap', CLOCK);
    expect(heartbeat).not.toHaveBeenCalled();
    expect(
      observations.filter(({ name }) => name === 'daily_trader.signal.worker_lifecycle'),
    ).toMatchObject([
      { attributes: { state: 'starting' } },
      { attributes: { state: 'running' } },
      { attributes: { state: 'failed' } },
    ]);
  });

  it('persists a disabled-mode drain failure before exiting', async () => {
    const observations: MetricObservation[] = [];
    const failure = new SignalsWorkerError('stored_data_invalid');
    const fail = vi.fn(() => Promise.resolve());
    const repository = {
      disable: vi.fn(() => Promise.resolve(CLOSING_CLAIM)),
      loadRunSettings: vi.fn(() => Promise.reject(failure)),
      fail,
    } as unknown as SignalsRepository;
    const config: SignalsWorkerConfig = Object.freeze({
      environment: 'test',
      runtime: Object.freeze({ logLevel: 'info', telemetryExporter: 'none' }),
      worker: Object.freeze({ heartbeatIntervalMs: 1_000 }),
      signal: Object.freeze({
        mode: 'disabled',
        configuration: CONFIGURATION,
        operational: OPERATIONAL,
      }),
      database: Object.freeze({
        url: 'postgresql://daily_trader:daily_trader@localhost:5432/daily_trader',
        connectionTimeoutMs: 5_000,
      }),
    });

    await expect(
      runDisabledSignalsRuntime(
        {
          config,
          repository,
          clock: CLOCK,
          logger: LOGGER,
          meter: recordingMeter(observations),
        },
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);

    expect(fail).toHaveBeenCalledWith(CLOSING_CLAIM, 'stored_data_invalid', CLOCK);
    expect(
      observations.filter(({ name }) => name === 'daily_trader.signal.worker_lifecycle'),
    ).toMatchObject([{ attributes: { state: 'starting' } }, { attributes: { state: 'failed' } }]);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'daily_trader.signal.failures',
          attributes: { reason: 'stored_data_invalid' },
        }),
      ]),
    );
  });
});
