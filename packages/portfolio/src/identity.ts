import { createHash } from 'node:crypto';

import { PortfolioError } from './errors.js';

declare const portfolioFingerprintBrand: unique symbol;

export type PortfolioFingerprint = string & {
  readonly [portfolioFingerprintBrand]: 'PortfolioFingerprint';
};

export type PortfolioSourceIdentifierKind =
  'account' | 'asset' | 'client_order' | 'fill' | 'order' | 'request';

const FINGERPRINT = /^[0-9a-f]{64}$/u;
const SOURCE_IDENTIFIER_KINDS: readonly PortfolioSourceIdentifierKind[] = [
  'account',
  'asset',
  'client_order',
  'fill',
  'order',
  'request',
];

export function createPortfolioFingerprint(value: unknown): PortfolioFingerprint {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) {
    throw new PortfolioError('contract_invalid');
  }
  return value as PortfolioFingerprint;
}

/**
 * Hashes a provider identifier inside a fixed application-owned namespace.
 * Kind separation prevents the same provider text from colliding across
 * account, asset, order, fill, and request identities.
 */
export function fingerprintPortfolioSourceIdentifier(
  kind: PortfolioSourceIdentifierKind,
  value: unknown,
): PortfolioFingerprint {
  if (
    !SOURCE_IDENTIFIER_KINDS.includes(kind) ||
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new PortfolioError('contract_invalid');
  }
  return hashPortfolioCanonical(
    JSON.stringify({
      provider: 'alpaca',
      brokerEnvironment: 'paper',
      kind,
      sourceIdentifier: value,
    }),
  );
}

export function hashPortfolioCanonical(value: string): PortfolioFingerprint {
  return createPortfolioFingerprint(createHash('sha256').update(value, 'utf8').digest('hex'));
}
