import type { AppMeter, MetricAttributes } from '@daily-trader/observability';
import { describe, expect, it } from 'vitest';

import { MarketDataMetrics } from './metrics.js';

describe('MarketDataMetrics', () => {
  it('uses fixed per-subscription names and bounded categorical attributes', () => {
    const observations: Array<{
      readonly name: string;
      readonly attributes: MetricAttributes | undefined;
    }> = [];
    const meter: AppMeter = {
      addCounter: (name, _value, attributes): void => {
        observations.push({ name, attributes });
      },
      recordGauge: (name, _value, _unit, attributes): void => {
        observations.push({ name, attributes });
      },
      recordHealth: (): void => undefined,
      recordHistogram: (name, _value, _unit, attributes): void => {
        observations.push({ name, attributes });
      },
    };
    const metrics = new MarketDataMetrics(meter);

    metrics.recordConnectionState('subscribed');
    metrics.recordFreshness('AAPL', 'fresh');
    metrics.recordGap('SPY', 'gapped', 2);
    metrics.recordFailure('malformed');
    metrics.recordBoundaryResult('postgres', 'succeeded');

    expect(observations.map(({ name }) => name)).toEqual([
      'daily_trader.market_data.connection_state',
      'daily_trader.market_data.aapl.freshness',
      'daily_trader.market_data.spy.gap_state',
      'daily_trader.market_data.spy.gaps_detected',
      'daily_trader.market_data.failures',
      'daily_trader.market_data.boundary_results',
    ]);
    expect(JSON.stringify(observations)).not.toMatch(/instrument|symbol|event_id|session_id/u);
  });
});
