# MVP-01: Local Read-Only Portfolio Alerts

- Scope status: Accepted
- Delivery status: Planned; no Phase 5 implementation exists yet
- Story range: P5-01 through P5-09

## User Outcome

As the owner of one Alpaca paper account, I want explainable AAPL and SPY market alerts in my local portfolio dashboard so that I can notice and review the existing deterministic breakout-plus-volume observation without granting the application trading authority.

## Scope

MVP-01 adds one local alert slice on top of the implemented Phase 3 signal and Phase 4 portfolio foundations:

- fixed AAPL/XNAS and SPY/ARCX regular-session inputs;
- `breakout_plus_volume.v1` only;
- dashboard-only delivery on loopback interfaces with no login;
- alerts for held and not-held instruments;
- immutable creation-time portfolio context that never gates alert eligibility;
- orthogonal revision validity, current lineage projection, and user disposition;
- append-only evidence, correction, acknowledgement, and dismissal history;
- an atomic no-backfill activation watermark and durable captured-work semantics;
- deterministic replay, restart, idempotency, and a five-second local responsiveness objective; and
- at least 100 eligible latency samples and three distinct complete regular core sessions of local operational evidence.

## Workstreams

1. **Truth and audit:** P5-01 through P5-05 define contracts, configuration, composition, persistence, durable processing, corrections, and portfolio context.
2. **Local experience:** P5-06 and P5-07 add the bounded local feed, detail, acknowledge/dismiss boundary, and minimal dashboard experience.
3. **Proof and handoff:** P5-08 and P5-09 prove replay, restart, observability, latency, degraded-data behavior, and the final MVP exit.

## Dependencies

- P3-09 is complete and supplies deterministic signal evidence and correction transitions.
- P4-01 through P4-10 are implemented and supply complete portfolio cycles, projections, reconciliation, and the local dashboard foundation.
- P4-11 must pass before P5-01 implementation begins. Planning approval and merge do not substitute for that provider evidence.

## Epic Exit

MVP-01 exits only when P5-01 through P5-09 have completed implementation notes, P4-11 is closed, the credential-free Phase 5 matrix passes, at least 100 eligible samples satisfy the accepted latency method, and three distinct complete regular-market sessions satisfy ADR 0016's operating criteria.

## Non-Goals

MVP-01 does not add configurable symbols, watchlists, additional signals, external notifications, snooze, escalation, charts, rule editing, portfolio-risk decisions, recommendations, order intents, approvals, broker mutations, execution, hosted access, authentication, AI research, or profitability claims.

The complete product contract is [`docs/planning/mvp-local-read-only-alerts.md`](../../docs/planning/mvp-local-read-only-alerts.md).
