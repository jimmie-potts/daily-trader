import { describe, expect, it } from 'vitest';

import { PortfolioError } from './errors.js';
import { parsePortfolioSyncSnapshot, serializePortfolioSyncSnapshot } from './serialization.js';
import { syncSnapshot } from './test-helpers.js';

type MutableRecord = Record<string, unknown>;

function canonicalPayload(): string {
  return serializePortfolioSyncSnapshot(syncSnapshot());
}

function decodedPayload(): MutableRecord {
  return JSON.parse(canonicalPayload()) as MutableRecord;
}

function record(value: unknown): MutableRecord {
  return value as MutableRecord;
}

function array(value: unknown): unknown[] {
  return value as unknown[];
}

function expectSerializationInvalid(operation: () => unknown): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PortfolioError);
  expect(thrown).toMatchObject({ code: 'serialization_invalid' });
}

describe('parsePortfolioSyncSnapshot', () => {
  it('reconstructs canonical stored bytes through immutable portfolio contracts', () => {
    const source = canonicalPayload();
    const parsed = parsePortfolioSyncSnapshot(source);

    expect(parsed).toEqual(syncSnapshot());
    expect(serializePortfolioSyncSnapshot(parsed)).toBe(source);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.account)).toBe(true);
    expect(Object.isFrozen(parsed.positions)).toBe(true);
    expect(Object.isFrozen(parsed.orders)).toBe(true);
    expect(Object.isFrozen(parsed.fills)).toBe(true);
  });

  it('accepts a canonical decoded object or an already-normalized snapshot', () => {
    const source = canonicalPayload();
    const fromObject = parsePortfolioSyncSnapshot(JSON.parse(source) as unknown);
    const normalized = syncSnapshot();
    const fromNormalized = parsePortfolioSyncSnapshot(normalized);

    expect(serializePortfolioSyncSnapshot(fromObject)).toBe(source);
    expect(serializePortfolioSyncSnapshot(fromNormalized)).toBe(
      serializePortfolioSyncSnapshot(normalized),
    );
  });

  it('round-trips subsequent fill-query coverage byte-for-byte', () => {
    const snapshot = syncSnapshot({
      activityBaselineOnly: false,
      activityWindowStartedAt: '2026-07-13T14:28:30.000Z',
    });
    const source = serializePortfolioSyncSnapshot(snapshot);
    const replayed = parsePortfolioSyncSnapshot(source);

    expect(replayed.coverage).toEqual(snapshot.coverage);
    expect(replayed.snapshotId).toBe(snapshot.snapshotId);
    expect(serializePortfolioSyncSnapshot(replayed)).toBe(source);
    expect(serializePortfolioSyncSnapshot(parsePortfolioSyncSnapshot(source))).toBe(source);
  });

  it.each(['', ' ', '{', 'null', '[]', 'true', '42', '"snapshot"'])(
    'rejects malformed or non-object stored JSON %j',
    (input) => {
      expectSerializationInvalid(() => parsePortfolioSyncSnapshot(input));
    },
  );

  it.each([null, undefined, true, 42, [], new Date('2026-07-13T14:30:00.000Z')])(
    'rejects non-record decoded input %s',
    (input) => {
      expectSerializationInvalid(() => parsePortfolioSyncSnapshot(input));
    },
  );

  it('requires exact canonical bytes without whitespace or duplicate keys', () => {
    const source = canonicalPayload();
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(` ${source}`));
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(`${source}\n`));

    const duplicateId = source.replace(
      /"snapshotId":"([0-9a-f]{64})"\}$/u,
      '"snapshotId":"$1","snapshotId":"$1"}',
    );
    expect(duplicateId).not.toBe(source);
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(duplicateId));
  });

  it('rejects reordered canonical members and resource arrays', () => {
    const payload = decodedPayload();
    const reorderedRoot = {
      provider: payload.provider,
      schemaVersion: payload.schemaVersion,
      ...Object.fromEntries(
        Object.entries(payload).filter(([key]) => key !== 'provider' && key !== 'schemaVersion'),
      ),
    };
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(reorderedRoot));

    const reorderedResources = decodedPayload();
    array(reorderedResources.positions).reverse();
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(reorderedResources));
  });

  it.each([
    ['schemaVersion', 'daily-trader.portfolio.sync-snapshot.v999'],
    ['provider', 'unknown-provider'],
    ['brokerEnvironment', 'live'],
    ['markSource', 'calculated'],
  ])('rejects unknown normalized root field %s', (field, value) => {
    const payload = decodedPayload();
    payload[field] = value;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(payload));
  });

  it('rejects extra properties at every structural layer', () => {
    const rootExtra = decodedPayload();
    rootExtra.unknown = true;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(rootExtra));

    const observationExtra = decodedPayload();
    record(array(observationExtra.positions)[0]).unknown = true;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(observationExtra));

    const timestampExtra = decodedPayload();
    record(record(timestampExtra.account).createdAt).unknown = true;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(timestampExtra));

    const instrumentExtra = decodedPayload();
    record(record(array(instrumentExtra.positions)[0]).instrument).unknown = true;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(instrumentExtra));

    const supportExtra = decodedPayload();
    record(record(array(supportExtra.positions)[0]).support).unknown = true;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(supportExtra));

    const coverageExtra = decodedPayload();
    record(coverageExtra.coverage).unknown = true;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(coverageExtra));

    const coverageMissing = decodedPayload();
    delete record(coverageMissing.coverage).activityWindowStartedAt;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(coverageMissing));
  });

  it('rejects hidden, symbol, accessor, and array properties', () => {
    const hidden = decodedPayload();
    Object.defineProperty(hidden, 'hidden', { value: true });
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(hidden));

    const symbol = decodedPayload();
    Object.defineProperty(symbol, Symbol('hidden'), { value: true });
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(symbol));

    const accessor = decodedPayload();
    let getterInvoked = false;
    Object.defineProperty(accessor, 'snapshotId', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return '0'.repeat(64);
      },
    });
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(accessor));
    expect(getterInvoked).toBe(false);

    const arrayExtra = decodedPayload();
    Object.defineProperty(array(arrayExtra.positions), 'unknown', {
      enumerable: true,
      value: true,
    });
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(arrayExtra));
  });

  it('rejects number-typed exact financial and identifier data', () => {
    const accountNumber = decodedPayload();
    record(accountNumber.account).cash = 40;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(accountNumber));

    const positionNumber = decodedPayload();
    record(array(positionNumber.positions)[0]).quantity = 2;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(positionNumber));

    const orderNumber = decodedPayload();
    record(array(orderNumber.orders)[0]).limitPrice = 40;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(orderNumber));

    const fillNumber = decodedPayload();
    record(array(fillNumber.fills)[0]).price = 39.5;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(fillNumber));

    const fingerprintNumber = decodedPayload();
    array(fingerprintNumber.sourceRequestFingerprints)[0] = 123;
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(fingerprintNumber));
  });

  it('verifies every stored observation identifier and the snapshot identifier', () => {
    const accountId = decodedPayload();
    record(accountId.account).accountObservationId = '0'.repeat(64);
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(accountId));

    const positionId = decodedPayload();
    record(array(positionId.positions)[0]).positionObservationId = '0'.repeat(64);
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(positionId));

    const orderId = decodedPayload();
    record(array(orderId.orders)[0]).orderObservationId = '0'.repeat(64);
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(orderId));

    const fillId = decodedPayload();
    record(array(fillId.fills)[0]).fillObservationId = '0'.repeat(64);
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(fillId));

    const snapshotId = decodedPayload();
    snapshotId.snapshotId = '0'.repeat(64);
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(snapshotId));
  });

  it('rejects content tampering even when observation identity excludes receipt metadata', () => {
    const businessTampering = decodedPayload();
    record(businessTampering.account).cash = '41';
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(businessTampering));

    const receiptTampering = decodedPayload();
    record(receiptTampering.account).observedAt = '2026-07-13T14:30:00.600Z';
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(receiptTampering));
  });

  it('recomputes provider UTC timestamps from their preserved original text', () => {
    const payload = decodedPayload();
    record(record(payload.account).createdAt).utc = '2024-01-02T08:04:05.124Z';

    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(payload));
  });

  it('rejects malformed nested structures and incomplete membership', () => {
    const malformedTimestamp = decodedPayload();
    record(malformedTimestamp.account).createdAt = '2024-01-02T08:04:05.123Z';
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(malformedTimestamp));

    const missingPosition = decodedPayload();
    missingPosition.positions = [];
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(missingPosition));

    const missingRequest = decodedPayload();
    array(missingRequest.sourceRequestFingerprints).pop();
    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(missingRequest));
  });
});
