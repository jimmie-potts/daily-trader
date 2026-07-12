# P3-09: Verify and Hand Off Phase 3

## User Story

As a contributor, I want one reproducible Phase 3 verification path so that the deterministic signal slice can be extended without hidden arithmetic, evidence, delivery, or replay assumptions.

## Acceptance Criteria

- Both P2-11 external exit demonstrations are recorded as passing before Phase 3 verification begins: integrated Redis/TimescaleDB restart verification and credential-gated observation of normalized AAPL and SPY provider bars.
- A credential-free `npm run verify:phase3` command runs root quality gates and dependency audit, starts healthy local services, applies/checks all migrations through the generalized migration owner, ingests the Phase 3 synthetic scenario, records and processes canonical revisions, persists and associates feature/evaluation/occurrence evidence, renders signal status, performs two isolated clean replays plus existing-state and interrupted/restart replay, and cleans up bounded resources without deleting named volumes.
- The failure matrix covers invalid exact-decimal arithmetic/configuration, arithmetic overflow, warm-up, equality boundaries, gaps, future-as-of and unknown-session data, zero or missing volume, worker lag, duplicate/redelivery, forward and historical inserts, known-gap fills, winning/losing replacements, supersession/retraction, on-time/retrospective results, unsupported versions, atomic cutover, wrong-configuration backlog, revision-journal/cursor/database outage or gap, capacity, concurrency, crash at each commit/cursor boundary, wrong run membership, corrupt recordings, and shutdown.
- Normal CI, fixture, replay, and verification require no provider or broker credential. The existing provider smoke proves the live input boundary only; a naturally occurring breakout is not required and synthetic success is not represented as provider-observed signal performance.
- `README.md`, `AGENTS.md`, accepted ADRs, package documentation, migrations, fixtures, commands, and completed story implementation notes match actual behavior and preserve the remaining roadmap order.
- Dependency maintenance, license, and security findings for the selected decimal implementation and any new dependency are reviewed and recorded.
- The final review finds no JavaScript exact-decimal signal arithmetic, look-ahead, ambient-time outcome, silent zero fill, unbounded in-memory feature state, mutable audit history, lost canonical-revision work, provider type in signal contracts, portfolio or broker capability, alert/order/execution path, LLM call, additional asset/signal, unsafe log, or secret.

## Validation

- Run the documented workflow from a clean or equivalent isolated checkout, restart services during a partially warmed window, and record exact commands and results in the P3-09 implementation note.
- Compare complete canonical signal exports and checksums from two isolated clean targets, repeated existing state, and interrupted/restart replay. For correction-order variants, compare the converged latest-revision projection and non-superseded/non-retracted fired history while retaining each valid append-only transition history.

## Dependencies

- P3-01 through P3-08.

## Exit Criterion

Phase 3 is complete only when the one approved breakout-plus-volume observation is calculated from committed canonical bars with reviewed exact-decimal arithmetic, every result and run association is persisted idempotently with complete evidence, every run-owned post-cutover canonical revision is durably processed under the correct configuration, historical changes and restart preserve append-only truth, and the same ordered replay produces identical canonical outputs. Portfolio state, additional signals, alerts, notifications, risk decisions, order intents, broker access, execution, AI research, additional assets, extended hours, backtesting, optimization, and performance claims remain excluded.
