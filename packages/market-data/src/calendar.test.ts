import { createUtcTimestamp } from '@daily-trader/domain';
import { describe, expect, it } from 'vitest';

import { NYSE_CALENDAR_SNAPSHOT, classifyNyseCoreSession } from './calendar.js';

describe('embedded NYSE 2026-2028 core-session calendar', () => {
  it('records immutable source coverage and all official snapshot years', () => {
    expect(NYSE_CALENDAR_SNAPSHOT).toMatchObject({
      sourceAsOf: '2026-07-12',
      firstDate: '2026-01-01',
      lastDate: '2028-12-31',
      timeZone: 'America/New_York',
    });
    expect(NYSE_CALENDAR_SNAPSHOT.holidays).toContain('2026-07-03');
    expect(NYSE_CALENDAR_SNAPSHOT.holidays).toContain('2027-12-24');
    expect(NYSE_CALENDAR_SNAPSHOT.holidays).toContain('2028-07-04');
    expect(Object.isFrozen(NYSE_CALENDAR_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(NYSE_CALENDAR_SNAPSHOT.holidays)).toBe(true);
  });

  it('uses New York daylight-saving offsets for the 09:30 open', () => {
    expect(classifyNyseCoreSession(createUtcTimestamp('2026-01-02T14:30:00.000Z')).state).toBe(
      'open',
    );
    expect(classifyNyseCoreSession(createUtcTimestamp('2026-07-13T13:30:00.000Z')).state).toBe(
      'open',
    );
  });

  it.each([
    ['2026-01-01T15:00:00.000Z', 'holiday'],
    ['2026-07-03T15:00:00.000Z', 'holiday'],
    ['2027-06-18T15:00:00.000Z', 'holiday'],
    ['2028-04-14T15:00:00.000Z', 'holiday'],
    ['2026-07-12T15:00:00.000Z', 'weekend'],
  ])('classifies %s outside session because it is a %s', (timestamp, reason) => {
    expect(classifyNyseCoreSession(createUtcTimestamp(timestamp))).toMatchObject({
      state: 'outside_session',
      reason,
    });
  });

  it.each([
    ['2026-11-27T17:59:00.000Z', 'open'],
    ['2026-11-27T18:00:00.000Z', 'outside_session'],
    ['2026-12-24T18:00:00.000Z', 'outside_session'],
    ['2027-11-26T18:00:00.000Z', 'outside_session'],
    ['2028-07-03T17:00:00.000Z', 'outside_session'],
    ['2028-11-24T18:00:00.000Z', 'outside_session'],
  ])('honors official early-close boundary %s', (timestamp, expectedState) => {
    const classification = classifyNyseCoreSession(createUtcTimestamp(timestamp));
    expect(classification.state).toBe(expectedState);
    if ('session' in classification) {
      expect(classification.session.earlyClose).toBe(true);
      expect(classification.session.closeMinute).toBe(13 * 60);
    }
  });

  it('uses a half-open regular session and distinguishes before from after', () => {
    expect(classifyNyseCoreSession(createUtcTimestamp('2026-07-13T13:29:59.999Z')).reason).toBe(
      'before_open',
    );
    expect(classifyNyseCoreSession(createUtcTimestamp('2026-07-13T19:59:59.999Z')).state).toBe(
      'open',
    );
    expect(classifyNyseCoreSession(createUtcTimestamp('2026-07-13T20:00:00.000Z')).reason).toBe(
      'after_close',
    );
  });

  it.each(['2025-12-31T15:00:00.000Z', '2029-01-02T15:00:00.000Z'])(
    'fails closed outside calendar coverage: %s',
    (timestamp) => {
      expect(classifyNyseCoreSession(createUtcTimestamp(timestamp))).toMatchObject({
        state: 'unknown',
        reason: 'outside_calendar_coverage',
      });
    },
  );
});
