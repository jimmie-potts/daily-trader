# P3-08: Display Signal Explanation and Health

## User Story

As an operator, I want concise terminal signal status so that I can distinguish a fired observation from a non-fire, suppression, correction, or unhealthy processing path.

## Acceptance Criteria

- Default terminal output selects one explicit live signal run—pending, active, or closing when present, otherwise the most recent completed or failed live run with its end state—and never mixes fixture or replay history into live status. A separate explicit replay-inspection mode is unmistakably labeled `REPLAY` and selects one named replay target. Either mode shows only that run's latest persisted evaluation revision for AAPL and SPY and, when one exists, its latest non-superseded and non-retracted historical fired occurrence. Every occurrence is labeled with its observation/knowledge-as-of context and is never described as an active recommendation or position state.
- Ready results include definition and configuration identities, outcome, evaluation bar, observation/knowledge-as-of context, on-time or retrospective mode, exact close and breakout references, exact volume sum/count/multiplier evidence, shared-window bounds, and source/feed/entitlement. Direction and explanatory invalidation condition appear only for a fired occurrence; suppressed or missing rows show only fields that actually exist and never fabricate comparison evidence.
- Superseded and retracted occurrences remain inspectable but cannot be presented as the latest valid historical revision. Missing, warming-up, gapped, future-as-of, retrospective, zero-baseline, unsupported-version, outside-session, unknown-calendar, stale-worker, and unavailable states are explicit and never collapsed into `not_fired`.
- The display labels IEX price and volume as single-exchange evidence and labels every signal as an observation, not a recommendation or position action.
- Overall status reports signal-worker lifecycle and run state, last durably evaluated bar, revision-journal health, backlog/cursor lag or sequence-gap state, PostgreSQL persistence, worker processing lag, and every semantic version required by P3-01. Market-data freshness, signal input eligibility, and worker processing health remain separate.
- Output reads canonical persisted projections, uses an injected clock, and contains no credential, raw payload, account identifier, internal event ID, unbounded evidence list, recommendation, alert control, or trading control.

## Validation

- Snapshot or assertion-test fired up/down, not-fired, every suppression state, warm-up, supersession, retraction, historical-only occurrence, no-data, partial AAPL/SPY, outside/unknown session, stale worker, retrospective recomputation, revision backlog/gap, database outage, restart, and deterministic rendering with a fixed clock.
- Run explicitly labeled replay inspection against both clean synthetic signal replays and the restart replay; separately test default live status against active, closing, completed, and failed synthetic `live_journal` runs. A naturally occurring provider breakout is not required.

## Dependencies

- P3-05 durable evaluation and latest-revision queries.
- P3-06 signal worker lifecycle and handoff health.
- P3-07 verified synthetic signal replay.

## Out of Scope

No web dashboard, chart, alert, notification, recommendation, portfolio context, order intent, approval, broker operation, or execution control is added.
