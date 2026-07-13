import { createUtcTimestamp, type UtcTimestamp } from '@daily-trader/domain';

import { PortfolioError } from './errors.js';

declare const portfolioProviderTimestampBrand: unique symbol;

export type PortfolioProviderTimestampText = string & {
  readonly [portfolioProviderTimestampBrand]: 'PortfolioProviderTimestampText';
};

export interface PortfolioProviderTimestamp {
  readonly original: PortfolioProviderTimestampText;
  readonly utc: UtcTimestamp;
}

const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u;

function integer(text: string): number {
  const parsed = Number(text);
  if (!Number.isInteger(parsed)) throw new PortfolioError('contract_invalid');
  return parsed;
}

function offsetMinutes(offset: string): number {
  if (offset === 'Z') return 0;
  const hours = integer(offset.slice(1, 3));
  const minutes = integer(offset.slice(4, 6));
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    throw new PortfolioError('contract_invalid');
  }
  const magnitude = hours * 60 + minutes;
  return offset.startsWith('-') ? -magnitude : magnitude;
}

/** Preserves the provider text and derives its millisecond UTC representation. */
export function normalizePortfolioProviderTimestamp(value: unknown): PortfolioProviderTimestamp {
  if (typeof value !== 'string') throw new PortfolioError('contract_invalid');
  const match = RFC3339_TIMESTAMP.exec(value);
  if (match === null) throw new PortfolioError('contract_invalid');
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
    throw new PortfolioError('contract_invalid');
  }
  const year = integer(yearText);
  const month = integer(monthText);
  const day = integer(dayText);
  const hour = integer(hourText);
  const minute = integer(minuteText);
  const second = integer(secondText);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new PortfolioError('contract_invalid');
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
    throw new PortfolioError('contract_invalid');
  }
  const millisecond = integer((fraction ?? '').slice(0, 3).padEnd(3, '0') || '0');
  const epochMilliseconds =
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
    offsetMinutes(offset) * 60_000;
  return Object.freeze({
    original: value as PortfolioProviderTimestampText,
    utc: createUtcTimestamp(new Date(epochMilliseconds).toISOString()),
  });
}
