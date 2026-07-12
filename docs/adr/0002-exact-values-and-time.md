# ADR 0002: Exact Values and Time

- Status: Accepted
- Date: 2026-07-11

## Context

Money, prices, and quantities cannot safely use JavaScript binary floating point. Time-dependent behavior must also be reproducible.

## Decision

Represent exact decimal values at boundaries as validated canonical decimal strings and wrap them in unit-bearing application types. Phase 1 performs no arithmetic. Before financial calculations are added, a separate ADR must choose the decimal arithmetic library, precision, and rounding policy.

Represent timestamps as validated UTC ISO-8601 strings. Domain behavior receives a `Clock` rather than reading wall time directly. Exchange timezone and calendar rules remain explicit inputs when session behavior is introduced.

## Consequences

Invalid or noncanonical values fail rather than being coerced or replaced with zero. Serialization remains deterministic. Later arithmetic work cannot silently introduce `number` for exact financial values.
