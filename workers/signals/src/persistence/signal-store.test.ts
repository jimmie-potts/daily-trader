import { createUtcTimestamp } from '@daily-trader/domain';
import {
  addUtcMilliseconds,
  createOneMinuteBarEvent,
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

import { SignalsWorkerError } from '../errors.js';
import { persistSignalEvaluation } from './signal-store.js';
import type { SqlQueryable, SqlQueryResult, SqlRow } from './sql.js';

function bar(minute: number, close: string, volume: string): OneMinuteBarEvent {
  const start = createUtcTimestamp(
    new Date(Date.parse('2026-07-13T13:30:00.000Z') + minute * 60_000).toISOString(),
  );
  const receivedAt = addUtcMilliseconds(start, 70_000);
  return createOneMinuteBarEvent({
    symbol: 'AAPL',
    venue: 'XNAS',
    providerTimestamp: start,
    receivedAt,
    processedAt: addUtcMilliseconds(receivedAt, 1_000),
    open: '100',
    high: minute === 3 ? '110' : String(101 + minute),
    low: minute === 3 ? '95' : String(98 - minute),
    close,
    volume,
  });
}

function evaluation(outcome: 'fired' | 'not_fired'): SignalEvaluation {
  const configuration = createSignalConfiguration({
    configurationVersion: `phase3-store-${outcome}-v1`,
    lookbackBars: 3,
    volumeMultiplier: '1.5',
    freshnessThresholdMs: 120_000,
  });
  const bars = Object.freeze([
    bar(0, '100', '100'),
    bar(1, '100', '200'),
    bar(2, '100', '300'),
    bar(3, outcome === 'fired' ? '106' : '100', '400'),
  ]);
  const evaluationBar = bars[3];
  if (evaluationBar === undefined) throw new TypeError('missing evaluation bar');
  const result = evaluateBreakoutPlusVolume(
    computeFeatureResult({
      canonicalBars: bars,
      evaluationEventId: evaluationBar.eventId,
      configuration,
    }),
    configuration,
  );
  if (result.outcome !== outcome) throw new TypeError(`expected ${outcome} fixture`);
  return result;
}

interface StoredOccurrence {
  readonly occurrence_id: string;
  readonly direction: string;
  readonly canonical_payload: string;
}

class ExistingEvaluationStore implements SqlQueryable {
  public evidenceInsertCount = 0;
  public occurrenceInsertCount = 0;

  public constructor(
    private readonly storedEvaluation: SignalEvaluation,
    private readonly evidence: readonly Readonly<{
      role: string;
      ordinal: number;
      event_id: string;
    }>[],
    private readonly occurrence: StoredOccurrence | undefined,
  ) {}

  public query<Row extends SqlRow = SqlRow>(text: string): Promise<SqlQueryResult<Row>> {
    if (text.includes('signal-store:insert-evaluation')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('signal-store:select-evaluation')) {
      return Promise.resolve({
        rows: [
          { canonical_payload: serializeSignalEvaluation(this.storedEvaluation) },
        ] as unknown as readonly Row[],
        rowCount: 1,
      });
    }
    if (text.includes('signal-store:insert-evidence')) {
      this.evidenceInsertCount += 1;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('signal-store:select-evidence')) {
      return Promise.resolve({
        rows: this.evidence as unknown as readonly Row[],
        rowCount: this.evidence.length,
      });
    }
    if (text.includes('signal-store:insert-occurrence')) {
      this.occurrenceInsertCount += 1;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('signal-store:select-occurrence')) {
      const rows = this.occurrence === undefined ? [] : [this.occurrence];
      return Promise.resolve({ rows: rows as unknown as readonly Row[], rowCount: rows.length });
    }
    throw new TypeError(`unexpected signal-store query: ${text}`);
  }
}

function evidenceRows(value: SignalEvaluation): readonly Readonly<{
  role: string;
  ordinal: number;
  event_id: string;
}>[] {
  return value.featureResult.evidence
    .map(({ role, ordinal, eventId }) => ({ role, ordinal, event_id: eventId }))
    .sort((left, right) => left.role.localeCompare(right.role) || left.ordinal - right.ordinal);
}

function invariantError(cause?: unknown): SignalsWorkerError {
  return new SignalsWorkerError('stored_data_invalid', { cause });
}

describe('shared signal evaluation persistence', () => {
  it('rejects an existing partial evidence set without repairing it', async () => {
    const fired = evaluation('fired');
    if (fired.outcome !== 'fired') throw new TypeError('expected fired evaluation');
    const store = new ExistingEvaluationStore(fired, evidenceRows(fired).slice(0, -1), {
      occurrence_id: fired.occurrence.occurrenceId,
      direction: fired.direction,
      canonical_payload: JSON.stringify(fired.occurrence),
    });

    await expect(persistSignalEvaluation(store, fired, invariantError)).rejects.toMatchObject({
      code: 'stored_data_invalid',
    });
    expect(store.evidenceInsertCount).toBe(0);
    expect(store.occurrenceInsertCount).toBe(0);
  });

  it('rejects a missing fired occurrence without repairing it', async () => {
    const fired = evaluation('fired');
    const store = new ExistingEvaluationStore(fired, evidenceRows(fired), undefined);

    await expect(persistSignalEvaluation(store, fired, invariantError)).rejects.toMatchObject({
      code: 'stored_data_invalid',
    });
    expect(store.occurrenceInsertCount).toBe(0);
  });

  it('rejects a contradictory occurrence for an existing non-fired evaluation', async () => {
    const notFired = evaluation('not_fired');
    const store = new ExistingEvaluationStore(notFired, evidenceRows(notFired), {
      occurrence_id: 'f'.repeat(64),
      direction: 'upward',
      canonical_payload: '{}',
    });

    await expect(persistSignalEvaluation(store, notFired, invariantError)).rejects.toMatchObject({
      code: 'stored_data_invalid',
    });
    expect(store.occurrenceInsertCount).toBe(0);
  });
});
