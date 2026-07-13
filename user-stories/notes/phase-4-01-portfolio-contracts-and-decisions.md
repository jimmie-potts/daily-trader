# P4-01 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

ADRs 0012-0014 fix the read-only paper-broker boundary, bounded non-atomic synchronization meaning, append-only persistence and reconciliation model, and exact valuation policy. The provider-, framework-, and persistence-independent `@daily-trader/portfolio` package owns immutable account, position, observed-order, fill, request-receipt, synchronization-snapshot, prepared-projection, reconciliation, and calculated-projection contracts.

All financial values remain canonical decimal strings with application-owned currency and unit context. Deterministic identities bind normalized provider evidence without including receipt, worker, retry, or database timestamps. Complete snapshots retain the knowledge interval, both exclusive provider activity-creation query bounds, and the initial-baseline flag. Fill transaction time remains separate execution evidence because the response omits the creation timestamp used by the filters. Unsupported holdings remain part of the full account, while broker orders and fills remain observations rather than local intents or executable orders.

## Validation Evidence

- `npm test --workspace=@daily-trader/portfolio`: **Pass** — 7 test files/241 tests covered construction, immutability, canonical serialization, identities, bounded request evidence, cycle and coverage invariants, unsupported holdings, projections, and reconciliation.
- Portfolio package type checking and linting passed with only `@daily-trader/domain` and pinned `big.js` as runtime dependencies.
- Export and dependency review found no provider SDK, HTTP, PostgreSQL, web, signal-rule, alert, risk, approval, broker mutation, or execution capability in the package.

## Handoff

Later portfolio work may depend on these application-owned contracts and accepted meanings. It must preserve the bounded open provider-created query claim without upgrading it to transaction-time completeness, full-account visibility, observation-only order/fill semantics, exact-value boundaries, and narrow reconciliation meaning. Any change to those semantics requires a version change and an accepted ADR.
