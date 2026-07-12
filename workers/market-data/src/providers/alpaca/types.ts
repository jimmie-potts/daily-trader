declare const jsonNumberLexemeBrand: unique symbol;
export const jsonNumberTokenBrand: unique symbol = Symbol('JsonNumberToken');

/** Raw JSON number text captured before any binary floating-point conversion. */
export type JsonNumberLexeme = string & {
  readonly [jsonNumberLexemeBrand]: 'JsonNumberLexeme';
};

/** A distinguishable JSON number node whose lexeme is still exact text. */
export interface JsonNumberToken {
  readonly kind: 'number';
  readonly raw: JsonNumberLexeme;
  readonly [jsonNumberTokenBrand]: true;
}

export type LosslessJsonArray = readonly LosslessJsonValue[];

export interface LosslessJsonObject {
  readonly [key: string]: LosslessJsonValue;
}

export type LosslessJsonValue =
  boolean | JsonNumberToken | null | string | LosslessJsonArray | LosslessJsonObject;

export type AlpacaSymbol = 'AAPL' | 'SPY';

export const ALPACA_BAR_SYMBOLS = Object.freeze(['AAPL', 'SPY'] as const);

export interface AlpacaRawBar {
  readonly kind: 'bar';
  readonly symbol: AlpacaSymbol;
  readonly open: JsonNumberLexeme;
  readonly high: JsonNumberLexeme;
  readonly low: JsonNumberLexeme;
  readonly close: JsonNumberLexeme;
  readonly volume: JsonNumberLexeme;
  readonly providerTimestamp: string;
}

export type AlpacaIgnoredReason =
  'unsupported_event' | 'unsupported_symbol' | 'unrecognized_success';

export type AlpacaMalformedReason =
  | 'invalid_bar'
  | 'invalid_control_message'
  | 'invalid_error_message'
  | 'invalid_frame'
  | 'invalid_item'
  | 'invalid_subscription';

export type AlpacaDecodedItem =
  | { readonly kind: 'connected' }
  | { readonly kind: 'authenticated' }
  | {
      readonly kind: 'subscription';
      readonly bars: readonly ['AAPL', 'SPY'];
    }
  | {
      readonly kind: 'error';
      readonly code: string;
    }
  | AlpacaRawBar
  | {
      readonly kind: 'ignored';
      readonly eventType: string | undefined;
      readonly reason: AlpacaIgnoredReason;
    }
  | {
      readonly kind: 'malformed';
      readonly reason: AlpacaMalformedReason;
    };

export interface ReceivedAlpacaBar extends AlpacaRawBar {
  readonly receivedAt: string;
}

export interface ClockLike {
  now(): string;
}

export type WebSocketEventType = 'close' | 'error' | 'message' | 'open';
export type WebSocketEventListener = (event: unknown) => void;

/** Deliberately smaller than the browser/Undici WebSocket surface. */
export interface WebSocketLike {
  addEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void;
  removeEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Immediately releases the underlying transport after a graceful-close deadline. */
  terminate(): void;
}

export interface WebSocketFactory {
  create(url: string): WebSocketLike;
}

export type TimerHandle = object | number;

export interface TimerScheduler {
  setTimeout(callback: () => void, milliseconds: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}
