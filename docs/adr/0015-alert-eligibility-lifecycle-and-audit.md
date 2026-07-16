# ADR 0015: Alert Eligibility, Lifecycle, and Audit

- Status: Accepted
- Date: 2026-07-15
- Implementation status: Planned; no alert runtime exists yet

## Context

Phase 3 persists deterministic `breakout_plus_volume.v1` evaluations, occurrences, evidence, and correction transitions, but it intentionally does not create alerts. The local read-only alert MVP needs a stable meaning for opening an alert, reacting to corrected canonical market data, recording user disposition, and replaying equivalent input without duplicate or rewritten history. It also needs an exact activation boundary so enabling alerts cannot turn an existing signal backlog into misleading fresh alerts.

## Decision

An alert is an application-owned observation derived from one eligible Phase 3 signal-occurrence lineage. It is not an investment recommendation, portfolio-risk decision, position action, order intent, approval, or execution request.

### Eligibility

Only the first current, on-time fired `breakout_plus_volume.v1` occurrence for AAPL/XNAS or SPY/ARCX may open a new MVP alert, and only when its triggering canonical source position is inside an active live-alert capture interval. The persisted Phase 3 result is authoritative: alerting does not recalculate freshness, gaps, prices, features, or signal outcome.

Market data already classified stale, gapped, invalid, or suppressed by the accepted signal policy cannot open a new alert. A retrospective fire, a correction to a lineage that never opened a live alert, a replay transition, and a transition outside the capture interval also cannot open one. Portfolio state never participates in alert eligibility.

The global `alertLineageId` is deterministic over the alert semantic/schema version, signal definition version and configuration hash, instrument and venue, and evaluation-bar boundary. It excludes signal-run identity, alert-run identity, capture interval, source occurrence/revision identity, wall-clock time, portfolio context, database identity, and user disposition. Corrections under the same definition/configuration/instrument/bar key share one lineage even across compatible run handoffs; a changed signal configuration creates a distinct lineage.

Each immutable `alertRevisionId` binds that lineage to the source evaluation/occurrence content and captured correction outcome. Global lineage and revision content may be reused by equivalent replay. A target-local `alertInstanceId` binds one live installation or named replay target to the lineage, its first run association, and its immutable ADR 0016 context claim. Run associations, current projections, and disposition history belong to that target. The live API addresses the target-local instance, so equivalent global signal truth can carry different frozen context in isolated targets without a uniqueness collision.

### Live Activation and Cutover

Alert processing defaults to disabled. Enablement accepts only one compatible `live_journal` signal capture for the fixed definition, instruments, sessions, and contract versions. A pending, closing, failed, replay, missing, or incompatible signal source fails closed.

Activation uses the same fixed control-lock order as the signal handoff in ADR 0010, or an equivalently proven shared transaction boundary. It atomically creates one alert run, binds the source signal/configuration identities, installs one capture owner, and records `start_after_source_position` as the highest canonical revision position committed at the boundary. A concurrent canonical commit is wholly before or after that watermark. Eligibility uses the transition's canonical `source_ordinal`, not its later signal-processing or alert-processing time, so an upstream backlog owned before activation can never become fresh alert work.

Each live target/run has exactly one database-backed processing owner. Acquire, renew, expiry, and reclaim use the database clock under the accepted control-lock order and issue a monotonically increasing fence token. Every context-claim, source-disposition, alert-effect, cursor, and worker-status transaction predicates its writes on the live target/run, owner identity, current fence token, and an unexpired lease at database time. Lease loss or failed renewal rolls the work transaction back and stops that owner; a paused or reclaimed stale owner cannot commit. Replay ownership is fenced independently in its named target namespace and can never acquire or mutate the live owner.

The Phase 3 read contract exposes its durable completed source cursor and zero or more complete signal transitions for each canonical source ordinal. The alert consumer advances a scalar source cursor only after Phase 3 proves that ordinal complete; it processes that ordinal's transitions in `transition_ordinal` order. A legitimately empty ordinal records an audited `no_signal_transition` result, while an ordinal beyond the Phase 3 cursor remains pending rather than being misclassified as a gap. Invalid transition ordinals or a completed source position that changes later fail safely.

The alert cursor advances only with all effects for the completed source ordinal or explicit audited no-alert dispositions. Captured source work remains debt through retry, worker restart, dashboard outage, or a latency-objective breach; it is never discarded or relabeled merely because processing was delayed.

Restart with the same configuration resumes the same run and cursor. Disablement atomically freezes `stop_at_source_position`, removes capture ownership, and lets the closing run drain only through that finite watermark. Source positions after the stop accrue no alert debt. Re-enablement after a gap always creates a new run and start watermark; it neither scans nor seeds the disabled interval.

