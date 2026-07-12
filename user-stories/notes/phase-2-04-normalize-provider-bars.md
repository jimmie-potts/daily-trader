# P2-04 Implementation Note

- Status: Complete
- Completed: 2026-07-12

## What Was Implemented

The Alpaca boundary includes a bounded lossless JSON parser that represents every JSON number as a branded raw lexeme before any general numeric conversion. The pure frame decoder classifies every array item once as connected, authenticated, subscription, error, bar, ignored, or malformed. Only `T=b` AAPL/SPY messages with all required fields can become raw bars; trades, quotes, updated bars, daily bars, wrong symbols, unsafe subscription scope, and malformed frames cannot.

`normalizeAlpacaBar` maps accepted frames into `OneMinuteBarEvent`. Numeric lexemes are canonicalized and revalidated without passing through JavaScript `number`; exponent notation, invalid signs, nonpositive prices, negative volume, and invalid OHLC ordering fail explicitly. Original provider timestamp precision remains distinct from normalized bar, receive, and process times. Complete frames and authentication/control contents are discarded after classification.

Alpaca bar payloads do not repeat source/feed/entitlement, interval, or currency fields. In accordance with ADR 0006, the adapter establishes those values from the immutable `/v2/iex` endpoint, exact AAPL/SPY bars-only acknowledgement, and fixed application contract; the pure payload decoder validates only fields actually present in the provider frame. Alpaca may omit empty channel arrays from an acknowledgement, so the decoder accepts omitted channels as empty but rejects every reported non-bar subscription and every extra field.

## Validation Evidence

- Provider decoder, lossless-parser, normalizer, adapter, and WebSocket tests passed in the targeted provider/recovery suite.
- Fixtures exercise trailing zeroes, values larger than JavaScript's safe integer range, nanosecond timestamps, malformed fields, incorrect symbols, unsupported event kinds, invalid OHLC/volume, and secret-bearing provider error messages.
- Source inspection and tests confirm accepted OHLC/volume paths expose exact strings rather than JavaScript numbers.

## Handoff

Do not replace the lossless boundary with `JSON.parse` over provider bar frames. Downstream code consumes only canonical application events and must never retain or log the raw numeric lexemes or complete provider messages.
