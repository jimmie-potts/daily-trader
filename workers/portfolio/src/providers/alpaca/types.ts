import type { UtcTimestamp } from '@daily-trader/domain';

import type { PortfolioSnapshotCaptureRequest } from '../types.js';

export const ALPACA_PAPER_TRADING_API_BASE = 'https://paper-api.alpaca.markets/v2' as const;

export type AlpacaReadPath = '/account' | '/account/activities/FILL' | '/orders' | '/positions';

export interface AlpacaFetchHeaders {
  get(name: string): string | null;
}

export interface AlpacaFetchBodyReader {
  read(): Promise<
    | { readonly done: false; readonly value: Uint8Array }
    | { readonly done: true; readonly value?: Uint8Array }
  >;
  cancel(reason?: unknown): Promise<void>;
}

export interface AlpacaFetchBody {
  getReader(): AlpacaFetchBodyReader;
}

export interface AlpacaFetchResponse {
  readonly body: AlpacaFetchBody | null;
  readonly headers: AlpacaFetchHeaders;
  readonly status: number;
}

export interface AlpacaFetchInit {
  readonly headers: Readonly<Record<string, string>>;
  readonly method: 'GET';
  readonly redirect: 'manual';
  readonly signal?: AbortSignal;
}

export type AlpacaFetch = (input: string, init: AlpacaFetchInit) => Promise<AlpacaFetchResponse>;

export interface AlpacaResponseMetadata {
  readonly receivedAt: UtcTimestamp;
  readonly requestId: string;
}

export interface AlpacaRawResponse<T> {
  readonly metadata: AlpacaResponseMetadata;
  readonly payload: T;
}

export interface AlpacaRawCapture {
  readonly account: AlpacaRawResponse<unknown>;
  readonly activityBaselineOnly: boolean;
  /** Exclusive Alpaca `until` bound over activity creation time. */
  readonly activityCutoverAt: UtcTimestamp;
  /** Exclusive Alpaca `after` bound over activity creation time. */
  readonly activityWindowStartedAt: UtcTimestamp;
  readonly captureCompletedAt: UtcTimestamp;
  readonly captureStartedAt: UtcTimestamp;
  readonly fills: readonly AlpacaRawResponse<readonly unknown[]>[];
  readonly orders: readonly AlpacaRawResponse<readonly unknown[]>[];
  readonly positions: AlpacaRawResponse<readonly unknown[]>;
}

export type AlpacaCaptureRequest = PortfolioSnapshotCaptureRequest;
