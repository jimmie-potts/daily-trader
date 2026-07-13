# ADR 0011: First Signal Semantics

- Status: Accepted
- Date: 2026-07-12

## Context

The first signal must have one deterministic meaning across feature computation, evaluation, persistence, explanation, correction handling, and replay. Ambiguous window membership, equality, freshness, or identity rules could otherwise change an observation without changing its declared version.

Phase 3 remains monitoring-only. A signal occurrence is evidence that a deterministic condition held for a canonical bar; it is not an investment recommendation, alert, portfolio action, risk decision, order intent, or execution request.

## Decision

Adopt `breakout_plus_volume.v1` with one configured lookback from 1 through 390 prior one-minute bars and one exact multiplier from 1 through 10 inclusive.

For an evaluation bar:

- The reference window contains exactly the configured number of immediately preceding, contiguous canonical bars for the same instrument and known NYSE core session. The evaluation bar and every later bar are excluded. Windows never cross an exchange-session boundary or use extended-hours, holiday, unknown-calendar, split-adjusted, dividend-adjusted, interpolated, or zero-filled data.
- The prior price range is the greatest prior high and least prior low. An upward breakout requires `evaluation close > prior high`; a downward breakout requires `evaluation close < prior low`. Equality is not a breakout.
- Volume is confirmed when `evaluation volume * prior count >= prior volume sum * configured multiplier`. Equality confirms. No average or intermediate rounding is computed.
- Insufficient warm-up, a missing expected interval, an evaluation bar ending after its recorded observation time, a zero volume baseline, or arithmetic overflow produces an explicit suppressed result. An outside-session or unknown-calendar canonical input is an invariant failure because Phase 2 must not make it canonical.
- `observationAsOf` is the evaluation event's immutable `receivedAt`. `knowledgeAsOf` is the greatest immutable `receivedAt` among the evaluation event and its current reference evidence. The result is `on_time` only when the evaluation bar meets the effective Phase 2 freshness threshold and every reference event was known by `observationAsOf`; otherwise it is `retrospective`.
- A retrospective fired result remains historical analysis and cannot be presented as newly observed on time. Worker processing time, journal position, run cursor, and delivery order do not change global feature, evaluation, or occurrence identity.

Every feature result is either a ready snapshot or a suppressed reason. Every evaluation is `fired`, `not_fired`, or `suppressed`. A fired occurrence records its direction, exact price and volume evidence, comparison operands, source entitlement, units, observation/knowledge context, ordered evidence, effective semantic versions, deterministic reason, and an explanatory condition for returning inside the prior range. That invalidation condition does not create a position lifecycle and is not evaluated continuously in Phase 3.

Global deterministic identities bind the market-event schema, canonical-revision schema, arithmetic policy, calendar snapshot, effective freshness/data-quality policy, feature/evaluation schemas, definition version, effective configuration hash, instrument, evaluation bar, observation and knowledge values, and ordered current evidence. Commit position, triggering revision, worker time, persistence timestamps, and run ID are excluded from global identities.

Run-scoped transition identity separately binds run ID, triggering revision, processing position, predecessor, current evaluation, supersession, and retraction state. A changed current canonical projection produces a distinct evaluation identity even when the outcome text is unchanged. A prior fired occurrence followed by a non-fired or suppressed evaluation is a retraction; persistence and orchestration are deferred to later Phase 3 stories.

## Consequences

Live processing and replay converge on the same feature and signal results for the same canonical projection and configuration. Historical inserts and winning replacements can append retrospective results without masquerading as new on-time events. Missing or unusable evidence remains visible rather than being silently substituted.

The rule intentionally says nothing about profitability, risk, portfolio suitability, alerting, or execution. Additional signals, corporate-action adjustment, consolidated-feed claims, active-position state, and strategy optimization require separately versioned semantics.
