# P2-01: Define Market-Data Contracts and Semantics

## User Story

As a platform developer, I want versioned application-owned market-data contracts so that provider, transport, storage, and replay code share deterministic meanings.

## Acceptance Criteria

- Accepted ADRs define Phase 2 session coverage, select and version an authoritative exchange calendar/session source, and specify its cache/failure behavior, provider entitlement/delay semantics, freshness thresholds, and closed-market behavior for AAPL and SPY.
- A versioned event envelope and one-minute-bar schema preserve instrument symbol and four-character venue, provider and source identifiers, provider timestamp at its original precision, normalized UTC times, receive time, schema version, interval, currency, and exact open/high/low/close/volume values.
- Provider numeric tokens reach domain constructors without passing through JavaScript `number`; canonicalization and invalid-value rejection are documented. Raw numeric lexemes are discarded after canonical exact values and event identity are produced unless a separate security and retention decision approves storing them.
- A narrow exact-decimal comparison policy validates positivity and OHLC ordering without binary floating point or introducing general financial arithmetic.
- Provider-supplied one-minute bars are the Phase 2 authority. Trade-to-bar aggregation requires the deferred decimal arithmetic, precision, rounding, and exchange-calendar decisions.
- Event identity, ordering keys, acknowledgements, stream retention, idempotency, duplicates, corrections, gaps, late/out-of-order events, and replay boundaries are explicit. A provider sequence is never invented when none exists.
- Provider SDK or payload types do not enter `@daily-trader/domain`; invalid or incomplete data fails explicitly rather than being coerced or filled with zero.

## Validation

- Unit-test schema construction, canonical serialization, round trips, unsupported symbols/venues, exact numeric edge cases, timestamp precision, and every event classification.
- Review the ADRs against ADR 0002, ADR 0003, ADR 0004, and `AGENTS.md` before accepting the contracts.

## Dependencies

- Completed Phase 1 implementation and notes.

## Out of Scope

No provider connection, Redis stream, database table, signal, portfolio, or order behavior is added in this story.
