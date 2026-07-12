import { createUtcTimestamp, type Clock, type UtcTimestamp } from '@daily-trader/domain';

/** Wall-clock adapter kept at the process boundary; domain behavior receives Clock. */
export class SystemClock implements Clock {
  public now(): UtcTimestamp {
    return createUtcTimestamp(new Date().toISOString());
  }
}
