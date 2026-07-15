# P5-05: Process Durable Signal Alerts

## User Story

As an operator, I want eligible signal transitions processed durably into alerts so that retry, restart, corrections, and portfolio degradation cannot lose work or create duplicate dashboard alerts.

## Acceptance Criteria

- A dedicated `workers/alerts` process uses a provider/persistence-independent `@daily-trader/alerts` package and consumes Phase 3 through an application-owned PostgreSQL read contract. It never treats Alpaca, Redis, the dashboard, or in-memory delivery as the alert-work authority and is not colocated with the signal, portfolio, API, or web process.
- The Phase 3 read contract returns its durable completed source cursor and zero-or-more complete transitions per canonical source ordinal. Processing is disabled by default. Enabled local mode consumes only ordinals inside ADR 0015's captured interval, records `no_signal_transition` for a legitimately empty completed ordinal, waits beyond the upstream cursor, and advances only with all persisted effects/no-alert results for that ordinal.
- The processor handles initial fire, supersession, retraction, reactivation, repeated corrections, no-alert lineages, duplicate transitions, inverted completion attempts, and retrospective corrections under the complete ADR 0015 table without creating misleading fresh alerts.
- At first durable receipt of an eligible alert source, the processor freezes ADR 0016's terminal current-pointer selection and target-local context claim before composition and never reselects it on retry or correction. A failed latest attempt remains separate from selected membership, retains a safe failure classification, and maps reconciliation to unavailable. Missing, stale, failed, incomplete, unsupported, or unavailable context never blocks an eligible alert, and Alpaca is never contacted.
- Exactly one database-backed owner processes each live target/run. Acquire, renew, expiry, and reclaim use the database clock and a monotonically increasing fence token; every context/effect/cursor/status transaction validates owner, current fence, and unexpired lease at commit. Lease loss rolls work back and stops the worker, stale-owner commits are rejected after pause or reclaim, and replay ownership remains separately fenced in its named target. Batching, concurrency, capacity, retry with bounded jitter, database outage, cursor gaps, and shutdown are explicit and observable. Capacity or durability failure stops safely rather than dropping work or acknowledging an uncommitted effect.
- Metrics and status report bounded processing outcomes, backlog, age, retry, correction, context classification, and canonical-commit-to-dashboard-readable clock boundaries without symbol-cardinality growth, alert evidence, portfolio values, account identifiers, or credentials.
- The processing budget supports the accepted five-second local objective under documented healthy conditions. Latency metadata is operational evidence and never changes alert identity or evaluation outcome.
- Root `dev:alerts`, `start:alerts`, and `alert:status` commands are added with the worker. Live status selects only the explicit live target/run and reports cutover, cursor, upstream completion, backlog, health, and safe failure state; replay inspection remains explicit and separate. README and AGENTS are updated in the implementation change, not in advance with nonexistent commands.

## Validation

- Integration-test atomic enable/disable/handoff, pre-start upstream backlog, captured debt, disabled gaps, upstream ordinals with zero/one/many transitions, incomplete upstream ordinals, initial processing, no-op input, duplicates, every correction-table row, every context dimension, durable context selection, atomic cursor/effect behavior, database-clock lease acquire/renew/expiry/reclaim, monotonic fencing, stale-owner rejection at every write boundary, replay/live ownership isolation, crash before and after each commit, restart, concurrency, backlog, genuine gaps, capacity failure, retry exhaustion, lease loss, database outage/recovery, commands/status, bounded shutdown, and safe metrics.
- Prove the processor has no market-data provider, paper-broker HTTP, external notification, risk, order-intent, approval, execution, or AI dependency.

## Dependencies

- P5-02 safe local alert configuration.
- P5-03 deterministic alert composition.
- P5-04 append-only alert persistence.

## Out of Scope

Do not create a public API, render the dashboard, call a provider, evaluate risk, or submit an order.
