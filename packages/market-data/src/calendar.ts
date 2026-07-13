import { createUtcTimestamp, type UtcTimestamp } from '@daily-trader/domain';

import { MarketDataValidationError } from './validation.js';

export const NYSE_CALENDAR_TIME_ZONE = 'America/New_York' as const;
export const NYSE_CORE_SESSION_CALENDAR_VERSION = 'nyse-core-2026-2028.v1' as const;
export const NYSE_CALENDAR_FIRST_DATE = '2026-01-01' as const;
export const NYSE_CALENDAR_LAST_DATE = '2028-12-31' as const;

const HOLIDAYS = Object.freeze([
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
  '2028-01-17',
  '2028-02-21',
  '2028-04-14',
  '2028-05-29',
  '2028-06-19',
  '2028-07-04',
  '2028-09-04',
  '2028-11-23',
  '2028-12-25',
] as const);

const EARLY_CLOSES: Readonly<Record<string, number>> = Object.freeze({
  '2026-11-27': 13 * 60,
  '2026-12-24': 13 * 60,
  '2027-11-26': 13 * 60,
  '2028-07-03': 13 * 60,
  '2028-11-24': 13 * 60,
} as const);

const HOLIDAY_SET: ReadonlySet<string> = new Set(HOLIDAYS);
const CORE_OPEN_MINUTE = 9 * 60 + 30;
const NORMAL_CLOSE_MINUTE = 16 * 60;

export const NYSE_CALENDAR_SNAPSHOT = Object.freeze({
  source: 'NYSE hours and holidays calendar' as const,
  sourceAsOf: '2026-07-12' as const,
  firstDate: NYSE_CALENDAR_FIRST_DATE,
  lastDate: NYSE_CALENDAR_LAST_DATE,
  timeZone: NYSE_CALENDAR_TIME_ZONE,
  holidays: HOLIDAYS,
  earlyCloses: EARLY_CLOSES,
});

export interface CoreSessionWindow {
  readonly calendarDate: string;
  readonly openMinute: number;
  readonly closeMinute: number;
  readonly earlyClose: boolean;
}

export type MarketSessionClassification =
  | Readonly<{
      state: 'open';
      reason: 'core_session';
      calendarDate: string;
      session: CoreSessionWindow;
    }>
  | Readonly<{
      state: 'outside_session';
      reason: 'before_open' | 'after_close' | 'holiday' | 'weekend';
      calendarDate: string;
      session?: CoreSessionWindow;
    }>
  | Readonly<{
      state: 'unknown';
      reason: 'outside_calendar_coverage';
      calendarDate: string;
    }>;

export interface MarketSessionCalendar {
  classify(timestamp: UtcTimestamp): MarketSessionClassification;
}

const easternFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: NYSE_CALENDAR_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function easternParts(timestamp: UtcTimestamp): {
  readonly calendarDate: string;
  readonly minuteOfDay: number;
} {
  const parts = Object.fromEntries(
    easternFormatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parts.hour;
  const minute = parts.minute;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new MarketDataValidationError('timestamp', 'could not be converted to exchange time');
  }
  return Object.freeze({
    calendarDate: `${year}-${month}-${day}`,
    minuteOfDay: Number(hour) * 60 + Number(minute),
  });
}

function isWeekend(calendarDate: string): boolean {
  const weekday = new Date(`${calendarDate}T12:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function sessionWindow(calendarDate: string): CoreSessionWindow {
  const configuredClose = EARLY_CLOSES[calendarDate];
  return Object.freeze({
    calendarDate,
    openMinute: CORE_OPEN_MINUTE,
    closeMinute: configuredClose ?? NORMAL_CLOSE_MINUTE,
    earlyClose: configuredClose !== undefined,
  });
}

export function classifyNyseCoreSession(timestamp: UtcTimestamp): MarketSessionClassification {
  const validated = createUtcTimestamp(timestamp);
  const { calendarDate, minuteOfDay } = easternParts(validated);
  if (calendarDate < NYSE_CALENDAR_FIRST_DATE || calendarDate > NYSE_CALENDAR_LAST_DATE) {
    return Object.freeze({
      state: 'unknown',
      reason: 'outside_calendar_coverage',
      calendarDate,
    });
  }
  if (isWeekend(calendarDate)) {
    return Object.freeze({ state: 'outside_session', reason: 'weekend', calendarDate });
  }
  if (HOLIDAY_SET.has(calendarDate)) {
    return Object.freeze({ state: 'outside_session', reason: 'holiday', calendarDate });
  }

  const session = sessionWindow(calendarDate);
  if (minuteOfDay < session.openMinute) {
    return Object.freeze({
      state: 'outside_session',
      reason: 'before_open',
      calendarDate,
      session,
    });
  }
  if (minuteOfDay >= session.closeMinute) {
    return Object.freeze({
      state: 'outside_session',
      reason: 'after_close',
      calendarDate,
      session,
    });
  }
  return Object.freeze({ state: 'open', reason: 'core_session', calendarDate, session });
}

export const NYSE_CORE_SESSION_CALENDAR: MarketSessionCalendar = Object.freeze({
  classify: classifyNyseCoreSession,
});
