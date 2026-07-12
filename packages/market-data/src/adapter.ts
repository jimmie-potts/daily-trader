import { type InstrumentId, type UtcTimestamp } from '@daily-trader/domain';

import { type OneMinuteBarEvent } from './bar-event.js';
import { ONE_MINUTE_INTERVAL, PHASE_2_INSTRUMENTS } from './constants.js';
import { type MarketDataConnectionState } from './recovery.js';

export type MarketDataAdapterErrorClassification =
  | 'retryable_transport'
  | 'authentication'
  | 'entitlement'
  | 'contract'
  | 'malformed_data'
  | 'unsupported_subscription';

export class MarketDataAdapterError extends Error {
  public readonly classification: MarketDataAdapterErrorClassification;
  public readonly code: string;
  public readonly retryable: boolean;

  public constructor(
    classification: MarketDataAdapterErrorClassification,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MarketDataAdapterError';
    this.classification = classification;
    this.code = code;
    this.retryable = classification === 'retryable_transport';
  }
}

export interface MarketDataSubscription {
  readonly instruments: readonly InstrumentId[];
  readonly interval: typeof ONE_MINUTE_INTERVAL;
}

export interface MarketDataAdapterStatus {
  readonly state: MarketDataConnectionState;
  readonly occurredAt: UtcTimestamp;
}

export interface MarketDataAdapterHandlers {
  /** The adapter awaits this callback and has at most one event delivery in flight. */
  onEvent(event: OneMinuteBarEvent): Promise<void> | void;
  onInactivity(occurredAt: UtcTimestamp): Promise<void> | void;
  onStatus(status: MarketDataAdapterStatus): Promise<void> | void;
}

export interface MarketDataAdapterRequest {
  readonly subscription: MarketDataSubscription;
  readonly handlers: MarketDataAdapterHandlers;
  readonly signal?: AbortSignal;
}

export interface MarketDataAdapterConnection {
  readonly done: Promise<void>;
  /** Idempotent and required to settle within the adapter's configured shutdown deadline. */
  cancel(): Promise<void>;
}

export interface MarketDataAdapter {
  connect(request: MarketDataAdapterRequest): Promise<MarketDataAdapterConnection>;
}

export function createPhase2MarketDataSubscription(): MarketDataSubscription {
  return Object.freeze({
    instruments: Object.freeze([PHASE_2_INSTRUMENTS.AAPL, PHASE_2_INSTRUMENTS.SPY]),
    interval: ONE_MINUTE_INTERVAL,
  });
}

export function validateMarketDataSubscription(subscription: MarketDataSubscription): void {
  const runtimeInterval: unknown = subscription.interval;
  if (runtimeInterval !== ONE_MINUTE_INTERVAL) {
    throw new MarketDataAdapterError(
      'unsupported_subscription',
      'UNSUPPORTED_INTERVAL',
      'Only one-minute bars are supported',
    );
  }
  if (subscription.instruments.length !== 2) {
    throw new MarketDataAdapterError(
      'unsupported_subscription',
      'UNSUPPORTED_INSTRUMENTS',
      'The Phase 2 subscription must contain exactly AAPL and SPY',
    );
  }
  const keys = subscription.instruments.map(
    (instrument) => `${instrument.venue}:${instrument.symbol}`,
  );
  if (new Set(keys).size !== 2 || !keys.includes('XNAS:AAPL') || !keys.includes('ARCX:SPY')) {
    throw new MarketDataAdapterError(
      'unsupported_subscription',
      'UNSUPPORTED_INSTRUMENTS',
      'The Phase 2 subscription must contain exactly AAPL at XNAS and SPY at ARCX',
    );
  }
}
