import { readFileSync } from 'node:fs';

import { createUtcTimestamp } from '@daily-trader/domain';
import { describe, expect, it } from 'vitest';

import type { AlpacaPaperApiError } from '../providers/alpaca/errors.js';
import type { AlpacaRawCapture, AlpacaRawResponse } from '../providers/alpaca/types.js';
import { normalizeAlpacaCapture } from './alpaca.js';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/alpaca/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
}

function response<T>(payload: T, requestId: string, receivedAt: string): AlpacaRawResponse<T> {
  return Object.freeze({
    metadata: Object.freeze({ requestId, receivedAt: createUtcTimestamp(receivedAt) }),
    payload,
  });
}

interface CaptureFixtures {
  readonly account?: unknown;
  readonly activityBaselineOnly?: boolean;
  readonly activityCutoverAt?: string;
  readonly activityWindowStartedAt?: string;
  readonly fills?: readonly unknown[];
  readonly orders?: readonly unknown[];
  readonly positions?: readonly unknown[];
  readonly requestSuffix?: string;
  readonly timeOffsetSeconds?: number;
}

function capture(fixtures: CaptureFixtures = {}): AlpacaRawCapture {
  const offset = fixtures.timeOffsetSeconds ?? 0;
  const captureStart = Date.parse('2026-07-13T13:31:02.500Z');
  const instant = (seconds: number): string =>
    new Date(captureStart + (offset + seconds) * 1_000).toISOString();
  const captureInstant = (seconds: number): string =>
    new Date(captureStart + seconds * 1_000).toISOString();
  const suffix = fixtures.requestSuffix ?? '';
  return Object.freeze({
    account: response(
      fixtures.account ?? fixture('account'),
      `request-account${suffix}`,
      instant(1),
    ),
    activityBaselineOnly: fixtures.activityBaselineOnly ?? true,
    activityCutoverAt: createUtcTimestamp(fixtures.activityCutoverAt ?? captureInstant(0)),
    activityWindowStartedAt: createUtcTimestamp(
      fixtures.activityWindowStartedAt ??
        new Date(Date.parse(captureInstant(0)) - 1_000).toISOString(),
    ),
    captureStartedAt: createUtcTimestamp(captureInstant(0)),
    captureCompletedAt: createUtcTimestamp(instant(4)),
    fills: Object.freeze([
      response(
        fixtures.fills ?? (fixture('fills') as readonly unknown[]),
        `request-fills${suffix}`,
        instant(4),
      ),
    ]),
    orders: Object.freeze([
      response(
        fixtures.orders ?? (fixture('orders') as readonly unknown[]),
        `request-orders${suffix}`,
        instant(3),
      ),
    ]),
    positions: response(
      fixtures.positions ?? (fixture('positions') as readonly unknown[]),
      `request-positions${suffix}`,
      instant(2),
    ),
  });
}

function clonedRecord(name: string): Record<string, unknown> {
  return structuredClone(fixture(name)) as Record<string, unknown>;
}

function clonedArray(name: string): Record<string, unknown>[] {
  return structuredClone(fixture(name)) as Record<string, unknown>[];
}

