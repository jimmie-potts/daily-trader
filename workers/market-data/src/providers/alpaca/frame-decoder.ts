import { normalizeProviderTimestamp } from '@daily-trader/market-data';

import { isJsonNumberToken, parseLosslessJson, type LosslessJsonLimits } from './lossless-json.js';
import {
  ALPACA_BAR_SYMBOLS,
  type AlpacaDecodedItem,
  type AlpacaRawBar,
  type AlpacaSymbol,
  type LosslessJsonArray,
  type LosslessJsonValue,
} from './types.js';

const SUBSCRIPTION_CHANNELS = Object.freeze([
  'bars',
  'cancelErrors',
  'corrections',
  'dailyBars',
  'lulds',
  'quotes',
  'statuses',
  'trades',
  'updatedBars',
] as const);

const SUBSCRIPTION_KEYS = new Set<string>(['T', ...SUBSCRIPTION_CHANNELS]);
const SAFE_PROVIDER_CODE = /^[A-Za-z0-9_-]{1,32}$/u;

function isRecord(value: LosslessJsonValue): value is Readonly<Record<string, LosslessJsonValue>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isJsonNumberToken(value)
  );
}

function isSupportedSymbol(value: string): value is AlpacaSymbol {
  return value === 'AAPL' || value === 'SPY';
}

function isJsonArray(value: LosslessJsonValue): value is LosslessJsonArray {
  return Array.isArray(value);
}

function invalid(
  reason:
    | 'invalid_bar'
    | 'invalid_control_message'
    | 'invalid_error_message'
    | 'invalid_frame'
    | 'invalid_item'
    | 'invalid_subscription',
): AlpacaDecodedItem {
  return Object.freeze({ kind: 'malformed', reason });
}

function decodeBar(item: Readonly<Record<string, LosslessJsonValue>>): AlpacaDecodedItem {
  const symbol = item.S;
  if (typeof symbol !== 'string') {
    return invalid('invalid_bar');
  }
  if (!isSupportedSymbol(symbol)) {
    return Object.freeze({
      eventType: 'b',
      kind: 'ignored',
      reason: 'unsupported_symbol',
    });
  }

  const open = item.o;
  const high = item.h;
  const low = item.l;
  const close = item.c;
  const volume = item.v;
  const providerTimestamp = item.t;

  if (
    !isJsonNumberToken(open) ||
    !isJsonNumberToken(high) ||
    !isJsonNumberToken(low) ||
    !isJsonNumberToken(close) ||
    !isJsonNumberToken(volume) ||
    typeof providerTimestamp !== 'string' ||
    providerTimestamp.length === 0
  ) {
    return invalid('invalid_bar');
  }
  try {
    normalizeProviderTimestamp(providerTimestamp);
  } catch {
    return invalid('invalid_bar');
  }

  const bar: AlpacaRawBar = {
    kind: 'bar',
    symbol,
    open: open.raw,
    high: high.raw,
    low: low.raw,
    close: close.raw,
    volume: volume.raw,
    providerTimestamp,
  };
  return Object.freeze(bar);
}

function readStringList(value: LosslessJsonValue | undefined): readonly string[] | undefined {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined;
  }
  return value as readonly string[];
}

function decodeSubscription(item: Readonly<Record<string, LosslessJsonValue>>): AlpacaDecodedItem {
  if (Object.keys(item).some((key) => !SUBSCRIPTION_KEYS.has(key))) {
    return invalid('invalid_subscription');
  }

  const bars = readStringList(item.bars);
  if (
    bars === undefined ||
    bars.length !== ALPACA_BAR_SYMBOLS.length ||
    new Set(bars).size !== ALPACA_BAR_SYMBOLS.length ||
    !ALPACA_BAR_SYMBOLS.every((symbol) => bars.includes(symbol))
  ) {
    return invalid('invalid_subscription');
  }

  for (const channel of SUBSCRIPTION_CHANNELS) {
    if (channel === 'bars') {
      continue;
    }
    const subscriptions = readStringList(item[channel]);
    if (subscriptions === undefined || subscriptions.length !== 0) {
      return invalid('invalid_subscription');
    }
  }

  return Object.freeze({
    bars: ALPACA_BAR_SYMBOLS,
    kind: 'subscription',
  });
}

function decodeError(item: Readonly<Record<string, LosslessJsonValue>>): AlpacaDecodedItem {
  const codeValue = item.code;
  const code = isJsonNumberToken(codeValue)
    ? codeValue.raw
    : typeof codeValue === 'string'
      ? codeValue
      : undefined;

  if (code === undefined || !SAFE_PROVIDER_CODE.test(code)) {
    return invalid('invalid_error_message');
  }
  return Object.freeze({ code, kind: 'error' });
}

function decodeItem(item: LosslessJsonValue): AlpacaDecodedItem {
  if (!isRecord(item)) {
    return invalid('invalid_item');
  }

  const eventType = item.T;
  if (typeof eventType !== 'string') {
    return invalid('invalid_control_message');
  }

  if (eventType === 'b') {
    return decodeBar(item);
  }
  if (eventType === 'subscription') {
    return decodeSubscription(item);
  }
  if (eventType === 'error') {
    return decodeError(item);
  }
  if (eventType === 'success') {
    if (item.msg === 'connected') {
      return Object.freeze({ kind: 'connected' });
    }
    if (item.msg === 'authenticated') {
      return Object.freeze({ kind: 'authenticated' });
    }
    if (typeof item.msg !== 'string') {
      return invalid('invalid_control_message');
    }
    return Object.freeze({
      eventType,
      kind: 'ignored',
      reason: 'unrecognized_success',
    });
  }

  return Object.freeze({
    eventType,
    kind: 'ignored',
    reason: 'unsupported_event',
  });
}

/** Purely classifies each Alpaca array item, without logging or retaining raw frames. */
export class AlpacaFrameDecoder {
  readonly #limits: LosslessJsonLimits;

  public constructor(limits: LosslessJsonLimits = {}) {
    this.#limits = Object.freeze({ ...limits });
  }

  public decode(rawFrame: string): readonly AlpacaDecodedItem[] {
    try {
      const parsed = parseLosslessJson(rawFrame, this.#limits);
      if (!isJsonArray(parsed)) {
        return Object.freeze([invalid('invalid_frame')]);
      }
      return Object.freeze(parsed.map((item) => decodeItem(item)));
    } catch {
      return Object.freeze([invalid('invalid_frame')]);
    }
  }
}
