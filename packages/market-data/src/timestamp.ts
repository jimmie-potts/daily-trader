import { createUtcTimestamp, type UtcTimestamp } from '@daily-trader/domain';

import { MarketDataValidationError, requireString } from './validation.js';

declare const providerTimestampBrand: unique symbol;

export type ProviderTimestamp = string & {
  readonly [providerTimestampBrand]: 'ProviderTimestamp';
};

export interface NormalizedProviderTimestamp {
  readonly original: ProviderTimestamp;
  readonly utc: UtcTimestamp;
}

const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u;

function integer(text: string, field: string): number {
  const parsed = Number(text);
  if (!Number.isInteger(parsed)) {
    throw new MarketDataValidationError(field, 'must be an integer');
  }
  return parsed;
}

function validateCalendarParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): void {
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new MarketDataValidationError('providerTimestamp', 'must identify a valid RFC 3339 time');
  }
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day ||
    candidate.getUTCHours() !== hour ||
    candidate.getUTCMinutes() !== minute ||
    candidate.getUTCSeconds() !== second
  ) {
    throw new MarketDataValidationError('providerTimestamp', 'must identify a real calendar time');
  }
}

function offsetMinutes(offset: string): number {
  if (offset === 'Z') {
    return 0;
  }
  const hours = integer(offset.slice(1, 3), 'providerTimestamp.offset');
  const minutes = integer(offset.slice(4, 6), 'providerTimestamp.offset');
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    throw new MarketDataValidationError(
      'providerTimestamp.offset',
      'must be within 14 hours of UTC',
    );
  }
  const magnitude = hours * 60 + minutes;
  return offset.startsWith('-') ? -magnitude : magnitude;
}

export function normalizeProviderTimestamp(value: unknown): NormalizedProviderTimestamp {
  const originalText = requireString(value, 'providerTimestamp');
  const match = RFC3339_TIMESTAMP.exec(originalText);
  if (match === null) {
    throw new MarketDataValidationError(
      'providerTimestamp',
      'must be an RFC 3339 timestamp with an explicit UTC offset and at most nanosecond precision',
    );
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, offset] =
    match;
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    hourText === undefined ||
    minuteText === undefined ||
    secondText === undefined ||
    offset === undefined
  ) {
    throw new MarketDataValidationError('providerTimestamp', 'must contain complete date and time');
  }

  const year = integer(yearText, 'providerTimestamp.year');
  const month = integer(monthText, 'providerTimestamp.month');
  const day = integer(dayText, 'providerTimestamp.day');
  const hour = integer(hourText, 'providerTimestamp.hour');
  const minute = integer(minuteText, 'providerTimestamp.minute');
  const second = integer(secondText, 'providerTimestamp.second');
  validateCalendarParts(year, month, day, hour, minute, second);

  const millisecond = integer(
    (fraction ?? '').slice(0, 3).padEnd(3, '0') || '0',
    'providerTimestamp',
  );
  const epochMilliseconds =
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
    offsetMinutes(offset) * 60_000;
  const normalized = new Date(epochMilliseconds).toISOString();

  return Object.freeze({
    original: originalText as ProviderTimestamp,
    utc: createUtcTimestamp(normalized),
  });
}

export function addUtcMilliseconds(timestamp: UtcTimestamp, milliseconds: number): UtcTimestamp {
  if (!Number.isInteger(milliseconds)) {
    throw new MarketDataValidationError('milliseconds', 'must be an integer');
  }
  return createUtcTimestamp(new Date(Date.parse(timestamp) + milliseconds).toISOString());
}

export function utcEpochMilliseconds(timestamp: UtcTimestamp): number {
  return Date.parse(timestamp);
}
