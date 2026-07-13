# Sanitized Alpaca Portfolio Fixtures

These are intentionally small synthetic fragments for the GET-only paper-provider contract. All
account, asset, order, fill, request, and client-order identifiers are invented test values. The
fixtures contain no API credential, real account identifier, complete production response, or raw
captured payload.

The catalog exercises canonical decimal normalization, sub-millisecond provider timestamps,
fractional and signed-short positions, a supported US-equity holding, an unsupported crypto
holding, an observed partial order, an observed notional order, and a partial-fill activity.
The legacy fill object intentionally has `transaction_time` but no `created_at`: transport tests
cover the provider's exclusive creation-time query bounds, while normalization preserves execution
time as independent evidence.
