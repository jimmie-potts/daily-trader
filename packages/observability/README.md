# Observability Conventions

Daily Trader emits structured JSON logs and uses OpenTelemetry APIs behind this package. Domain code must not import this package or OpenTelemetry.

## Naming and cardinality

- Metric names use lowercase dot-separated segments, such as `daily_trader.process.health`.
- Units are explicit (`ms`, `s`, `By`, or `1`) and descriptions explain the observation.
- Attribute keys use lowercase snake case. Values are short operational categories, never symbols, account IDs, order IDs, unbounded error messages, or other high-cardinality data.
- Correlation identifiers belong in logs and traces. Add them to metrics only after proving the value set is bounded.
- Log timestamps are ISO 8601 UTC strings. Metric and span timestamps come from OpenTelemetry's monotonic-aware SDK clock; event/business timestamps remain explicit application data.
- Trace propagation allowlists W3C `traceparent` and `tracestate` only. Baggage is not forwarded because it can carry unreviewed sensitive values.

Phase 1 supports `none` and diagnostic `console` exporters only. Hosted or OTLP exporters require separately reviewed configuration and bounded retry behavior.
