# Observability Conventions

Daily Trader emits structured JSON logs and uses OpenTelemetry APIs behind this package. Domain code must not import this package or OpenTelemetry.

## Naming and cardinality

- Metric names use lowercase dot-separated segments, such as `daily_trader.process.health`.
- Units are explicit (`ms`, `s`, `By`, or `1`) and descriptions explain the observation.
- Attribute keys use lowercase snake case. Values are short operational categories, never symbols, account IDs, order IDs, unbounded error messages, or other high-cardinality data.
- Correlation identifiers belong in logs and traces. Add them to metrics only after proving the value set is bounded.
- Log timestamps are ISO 8601 UTC strings. Metric and span timestamps come from OpenTelemetry's monotonic-aware SDK clock; event/business timestamps remain explicit application data.
- Trace propagation allowlists W3C `traceparent` and `tracestate` only. Baggage is not forwarded because it can carry unreviewed sensitive values.

The current implementation supports `none` and diagnostic `console` exporters only. Hosted or OTLP exporters require separately reviewed configuration and bounded retry behavior.

## Phase 2 market-data signals

`workers/market-data/src/metrics.ts` defines the bounded Phase 2 measurements:

- provider connection lifecycle and reconnect outcomes;
- per-approved-symbol last-event age, freshness, gap state, and detected-gap count;
- accepted, duplicate, correction, and out-of-order arrival counts;
- classified authentication, entitlement, timeout, transport, malformed, Redis, and database failures; and
- Redis, PostgreSQL, and replay boundary results and latency.

Only fixed component names, AAPL/SPY, lifecycle states, and other finite classifications are permitted. Event IDs, session IDs, ordering keys, provider messages, exception text, and arbitrary symbols must not become metric attributes.

Logs and traces may contain safe application event metadata, but never authentication frames, WebSocket URLs, credentials, raw provider payloads, complete Redis event bodies, or database connection strings. Central redaction covers credential-, endpoint-, payload-, provider-response-, session-, token-, URI-, and URL-like keys recursively. Adapter errors must translate untrusted provider and callback failures into bounded application codes before they reach observability.
