import { createUtcTimestamp, type UtcTimestamp } from '@daily-trader/domain';

import { PortfolioError } from './errors.js';
import { createPortfolioFingerprint, type PortfolioFingerprint } from './identity.js';

export const PORTFOLIO_REQUEST_RECEIPT_SCHEMA_VERSION =
  'daily-trader.portfolio.request-receipt.v1' as const;

export type PortfolioRequestResource = 'account' | 'fills' | 'orders' | 'positions';

export interface PortfolioRequestReceipt {
  readonly schemaVersion: typeof PORTFOLIO_REQUEST_RECEIPT_SCHEMA_VERSION;
  readonly requestFingerprint: PortfolioFingerprint;
  readonly resource: PortfolioRequestResource;
  readonly captureAttempt: number;
  readonly pageOrdinal: number;
  readonly receivedAt: UtcTimestamp;
  readonly responseStatus: number;
}

export interface CreatePortfolioRequestReceiptInput {
  readonly requestFingerprint: unknown;
  readonly resource: unknown;
  readonly captureAttempt: unknown;
  readonly pageOrdinal: unknown;
  readonly receivedAt: unknown;
  readonly responseStatus: unknown;
}

const RESOURCES: readonly PortfolioRequestResource[] = ['account', 'fills', 'orders', 'positions'];
const MAX_CAPTURE_ATTEMPT = 1_000;
const MAX_PAGE_ORDINAL = 100_000;

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new PortfolioError('contract_invalid');
  }
  return value as number;
}

/**
 * Validates safe provider-request evidence. The raw provider request identifier
 * must be fingerprinted before it reaches this application-owned contract.
 */
export function createPortfolioRequestReceipt(
  input: CreatePortfolioRequestReceiptInput,
): PortfolioRequestReceipt {
  if (!RESOURCES.includes(input.resource as PortfolioRequestResource)) {
    throw new PortfolioError('contract_invalid');
  }
  return Object.freeze({
    schemaVersion: PORTFOLIO_REQUEST_RECEIPT_SCHEMA_VERSION,
    requestFingerprint: createPortfolioFingerprint(input.requestFingerprint),
    resource: input.resource as PortfolioRequestResource,
    captureAttempt: boundedInteger(input.captureAttempt, 1, MAX_CAPTURE_ATTEMPT),
    pageOrdinal: boundedInteger(input.pageOrdinal, 0, MAX_PAGE_ORDINAL),
    receivedAt: createUtcTimestamp(input.receivedAt),
    responseStatus: boundedInteger(input.responseStatus, 100, 599),
  });
}
