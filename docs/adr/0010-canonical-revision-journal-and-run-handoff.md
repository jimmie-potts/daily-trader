# ADR 0010: Canonical Revision Journal and Signal-Run Handoff

- Status: Accepted
- Date: 2026-07-12

## Context

Phase 3 signal processing must observe every committed canonical-bar change after monitoring is enabled, resume after failure, and reproduce the same ordered work without making Redis publication authoritative. PostgreSQL sequences allocate values before commit and can expose later values before an earlier transaction commits, so they do not by themselves provide a contiguous committed-work cursor. Configuration changes also need an atomic boundary that prevents one canonical change from being processed by both the old and replacement signal run, or by neither.

## Decision

`@daily-trader/market-data` owns provider- and persistence-neutral schema `daily-trader.market-data.canonical-revision.v1`. A revision identifies the logical one-minute bar, distinct previous and new canonical event IDs where applicable, the market-event schema, immutable arrival metadata (`accepted`, `correction`, or `out_of_order` plus historical and derived out-of-order flags), immutable gap metadata (`complete`, `gapped`, or `unknown` plus the known-gap-fill flag), and exactly one `insert` or `replace` operation. An insert has a null previous event. A replacement has distinct previous and new events. Duplicates, losing replacements, and noncanonical candidates are explicit no-op decisions: they allocate no revision position and create no journal work.

The same package owns one pure, position-free canonical transition decider. Given an eligibility decision, the current canonical event, and a candidate for the same logical bar, it selects replacement precedence by the exact `(receivedAt, eventId)` tuple from ADR 0008. Live persistence and replay use that shared decision rather than independently reimplementing precedence.

The revision ID is the lowercase SHA-256 digest of fixed-order canonical content containing the revision schema, operation, logical bar key, previous and new event IDs, market-event schema, and arrival/gap metadata. The commit-order processing position, run ownership, database timestamps, worker timestamps, and transport metadata are excluded. Positions use positive PostgreSQL `BIGINT` values and cross the application boundary as canonical decimal text, never as JavaScript `number`.

PostgreSQL owns an append-only revision journal and each signal run's durable cursor. While one live run owns capture, a transaction that changes canonical state also locks one application-owned revision-counter row, updates the canonical bar, allocates the next position, and appends the run-owned revision before commit. The counter lock is held through commit. Journal failure rolls back the canonical change, ledger work, and position allocation; Redis acknowledgement therefore remains impossible until the complete PostgreSQL transaction succeeds. A normal identity or sequence is not used as evidence of contiguous commit order. Redis may wake the worker, but journal polling and the durable cursor determine required work.

The initial AAPL/SPY scope deliberately serializes revision-producing canonical commits through that counter. Monitoring enablement acquires both market-series locks in fixed order and then the counter lock. In the same transaction it proves writer compatibility, captures bounded warm-up state and per-instrument eligibility boundaries, records a consistent watermark, and installs one live capture owner. Writer compatibility binds the revision contract, effective freshness threshold, and data-quality policy used by the signal run. Earlier canonical bars are evidence only and create no revision debt.

Each paper persistence process registers and renews a bounded capability under its own ingestion-session identity. During active capture it declares that current persistence-writer identity transaction-locally; PostgreSQL and the repository both require its capability to be fresh and compatible with the captured run before a canonical change can commit. The current persistence writer is distinct from the producer session carried by a Redis entry: a fresh replacement process may drain a pending entry from an expired producer session, while the expired process itself is fenced from canonical commits.

The capability is checked both before the canonical write and by a deferred commit-time constraint. If its lease expires while the transaction is waiting for the revision-counter lock or before commit, the ledger, canonical row, counter allocation, and journal insert roll back together.

Configuration rollover uses the same lock order. It freezes the old run's stop watermark, captures the replacement run's bootstrap and start watermark, and atomically transfers capture ownership so the next position belongs only to the replacement. The old run first drains its finite owned backlog; the replacement remains pending until that handoff is complete. Disabling monitoring freezes the current run's stop watermark and removes capture ownership atomically. Canonical commits outside an owned capture interval remain in the Phase 2 ledger but create no later signal-run debt.

A signal worker processes its run's revisions in position order and advances that run's cursor only in the same PostgreSQL transaction that durably records all required feature, evaluation, occurrence, and transition results. Before a market-data writer allocates another owned revision, it checks the active run's persisted backlog limit under the revision-counter/capture lock. Reaching that limit fails and rolls back the ledger, canonical change, counter, and journal together. A missing expected position, wrong run owner, unsupported schema, capacity breach, or transaction failure stops advancement and surfaces an operational failure. Restart resumes from the durable cursor without substituting Redis delivery state or ambient configuration.

## Consequences

Required signal work has one durable authority and an atomic configuration handoff. Revision identity remains stable when the same logical transition appears at another journal position, while run-local order remains auditable. The global counter introduces intentional commit serialization across AAPL and SPY; implementations must measure counter-lock wait, transaction duration, journal backlog, and cursor lag before broadening scope.

The market-data package defines the handoff contract but does not depend on signal behavior or persistence types. Signal consumers receive only committed canonical revisions, never provider frames, uncommitted Redis entries, losing candidates, or mutable canonical rows. Additional instruments or throughput-driven partitioning require a measured design and a follow-up ADR that preserves gap-free run ownership and restart semantics.
