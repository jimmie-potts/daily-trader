import { createHash } from 'node:crypto';

import { SignalError } from './errors.js';

const SHA256 = /^[0-9a-f]{64}$/u;

export function sha256Canonical(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function requireSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new SignalError('serialization_invalid');
  }
  return value;
}

export function requireIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)) {
    throw new SignalError('configuration_invalid');
  }
  return value;
}
