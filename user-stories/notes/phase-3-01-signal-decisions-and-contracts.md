# P3-01 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

ADRs 0009-0011 define the exact arithmetic, committed-canonical-revision handoff, and `breakout_plus_volume.v1` semantics required by the story. `@daily-trader/market-data` owns the provider-neutral canonical revision and pure transition decision, while the new provider- and persistence-independent `@daily-trader/signals` package owns immutable feature, evaluation, occurrence, evidence, transition, and replay contracts.

Global deterministic identities bind the complete semantic version set, instrument, evaluation bar, observation and knowledge context, and ordered evidence. Run-scoped transition identities separately bind processing order, predecessor, supersession, and retraction. A signal occurrence remains an observation, never a recommendation, portfolio action, alert, order intent, or execution request.

## Validation Evidence

- Contract, canonical-serialization, identity, exact-value, evidence-ordering, revision, outcome, and transition tests passed in the root `npm run verify:phase3` run.
- `npm run verify:phase3`: **Pass** — root CI completed 52 test files/544 tests, dependency audit reported zero vulnerabilities, and the credential-free PostgreSQL/replay/service matrix passed.
- The direct P2-11 dependency is complete: the 2026-07-13 credential-gated smoke authenticated, subscribed to exact Alpaca IEX AAPL/SPY bars, observed both approved normalized symbols, and shut down cleanly.

## Handoff

Later signal behavior must preserve the application-owned package direction, exact semantic identities, committed-canonical-input boundary, and observation-only meaning. Changing arithmetic, revision, evidence, or signal semantics requires a new version and accepted ADR.
