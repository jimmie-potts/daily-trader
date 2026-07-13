import { createUtcTimestamp } from '@daily-trader/domain';
import { describe, expect, it } from 'vitest';

import { PortfolioError } from './errors.js';
import { fingerprintPortfolioSourceIdentifier } from './identity.js';
import {
  PORTFOLIO_REQUEST_RECEIPT_SCHEMA_VERSION,
  createPortfolioRequestReceipt,
} from './request-receipt.js';

describe('portfolio request receipt', () => {
  it('retains only bounded application-owned request evidence', () => {
    const requestFingerprint = fingerprintPortfolioSourceIdentifier(
      'request',
      'provider-request-must-not-escape',
    );

    const receipt = createPortfolioRequestReceipt({
      requestFingerprint,
      resource: 'orders',
      captureAttempt: 2,
      pageOrdinal: 3,
      receivedAt: '2026-07-13T14:00:00.000Z',
      responseStatus: 200,
    });

    expect(receipt).toEqual({
      schemaVersion: PORTFOLIO_REQUEST_RECEIPT_SCHEMA_VERSION,
      requestFingerprint,
      resource: 'orders',
      captureAttempt: 2,
      pageOrdinal: 3,
      receivedAt: createUtcTimestamp('2026-07-13T14:00:00.000Z'),
      responseStatus: 200,
    });
    expect(JSON.stringify(receipt)).not.toContain('provider-request-must-not-escape');
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it.each([
    { resource: 'balances', captureAttempt: 1, pageOrdinal: 0, responseStatus: 200 },
    { resource: 'account', captureAttempt: 0, pageOrdinal: 0, responseStatus: 200 },
    { resource: 'account', captureAttempt: 1, pageOrdinal: -1, responseStatus: 200 },
    { resource: 'account', captureAttempt: 1, pageOrdinal: 0, responseStatus: 99 },
  ])('rejects invalid receipt coordinates %#', (candidate) => {
    expect(() =>
      createPortfolioRequestReceipt({
        ...candidate,
        requestFingerprint: fingerprintPortfolioSourceIdentifier('request', 'request-id'),
        receivedAt: '2026-07-13T14:00:00.000Z',
      }),
    ).toThrowError(PortfolioError);
  });
});
