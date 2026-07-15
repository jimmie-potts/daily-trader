# Post-MVP Roadmap

- Status: Directional; not implementation-authorized
- Prerequisite: Completed local read-only portfolio-alert MVP
- Last updated: 2026-07-15

This roadmap defines the intended sequence after the MVP without pretending that later architecture or acceptance criteria are complete. Each phase requires explicit authorization, accepted ADRs, dependency-ordered stories, and a measurable exit before implementation.

## Phase 6: Monitoring Usability and Breadth

### Outcome

Make the proven read-only monitoring experience useful across a configurable personal universe without introducing risk decisions or execution.

### Candidate Scope

- Configurable watchlists and approved US-equity or ETF symbols.
- Dashboard filters, richer bounded history, and usability improvements.
- One explicitly selected external notification channel.
- Snooze and escalation states.
- Measured alert-latency improvements below the MVP's five-second objective.
- Calendar-snapshot extension and an explicit process for keeping coverage current.

### Boundary

No new opaque strategy, portfolio-risk approval, order intent, broker mutation, or execution is authorized by this roadmap entry.

## Phase 7: Evaluation and Portfolio Intelligence

### Outcome

Measure whether transparent signals and portfolio-risk observations are reliable enough to inform later decision workflows.

### Candidate Scope

- Historical replay through production signal and alert interfaces.
- Spread, fee, slippage, partial-fill, and rejection models where evaluation requires them.
- Look-ahead and survivorship-bias controls, out-of-sample evaluation, and walk-forward comparison.
- Alert precision, false-positive, timeliness, data-gap, and operator-intervention metrics.
- Additional deterministic signal definitions under separately versioned semantics.
- Concentration, drawdown, exposure, and other deterministic portfolio-risk alerts.

### Boundary

Observations remain non-executable. This phase does not create an `OrderIntent`, approve a trade, or contact a broker mutation endpoint.

## Phase 8: Decision Workflow

### Outcome

Let the user prepare and review a proposed action without giving the application broker-write capability.

### Candidate Scope

- A versioned, non-executable `OrderIntent` contract.
- Human review, approval, rejection, expiration, and cancellation states.
- Immutable decision history tied to signal, portfolio, market-data, and risk evidence.
- Deterministic preapproval risk evaluation and clear invalidation conditions.

### Boundary

Execution remains disabled. Approval records user intent but cannot submit, replace, cancel, or close a broker order or position.

## Phase 9: Paper Execution

### Outcome

Submit only explicitly approved and freshly revalidated intents to the paper broker under independent deterministic safety controls.

### Candidate Scope

- Global kill switch and bounded order, position, concentration, liquidity, spread, daily-loss, and open-order limits.
- Final market freshness, session, account-reconciliation, approval, and expiration checks.
- Idempotent paper submission with persisted attempts and responses.
- Unknown-outcome reconciliation before retry.
- Order, partial-fill, rejection, cancellation, and reconciliation handling.

### Boundary

This phase requires separately accepted execution ADRs and explicit user authorization. It does not authorize live credentials or live endpoints.

## Phase 10: Hardening and Shadow Operation

### Outcome

Demonstrate safe continuous behavior and operational recovery before any live-capital decision.

### Candidate Scope

- Extended paper and shadow operation with defined evidence windows.
- Failure injection for provider outages, disconnects, stale data, duplicates, timeouts, and uncertain broker state.
- Operational dashboards, alerts, runbooks, recovery objectives, and incident exercises.
- Security, dependency, secret-handling, and independent risk-control review.

## Phase 11: Controlled Live Rollout

### Outcome

Consider a narrow human-approved live rollout only after measured evidence supports a separate authorization decision.

### Boundary

This roadmap does not authorize Phase 11. Any live rollout requires a new explicit decision, separate credentials and endpoints, minimal capital, narrow permissions, hard limits, human approval, immediate rollback, and staged expansion based on measured evidence.

## Planning Gate for Every Post-MVP Phase

Before implementation begins, the selected phase must have:

1. an explicitly accepted product outcome and scope boundary;
2. accepted ADRs for consequential semantics and safety choices;
3. dependency-ordered user stories with risk-proportional validation;
4. credential, data, operational, and security prerequisites;
5. a measurable phase exit; and
6. explicit confirmation that later phases remain unauthorized.
