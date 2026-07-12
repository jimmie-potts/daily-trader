import { DomainValidationError, requireString } from './validation-error.js';

declare const utcTimestampBrand: unique symbol;

/** Canonical ISO 8601 UTC text at millisecond precision. */
export type UtcTimestamp = string & {
  readonly [utcTimestampBrand]: 'UtcTimestamp';
};

const UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function createUtcTimestamp(value: unknown): UtcTimestamp {
  const candidate = requireString(value, 'utcTimestamp');

  if (!UTC_MILLISECONDS.test(candidate)) {
    throw new DomainValidationError(
      'utcTimestamp',
      'must be canonical ISO 8601 UTC text with exactly millisecond precision',
    );
  }

  const epochMilliseconds = Date.parse(candidate);
  if (
    !Number.isFinite(epochMilliseconds) ||
    new Date(epochMilliseconds).toISOString() !== candidate
  ) {
    throw new DomainValidationError('utcTimestamp', 'must identify a real UTC calendar instant');
  }

  return candidate as UtcTimestamp;
}

/** Inject this boundary into any domain behavior that needs the current time. */
export interface Clock {
  now(): UtcTimestamp;
}

/** An immutable clock for deterministic tests and replay inputs. */
export class FixedClock implements Clock {
  readonly #instant: UtcTimestamp;

  public constructor(instant: UtcTimestamp) {
    this.#instant = createUtcTimestamp(instant);
  }

  public now(): UtcTimestamp {
    return this.#instant;
  }
}
