# P2-05 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

`AlpacaWebSocketSession` owns one bounded WebSocket lifecycle using an injected factory, clock, and timers. It waits for connection success, sends exactly one authentication request, sends exactly one AAPL/SPY bars-only subscription after authentication, and accepts bars only after the exact acknowledgement. Separate connect, authentication, subscription, inactivity, and close deadlines fail with safe classified errors. Queue capacity, cancellation, and close are bounded.

`AlpacaMarketDataAdapter` translates the socket into the provider-neutral application contract and `provider-smoke.ts` supplies the explicit credential-gated production check. The worker pins the MIT-licensed `ws` 8.21.0 transport behind a small application-owned factory, disables per-message compression, caps provider frames at 65,536 bytes, and force-terminates the transport if its graceful-close deadline expires. The smoke emits only sanitized connection and normalized event metadata and stops after both approved symbols are observed.

Alpaca's acknowledgement reports the subscribed symbols but may omit empty channel arrays, and it does not echo feed or delay fields. The adapter therefore requires exactly AAPL/SPY bars, rejects any reported non-bar subscription or unknown field, constrains actual feed identity through the fixed `/v2/iex` endpoint, and treats provider code 409 as entitlement rejection; status labels the configured/validated IEX real-time scope without claiming that those fields were echoed by the acknowledgement. The live smoke confirmed the abbreviated acknowledgement variant, so omitted channel arrays are treated as empty while any explicitly reported non-bar subscription remains rejected. Documented connection-limit, slow-client, and provider-internal failures remain bounded and retryable, while invalid feed subscriptions remain terminal.

## Validation Evidence

- Controlled fake-socket tests cover authentication order, exact subscription scope, pre-acknowledgement rejection, authentication/entitlement/subscription errors, timeouts, ignored and malformed frames, queue overflow, cancellation, graceful close, forced termination after a close timeout, and secret/error-frame exclusion.
- Adapter tests prove normalized events are emitted only after acknowledgement and shutdown closes cleanly.
- Credential-gated provider smoke on 2026-07-13: **Pass**. `node --env-file=dev.env workers/market-data/dist/provider-smoke.js` connected to the fixed Alpaca IEX endpoint, authenticated, received the exact AAPL/SPY bars-only acknowledgement, observed normalized one-minute bars for AAPL/XNAS and SPY/ARCX at 17:18Z, emitted only sanitized metadata, and shut down cleanly after both approved symbols were observed. No credential, provider event ID, or raw frame is recorded here.

## Handoff

Run the documented provider smoke only with an ignored environment file containing `MARKET_DATA_MODE=paper` and the complete credential pair. Never add fallback feeds, symbols, endpoints, brokerage access, or raw-frame recording to make the smoke pass.
