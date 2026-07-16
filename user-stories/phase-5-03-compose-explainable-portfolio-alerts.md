# P5-03: Compose Explainable Portfolio Alerts

## User Story

As a local investor, I want each eligible AAPL or SPY observation composed into one explainable alert with truthful portfolio context so that I can understand the market fact without mistaking context for a recommendation.

## Acceptance Criteria

- Pure deterministic alert composition accepts application-owned signal and portfolio inputs plus an injected clock. It performs no database, provider, Redis, HTTP, dashboard, notification, AI, order, or broker operation.
- Only an eligible on-time fired latest `breakout_plus_volume.v1` transition may compose a new alert. Stale, gapped, invalid, suppressed, non-fired, or purely retrospective input produces an explicit no-new-alert outcome.
- A correction for an existing alert lineage deterministically supersedes, retracts, or reactivates it under ADR 0015 even when the corrected evaluation is retrospective. A fired correction for a lineage with no live alert remains an explicit no-alert result. No correction creates a second `new` alert or erases prior evidence.
- The alert explanation includes instrument and venue, direction, observation and knowledge timestamps, exact observed values and thresholds, ordered source evidence, definition/configuration versions, data-quality state, concise reason, and invalidation or correction meaning.
- Composition accepts the already frozen target-local ADR 0016 context claim. It validates `contextSelectedAt`, separate signal observation/knowledge timestamps, terminal selection integrity, nonsecret content identities, knowledge interval, valuation authority, configuration/policy versions, freshness threshold, and exact limitation reasons without querying current portfolio state.
- Availability, freshness, selected reconciliation, latest-attempt lifecycle, latest-attempt reconciliation, calculation, membership, and support remain orthogonal. A failed latest attempt retains its safe failure classification, has reconciliation unavailable, and never supplies holdings. Missing, stale, failed, incomplete, unsupported, or unavailable portfolio state never suppresses an eligible market alert, and no missing quantity, price, value, allocation, or exposure is replaced with zero.
- Portfolio context supplies no suitability conclusion, risk score, recommendation, target quantity, side, price, order type, approval, or executable action.
- Equivalent source inputs produce byte-stable global lineage/revision content regardless of duplicate invocation or wall-clock scheduling; target-local instance/context identity remains an explicit separate input.

## Validation

- Unit-test fired, non-fired, suppressed, stale, gapped, invalid, retrospective, supersession, retraction, reactivation, repeated correction, no-alert correction, duplicate, held, not-held, unknown membership, stale/future freshness, selected convergence, latest-attempt failure with reconciliation unavailable, incomplete, unsupported, and unavailable context cases.
- Verify exact evidence, byte-stable serialization, injected-clock behavior, missing-value preservation, context immutability, and the absence of provider, persistence, risk, order, execution, AI, or notification dependencies.

## Dependencies

- P5-01 alert contracts and accepted decisions.
- P5-02 safe local alert configuration.

## Out of Scope

Do not persist or deliver alerts, calculate new portfolio projections, contact Alpaca, evaluate another signal, or recommend a trade.
