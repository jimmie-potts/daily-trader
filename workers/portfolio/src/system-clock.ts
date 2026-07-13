import { createUtcTimestamp, type Clock, type UtcTimestamp } from '@daily-trader/domain';

export class SystemClock implements Clock {
  public now(): UtcTimestamp {
    return createUtcTimestamp(new Date().toISOString());
  }
}