describe('normalizeAlpacaCapture', () => {
  it('preserves exact facts, fingerprints source IDs, and retains unsupported holdings', () => {
    const snapshot = normalizeAlpacaCapture(capture());

    expect(snapshot.account).toMatchObject({
      cash: '100000',
      currency: 'USD',
      equity: '102500.5',
      portfolioValue: '102500.5',
    });
    expect(snapshot.account.createdAt).toEqual({
      original: '2026-07-01T09:30:00.123456-04:00',
      utc: '2026-07-01T13:30:00.123Z',
    });
    expect(snapshot.accountFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshot.sourceRequestFingerprints).toHaveLength(4);
    expect(snapshot.coverage).toEqual({
      positionsComplete: true,
      ordersComplete: true,
      fillsComplete: true,
      activityBaselineOnly: true,
      activityWindowStartedAt: '2026-07-13T13:31:01.500Z',
      activityCutoverAt: '2026-07-13T13:31:02.500Z',
    });
    expect(JSON.stringify(snapshot)).not.toContain('fixture-paper-account-id');
    expect(JSON.stringify(snapshot)).not.toContain('SANITIZED-PAPER-ACCOUNT');
    expect(JSON.stringify(snapshot)).not.toContain('request-account');

    const aapl = snapshot.positions.find(({ symbol }) => symbol === 'AAPL');
    expect(aapl).toMatchObject({
      averageEntryPrice: '200.1',
      currency: 'USD',
      currencySource: 'account',
      instrument: { symbol: 'AAPL', venue: 'XNAS' },
      quantity: '10.5',
      support: { state: 'supported', reason: null },
    });
    const crypto = snapshot.positions.find(({ symbol }) => symbol === 'BTCUSD');
    expect(crypto).toMatchObject({
      instrument: null,
      quantity: '0.005',
      support: { state: 'unsupported', reason: 'unsupported_asset_class' },
    });
    const short = snapshot.positions.find(({ symbol }) => symbol === 'TSLA');
    expect(short).toMatchObject({
      instrument: { symbol: 'TSLA', venue: 'XNAS' },
      quantity: '-2.5',
      quantityAvailable: '-2',
      side: 'short',
      support: { state: 'supported', reason: null },
    });

    const aaplOrder = snapshot.orders.find(({ symbol }) => symbol === 'AAPL');
    expect(aaplOrder).toMatchObject({
      filledAveragePrice: '204.25',
      filledQuantity: '2',
      instrument: { symbol: 'AAPL', venue: 'XNAS' },
      quantity: '10',
      support: { state: 'supported', reason: null },
    });
    expect(snapshot.orders.find(({ symbol }) => symbol === 'BTCUSD')).toMatchObject({
      instrument: null,
      support: { state: 'unsupported', reason: 'unsupported_asset_class' },
    });
    expect(snapshot.fills[0]).toMatchObject({
      cumulativeQuantity: '2',
      leavesQuantity: '8',
      price: '204.25',
      quantity: '2',
      transactionAt: {
        original: '2026-07-13T09:31:01.987654321-04:00',
        utc: '2026-07-13T13:31:01.987Z',
      },
    });
  });

  it('retains a subsequent overlapping activity query as non-baseline evidence', () => {
    const snapshot = normalizeAlpacaCapture(
      capture({
        activityBaselineOnly: false,
        activityWindowStartedAt: '2026-07-13T13:30:02.500Z',
      }),
    );

    expect(snapshot.coverage).toMatchObject({
      activityBaselineOnly: false,
      activityWindowStartedAt: '2026-07-13T13:30:02.500Z',
      activityCutoverAt: '2026-07-13T13:31:02.500Z',
    });
    expect(snapshot.snapshotId).not.toBe(normalizeAlpacaCapture(capture()).snapshotId);
  });

  it('keeps observation identities stable across receipt times and provider request IDs', () => {
    const first = normalizeAlpacaCapture(capture());
    const retried = normalizeAlpacaCapture(
      capture({ requestSuffix: '-retry', timeOffsetSeconds: 10 }),
    );

    expect(retried.account.accountObservationId).toBe(first.account.accountObservationId);
    expect(retried.positions.map(({ positionObservationId }) => positionObservationId)).toEqual(
      first.positions.map(({ positionObservationId }) => positionObservationId),
    );
    expect(retried.orders.map(({ orderObservationId }) => orderObservationId)).toEqual(
      first.orders.map(({ orderObservationId }) => orderObservationId),
    );
    expect(retried.fills.map(({ fillObservationId }) => fillObservationId)).toEqual(
      first.fills.map(({ fillObservationId }) => fillObservationId),
    );
    expect(retried.snapshotId).not.toBe(first.snapshotId);
  });

  it('accepts empty complete collections while retaining every request fingerprint', () => {
    const snapshot = normalizeAlpacaCapture(capture({ fills: [], orders: [], positions: [] }));

    expect(snapshot.positions).toEqual([]);
    expect(snapshot.orders).toEqual([]);
    expect(snapshot.fills).toEqual([]);
    expect(snapshot.coverage).toMatchObject({
      positionsComplete: true,
      ordersComplete: true,
      fillsComplete: true,
    });
    expect(snapshot.sourceRequestFingerprints).toHaveLength(4);
  });

  it('preserves a null broker mark and flags unsupported account currency and venue', () => {
    const positionsWithNullMark = clonedArray('positions');
    positionsWithNullMark[0]!.current_price = null;
    expect(
      normalizeAlpacaCapture(capture({ positions: positionsWithNullMark })).positions.find(
        ({ symbol }) => symbol === 'AAPL',
      )?.currentPrice,
    ).toBeNull();

    const nonUsdAccount = clonedRecord('account');
    nonUsdAccount.currency = 'EUR';
    expect(
      normalizeAlpacaCapture(capture({ account: nonUsdAccount })).positions.find(
        ({ symbol }) => symbol === 'AAPL',
      )?.support,
    ).toEqual({ state: 'unsupported', reason: 'unsupported_currency' });

    const unknownVenue = clonedArray('positions');
    unknownVenue[0]!.exchange = 'OTC';
    expect(
      normalizeAlpacaCapture(capture({ positions: unknownVenue })).positions.find(
        ({ symbol }) => symbol === 'AAPL',
      )?.support,
    ).toEqual({ state: 'unsupported', reason: 'unsupported_venue' });
  });

  it('rejects number-typed financial fields, malformed timestamps, and unsupported enums', () => {
    const numberedAccount = clonedRecord('account');
    numberedAccount.cash = 100_000;
    expect(() => normalizeAlpacaCapture(capture({ account: numberedAccount }))).toThrowError(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({ code: 'ALPACA_DECIMAL_INVALID' }),
    );

    const malformedOrders = clonedArray('orders');
    malformedOrders[0]!.created_at = '2026-07-13 09:30:00';
    expect(() => normalizeAlpacaCapture(capture({ orders: malformedOrders }))).toThrowError(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({ code: 'ALPACA_PAYLOAD_INVALID' }),
    );

    const unknownStatusOrders = clonedArray('orders');
    unknownStatusOrders[0]!.status = 'future_status';
    expect(() => normalizeAlpacaCapture(capture({ orders: unknownStatusOrders }))).toThrowError(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({
        code: 'ALPACA_ORDER_STATUS_UNSUPPORTED',
      }),
    );
  });

  it('retains the documented held status as an open observed order', () => {
    const heldOrders = clonedArray('orders');
    heldOrders[0]!.status = 'held';

    expect(
      normalizeAlpacaCapture(capture({ orders: heldOrders })).orders.find(
        ({ symbol }) => symbol === 'AAPL',
      ),
    ).toMatchObject({ providerStatus: 'held', state: 'open' });
  });

  it('preserves a provider zero filled-average price on an unprocessed open order', () => {
    const unprocessedOrders = clonedArray('orders');
    unprocessedOrders[0]!.status = 'new';
    unprocessedOrders[0]!.filled_qty = '0';
    unprocessedOrders[0]!.filled_avg_price = '0.0000';

    expect(
      normalizeAlpacaCapture(capture({ fills: [], orders: unprocessedOrders })).orders.find(
        ({ symbol }) => symbol === 'AAPL',
      ),
    ).toMatchObject({ filledAveragePrice: '0', filledQuantity: '0', state: 'open' });
  });

  it('rejects duplicate sources and inconsistent order or fill quantities', () => {
    const duplicatePositions = clonedArray('positions');
    duplicatePositions.push(structuredClone(duplicatePositions[0]!));
    expect(() => normalizeAlpacaCapture(capture({ positions: duplicatePositions }))).toThrowError(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({
        code: 'ALPACA_POSITION_DUPLICATED',
      }),
    );

    const inconsistentOrders = clonedArray('orders');
    inconsistentOrders[0]!.filled_qty = '11.0';
    expect(() => normalizeAlpacaCapture(capture({ orders: inconsistentOrders }))).toThrowError(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({
        code: 'ALPACA_ORDER_QUANTITY_INCONSISTENT',
      }),
    );

    const inconsistentFills = clonedArray('fills');
    inconsistentFills[0]!.leaves_qty = '7.0';
    expect(() => normalizeAlpacaCapture(capture({ fills: inconsistentFills }))).toThrowError(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({
        code: 'ALPACA_FILL_ORDER_QUANTITY_INCONSISTENT',
      }),
    );
  });

  it('preserves transaction time separately from provider created-at selection coverage', () => {
    const fills = clonedArray('fills');
    // The legacy response omits `created_at`; these items represent fills that
    // the provider selected by creation time while execution time diverges.
    const boundaryAndDivergentTimes = [
      '2026-07-13T13:31:01.499Z',
      '2026-07-13T13:31:01.500Z',
      '2026-07-13T13:31:02.500Z',
      '2026-07-13T13:31:02.501Z',
    ] as const;
    const selectedByCreatedAt = boundaryAndDivergentTimes.map((transactionTime, index) => ({
      ...structuredClone(fills[0]!),
      id: `SANITIZED-FILL-CREATED-AT-SELECTION-${String(index)}`,
      transaction_time: transactionTime,
    }));

    const snapshot = normalizeAlpacaCapture(capture({ fills: selectedByCreatedAt }));

    expect(snapshot.fills.map(({ transactionAt }) => transactionAt.utc)).toEqual(
      boundaryAndDivergentTimes,
    );
    expect(snapshot.coverage).toMatchObject({
      activityWindowStartedAt: '2026-07-13T13:31:01.500Z',
      activityCutoverAt: '2026-07-13T13:31:02.500Z',
      fillsComplete: true,
    });
  });

  it('rejects malformed raw activity-query ranges', () => {
    expect(() =>
      normalizeAlpacaCapture(
        capture({
          activityWindowStartedAt: '2026-07-13T13:31:02.501Z',
          fills: [],
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({
        code: 'ALPACA_PAYLOAD_INVALID',
      }),
    );

    expect(() =>
      normalizeAlpacaCapture(
        capture({
          activityCutoverAt: '2026-07-13T13:31:02.499Z',
          activityWindowStartedAt: '2026-07-13T13:30:02.499Z',
          fills: [],
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AlpacaPaperApiError>>({
        code: 'ALPACA_PAYLOAD_INVALID',
      }),
    );
  });
});
