import { describe, expect, it } from 'vitest';

import { PortfolioError } from './errors.js';
import { hashPortfolioCanonical } from './identity.js';
import {
  parsePortfolioSyncSnapshot,
  serializePortfolioOrderObservation,
  serializePortfolioSyncSnapshot,
} from './serialization.js';
import { mlegParentOrderObservation, orderObservation, syncSnapshot } from './test-helpers.js';

type MutableRecord = Record<string, unknown>;

const LEGACY_ORDER_ID = '010e68b98b3dc92eec77a882f0d2cba26f23bd963c1a925716ef8073a641ea17';
const LEGACY_SNAPSHOT_ID = '9e9301c6e2d9861de98bdf3e9c51ebf9d556e2a24325c0806bb7c22614d308e8';
const LEGACY_PAYLOAD_SHA256 = '593e61f2824263b8d721ef1ba8c8a738031beca07415a5a24a4195f802d58434';

function canonicalPayload(): string {
  return serializePortfolioSyncSnapshot(syncSnapshot());
}

function decodedPayload(): MutableRecord {
  return JSON.parse(canonicalPayload()) as MutableRecord;
}

function legacyV1Payload(): string {
  const current = syncSnapshot({ positions: [], fills: [] });
  const legacyOrder = {
    ...current.orders[0]!,
    schemaVersion: 'daily-trader.portfolio.order-observation.v1',
    orderObservationId: LEGACY_ORDER_ID,
  };
  return JSON.stringify({
    ...current,
    schemaVersion: 'daily-trader.portfolio.sync-snapshot.v1',
    orders: [legacyOrder],
    snapshotId: LEGACY_SNAPSHOT_ID,
  });
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

  it('restores a known legacy v1 snapshot without changing its IDs or canonical bytes', () => {
    const source = legacyV1Payload();
    const parsed = parsePortfolioSyncSnapshot(source);

    expect(hashPortfolioCanonical(source)).toBe(LEGACY_PAYLOAD_SHA256);
    expect(parsed.schemaVersion).toBe('daily-trader.portfolio.sync-snapshot.v1');
    expect(parsed.snapshotId).toBe(LEGACY_SNAPSHOT_ID);
    expect(parsed.orders[0]).toMatchObject({
      schemaVersion: 'daily-trader.portfolio.order-observation.v1',
      orderObservationId: LEGACY_ORDER_ID,
    });
    expect(serializePortfolioSyncSnapshot(parsed)).toBe(source);
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

  it('round-trips nullable mleg parent facts in the current v2 schemas', () => {
    const snapshot = syncSnapshot({ orders: [mlegParentOrderObservation()], fills: [] });
    const source = serializePortfolioSyncSnapshot(snapshot);
    const replayed = parsePortfolioSyncSnapshot(source);

    expect(replayed.orders).toHaveLength(1);
    expect(replayed.orders[0]).toMatchObject({
      schemaVersion: 'daily-trader.portfolio.order-observation.v2',
      assetFingerprint: null,
      symbol: null,
      instrument: null,
      providerAssetClass: null,
      side: null,
      orderClass: 'mleg',
      support: { state: 'unsupported', reason: 'unsupported_order_structure' },
    });
    expect(replayed.schemaVersion).toBe('daily-trader.portfolio.sync-snapshot.v2');
    expect(serializePortfolioSyncSnapshot(replayed)).toBe(source);
  });

  it('rejects mixed root and nested order versions even with a recomputed root hash', () => {
    const payload = JSON.parse(legacyV1Payload()) as MutableRecord;
    payload.schemaVersion = 'daily-trader.portfolio.sync-snapshot.v2';
    const content = { ...payload };
    delete content.snapshotId;
    payload.snapshotId = hashPortfolioCanonical(JSON.stringify(content));

    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(payload));
  });

  it('rejects the inverse v1-root and v2-order mix with a recomputed root hash', () => {
    const payload = decodedPayload();
    payload.schemaVersion = 'daily-trader.portfolio.sync-snapshot.v1';
    const content = { ...payload };
    delete content.snapshotId;
    payload.snapshotId = hashPortfolioCanonical(JSON.stringify(content));

    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(payload));
  });

  it('translates a forged unknown order version into the serializer error contract', () => {
    const forged = {
      ...orderObservation(),
      schemaVersion: 'daily-trader.portfolio.order-observation.v999',
    };

    expectSerializationInvalid(() =>
      serializePortfolioOrderObservation(
        forged as unknown as Parameters<typeof serializePortfolioOrderObservation>[0],
      ),
    );
  });

  it('rejects the v2-only structure reason from a legacy order with recomputed hashes', () => {
    const payload = JSON.parse(legacyV1Payload()) as MutableRecord;
    const order = record(array(payload.orders)[0]);
    order.orderClass = 'mleg';
    order.support = { state: 'unsupported', reason: 'unsupported_order_structure' };
    const orderContent = { ...order };
    delete orderContent.orderObservationId;
    const orderIdentity = Object.fromEntries(
      Object.entries(orderContent).filter(
        ([name]) => name !== 'observedAt' && name !== 'sourceRequestFingerprint',
      ),
    );
    order.orderObservationId = hashPortfolioCanonical(JSON.stringify(orderIdentity));
    const snapshotContent = { ...payload };
    delete snapshotContent.snapshotId;
    payload.snapshotId = hashPortfolioCanonical(JSON.stringify(snapshotContent));

    expectSerializationInvalid(() => parsePortfolioSyncSnapshot(payload));
  });

  it.each(['symbol', 'providerAssetClass', 'side', 'orderType'])(
    'retains the legacy v1 non-null requirement for %s',
    (field) => {
      const payload = JSON.parse(legacyV1Payload()) as MutableRecord;
      const order = record(array(payload.orders)[0]);
      order[field] = null;
      const orderContent = { ...order };
      delete orderContent.orderObservationId;
      const orderIdentity = Object.fromEntries(
        Object.entries(orderContent).filter(
          ([name]) => name !== 'observedAt' && name !== 'sourceRequestFingerprint',
        ),
      );
      order.orderObservationId = hashPortfolioCanonical(JSON.stringify(orderIdentity));
      const snapshotContent = { ...payload };
      delete snapshotContent.snapshotId;
      payload.snapshotId = hashPortfolioCanonical(JSON.stringify(snapshotContent));

      expectSerializationInvalid(() => parsePortfolioSyncSnapshot(payload));
    },
  );

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
