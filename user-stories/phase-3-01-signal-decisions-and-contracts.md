# P3-01: Define Signal Decisions and Contracts

## User Story

As a platform developer, I want exact, versioned feature and signal contracts so that the first signal has one reproducible meaning across live processing, storage, explanation, and replay.

## Acceptance Criteria

- Accepted ADRs select the decimal arithmetic implementation, supported precision and scale, overflow behavior, canonical result conversion, and operation-specific rounding before exact-decimal signal calculations are added, as required by ADR 0002. The dependency's maintenance, license, and security posture are reviewed before adoption.
- After an atomic live-run cutover, the accepted design records every committed canonical-bar change in a durable PostgreSQL revision journal and lets the signal worker advance a durable per-run cursor. The initial two-symbol design intentionally serializes revision-producing AAPL/SPY canonical commits through one application-owned transactional counter lock held until commit; its latency tradeoff is recorded and measured. A normal PostgreSQL identity/sequence is not treated as contiguous commit order. Redis may be an optional wake-up optimization, but publication alone cannot be the authority for required signal work.
- A canonical revision identifies the logical bar, previous and new canonical event IDs, deterministic revision ID, commit-ordered processing position, schema version, and mutually exclusive `insert` or `replace` operation. Separate arrival/gap metadata records whether an insert was historical, out of order, or filled a known gap. The revision ID is derived from immutable revision content; the processing position orders work but is not part of a global feature or evaluation identity. Duplicates, losing replacements, and noncanonical events create no revision.
- Application boundaries are explicit: `@daily-trader/market-data` owns the provider-neutral canonical-revision and transition-decision contract because its repository produces revisions; a provider- and persistence-independent `packages/signals/` package consumes that contract through a signal-owned port and owns pure feature/signal behavior; a dedicated `workers/signals/` process later owns runtime orchestration. P3-01 adds `@daily-trader/signals` to root build/typecheck/test ownership and updates package/repository documentation. No market-data package depends on signals, and no signal consumes a raw provider frame, uncommitted Redis entry, or noncanonical candidate.
- One versioned `breakout_plus_volume` definition uses one shared prior lookback window for both price-range and volume evidence. It specifies the evaluated price field, current-bar exclusion, exact comparison inclusivity, configurable volume multiplier, session reset, warm-up, explanatory invalidation condition, and canonical-revision behavior.
- Reference windows contain only prior contiguous bars from the same known NYSE core session. Cross-session, extended-hours, split-adjusted, dividend-adjusted, and unknown-calendar calculations fail closed because Phase 3 has no corporate-action feed.
- Application-owned schemas define an immutable feature result (`ready` snapshot or `suppressed` reason), global signal evaluation and occurrence content, role-ordered evidence references, canonical observation-as-of and knowledge-as-of values, on-time or retrospective mode, and canonical serialization without provider SDK or persistence types. A separate run-scoped transition contract owns triggering revision, predecessor, supersession, retraction, and latest-revision state because different ordered runs may share a global evaluation but have different histories.
- One named Phase 3 semantic identity set is used throughout later stories: market-event schema, canonical-revision contract, arithmetic policy, calendar snapshot, effective Phase 2 freshness threshold/data-quality policy, feature-result schema, evaluation/occurrence schema, signal definition version, and effective configuration/hash. Deterministic identities additionally bind instrument, evaluation bar, observation-as-of and knowledge-as-of values, and ordered current evidence while excluding transition-order provenance plus operational persistence and worker-processing timestamps.
- Every historical recomputation is evaluated as of its evaluation bar and excludes that bar plus all later bars from its reference window. A historical insert or winning canonical replacement may append a retrospective result, but it cannot masquerade as a newly observed on-time occurrence.
- Outcomes distinguish at least `fired`, `not_fired`, and explicit data-quality suppression. An invalidation condition is explanatory evidence only in Phase 3; later bars do not create an active-position lifecycle. A signal occurrence is an observation, never a recommendation, portfolio action, alert, or order intent.

## Validation

- Unit-test schema construction, canonical serialization, stable identities, version rejection, evidence roles and ordering, observation/knowledge context, invalid exact values, revision insert/replace and arrival metadata, and every outcome or supersession state. Build, type-check, and test the new package through root commands.
- Review the accepted decisions against ADRs 0002, 0003, 0005, 0006, 0007, and 0008 plus the fast-path, numeric, and audit requirements in `AGENTS.md`.

## Dependencies

- Completed P2-11 exit, including integrated Redis/TimescaleDB verification and observed normalized provider bars for both AAPL and SPY.

## Out of Scope

Do not implement rolling feature state, rule evaluation, persistence, presentation, additional signal types, portfolio behavior, alerts, broker access, or execution in this story.
