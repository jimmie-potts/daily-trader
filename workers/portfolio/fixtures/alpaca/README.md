# Sanitized Alpaca Portfolio Fixtures

These are intentionally small synthetic fragments for the GET-only paper-provider contract. All
account, asset, order, fill, request, and client-order identifiers are invented test values. The
fixtures contain no API credential, real account identifier, complete production response, or raw
captured payload.

The catalog exercises canonical decimal normalization, sub-millisecond provider timestamps,
fractional and signed-short positions, a supported US-equity holding, an unsupported crypto
holding, an observed partial order, an observed notional order, and a partial-fill activity.
`orders-mleg.json` is a separate normalization and persistence fixture for an explicit multi-leg
parent whose singular asset, symbol, class, and side facts are absent, null, or empty. Its concrete
child legs cover simple, null, and empty child class values plus absent, null, and empty order type.
Raw `ratio_qty` values and child quantities follow realistic parent-quantity multiplication, but
ratio semantics are intentionally unsupported and are not promoted into the canonical domain. The
fixture stays out of the default synchronized portfolio so baseline resource counts are stable.
The legacy fill object intentionally has `transaction_time` but no `created_at`: transport tests
cover the provider's exclusive creation-time query bounds, while normalization preserves execution
time as independent evidence.
