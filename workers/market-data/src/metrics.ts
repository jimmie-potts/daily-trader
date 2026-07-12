import type { AppMeter } from '@daily-trader/observability';

import type {
  EventOrderingClassification,
  GapState,
  MarketDataConnectionState,
  MarketDataFreshness,
  SupportedMarketDataSymbol,
} from '@daily-trader/market-data';

export type MarketDataFailureReason =
  | 'authentication'
  | 'backpressure'
  | 'contract'
  | 'database'
  | 'duplicate'
  | 'entitlement'
  | 'malformed'
  | 'out_of_order'
  | 'redis'
  | 'timeout'
  | 'transport'
  | 'unsupported';

function symbolMetric(symbol: SupportedMarketDataSymbol, suffix: string): string {
  return `daily_trader.market_data.${symbol.toLowerCase()}.${suffix}`;
}

/** Bounded, component-specific metrics without identifiers or arbitrary provider labels. */
export class MarketDataMetrics {
  readonly #meter: AppMeter;

  public constructor(meter: AppMeter) {
    this.#meter = meter;
  }

  public recordConnectionState(state: MarketDataConnectionState): void {
    this.#meter.recordGauge(
      'daily_trader.market_data.connection_state',
      1,
      '1',
      { state },
      'Current provider connection lifecycle state.',
    );
  }

  public recordReconnect(result: 'attempt' | 'exhausted' | 'succeeded'): void {
    this.#meter.addCounter(
      'daily_trader.market_data.reconnects',
      1,
      { result },
      'Bounded provider reconnect outcomes.',
    );
  }

  public recordLastEventAge(symbol: SupportedMarketDataSymbol, ageMs: number): void {
    this.#meter.recordGauge(
      symbolMetric(symbol, 'last_event_age'),
      Math.max(0, ageMs),
      'ms',
      {},
      `Age of the last valid ${symbol} one-minute bar.`,
    );
  }

  public recordFreshness(
    symbol: SupportedMarketDataSymbol,
    state: MarketDataFreshness['state'],
  ): void {
    this.#meter.recordGauge(
      symbolMetric(symbol, 'freshness'),
      1,
      '1',
      { state },
      `Current ${symbol} bar freshness classification.`,
    );
  }

  public recordGap(symbol: SupportedMarketDataSymbol, state: GapState, count = 0): void {
    this.#meter.recordGauge(
      symbolMetric(symbol, 'gap_state'),
      1,
      '1',
      { state },
      `Current ${symbol} interval-gap classification.`,
    );
    if (count > 0) {
      this.#meter.addCounter(
        symbolMetric(symbol, 'gaps_detected'),
        count,
        {},
        `Detected missing core-session ${symbol} intervals.`,
      );
    }
  }

  public recordArrival(classification: EventOrderingClassification): void {
    this.#meter.addCounter(
      'daily_trader.market_data.arrivals',
      1,
      { classification },
      'Validated market-data arrivals by bounded ordering classification.',
    );
  }

  public recordFailure(reason: MarketDataFailureReason): void {
    this.#meter.addCounter(
      'daily_trader.market_data.failures',
      1,
      { reason },
      'Safe bounded market-data failure classifications.',
    );
  }

  public recordBoundaryResult(
    component: 'postgres' | 'redis' | 'replay',
    result: 'duplicate' | 'failed' | 'succeeded',
  ): void {
    this.#meter.addCounter(
      'daily_trader.market_data.boundary_results',
      1,
      { component, result },
      'Delivery, persistence, and replay outcomes.',
    );
  }

  public recordBoundaryLatency(
    component: 'postgres' | 'redis' | 'replay',
    durationMs: number,
  ): void {
    this.#meter.recordHistogram(
      'daily_trader.market_data.boundary_latency',
      durationMs,
      'ms',
      { component },
      'Market-data boundary latency.',
    );
  }
}
