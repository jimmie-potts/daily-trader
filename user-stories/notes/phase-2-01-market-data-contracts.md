# P2-01 Implementation Note

- Status: Complete
- Completed: 2026-07-12

## What Was Implemented

ADRs 0006-0008 define the Phase 2 provider/session scope, exact event and ordering semantics, and delivery/persistence/replay contract. `@daily-trader/market-data` owns the provider-neutral one-minute-bar schema, canonical serialization, SHA-256 event identity, AAPL/XNAS and SPY/ARCX identities, source metadata, freshness, session classification, ordering, corrections, lateness, and gaps.

The accepted session source is an immutable 2026-2028 NYSE core-session snapshot. Dates outside coverage are `unknown`. Provider timestamps retain their original RFC 3339 precision while normalized UTC millisecond timestamps remain separate. Exact values are canonical strings; the domain comparator checks sign and digits without general arithmetic, rounding, or JavaScript floating point.

## Validation Evidence

- The targeted `packages/market-data` suite passed with 5 files and 107 tests.
- Tests cover calendar holidays, early closes, daylight-saving offsets, unknown coverage, canonical round trips, stable identity, correction keys, duplicate/out-of-order/late classifications, gaps, freshness, exact numeric edge cases, and provider timestamp precision.
- Dependency inspection confirms `@daily-trader/market-data` depends only on `@daily-trader/domain` and Node.js built-ins; it owns no provider socket, Redis, PostgreSQL, observability, portfolio, signal, or execution behavior.

## Handoff

All provider, transport, persistence, replay, and status code must use these contracts rather than redefining symbols, units, calendar rules, identity, or ordering. Extending instruments, feeds, event kinds, calendar coverage, or session hours requires a reviewed follow-up decision.