A signal configuration rollover while alerts remain enabled freezes the prior alert run at the shared signal handoff watermark and creates a compatible pending replacement that begins strictly after it. The prior run drains first. No source position belongs to both runs or to neither run. If compatibility cannot be proved, alert capture stops safely.

A correction captured after a start watermark may update a previously alerted lineage, including a lineage opened by an earlier alert run. A captured correction for a pre-cutover, disabled-interval, replay-only, or retrospective lineage with no alert records an audited no-alert result and never synthesizes a new alert. Live status and the dashboard disclose disabled intervals and do not claim alert coverage across them. Replay uses a separate source namespace, target, cursor, status, and projection and can never mutate the live feed or live user actions.

### Revision Validity and Lineage Projection

An alert lineage contains immutable revisions. System validity applies to a revision and is exactly `active`, `superseded`, or `retracted`:

- `active` means the revision represents the latest captured fired result for the lineage.
- `superseded` means a later captured fired revision replaced it.
- `retracted` means a later captured result is non-fired or suppressed.

The current lineage projection points to the latest captured truth. It reports `active` when the latest captured correction fires and `retracted` when it does not. `superseded` remains visible on historical revisions; it is not ambiguous shorthand for the validity of an entire lineage that has an active successor.

| Durable source condition                                                | Append-only effect                                                                         | Current lineage projection            | User disposition |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------- |
| First eligible on-time fire inside capture                              | Create one lineage and one `active` revision                                               | `active`                              | Initialize `new` |
| On-time non-fire or suppressed result with no alert                     | Record an audited no-alert source disposition                                              | No alert                              | None             |
| Retrospective fire or fired correction for a lineage with no live alert | Record an audited no-alert source disposition                                              | No alert                              | None             |
| Fired correction of an `active` lineage                                 | Append an `active` successor and mark the predecessor `superseded` in the derived history  | `active` successor                    | Preserve         |
| Non-fired or suppressed correction of an `active` lineage               | Append correction and retraction evidence                                                  | `retracted`                           | Preserve         |
| Fired correction of a `retracted` lineage                               | Append an `active` successor; retain the earlier retraction                                | `active` successor; not a fresh alert | Preserve         |
| Further non-fired or suppressed correction of a `retracted` lineage     | Append changed correction evidence, or an audited no-op when the alert effect is identical | `retracted`                           | Preserve         |
| Completed source ordinal with zero transitions                          | Record `no_signal_transition` and advance once                                             | Unchanged                             | Unchanged        |
| Duplicate source transition or exact command retry                      | Return the already persisted effect; append nothing                                        | Unchanged                             | Unchanged        |
| Source outside capture or from replay                                   | Create no live alert debt or live effect                                                   | Unchanged                             | Unchanged        |

No correction deletes or overwrites evidence, resets user disposition, or creates a second fresh alert for the same lineage. Equivalent ordered input converges on the same current lineage even when different valid correction arrival orders retain different append-only intermediate histories.

### User Disposition

User disposition is orthogonal to revision validity and is exactly `new`, `acknowledged`, or `dismissed`. The only desired-state changes are `new` to `acknowledged` or `dismissed`, and `acknowledged` to `dismissed` or `dismissed` to `acknowledged`. There is no command back to `new`. Repeating the already-current desired state is a successful no-op, and corrections never change the disposition or its version.

Each disposition command carries a client command ID and expected disposition version. An exact retry returns the immutable recorded outcome plus the separately read latest projection; reuse of the command ID with different input is rejected. Concurrent commands from the same expected version serialize so one may succeed and the stale command conflicts with the current projection. These are local review-state changes, not human identity, approval, or broker authority.

### Audit and Persistence

Alert lineages, revisions, ordered evidence, source dispositions, revision-validity transitions, user-disposition commands/results, and run associations are append-only. A current alert feed is a deterministic projection over that history. Historical records are never updated or deleted through application roles.

The alert retains source signal versions, event and knowledge timestamps, observation and threshold evidence, data-quality classification, reason, correction relationship, creation and processing timestamps, and the immutable portfolio-context reference defined by ADR 0016. Wall-clock processing time is operational evidence, not an alert identity input.

## Consequences

Enabling alerts does not backfill prior signal history, but every source position captured while enabled remains recoverable work. Operators can distinguish the latest system truth from historical revisions and from what they have locally reviewed. A correction chain can retract and later reactivate an existing lineage without manufacturing a new notification.

The implementation requires versioned alert contracts, append-only persistence, deterministic identity and serialization, an atomically cut over and commit-time-fenced signal-transition consumer, current projections, and correction-aware UI language. Additional signal types, configurable rules, risk alerts, recommendations, or executable actions require follow-up scope and semantic decisions.
