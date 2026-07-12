# P3-06: Process Committed Canonical Bars Reliably

## User Story

As an operator, I want a recoverable signal worker that processes committed canonical-bar changes so that restarts and at-least-once delivery cannot lose or duplicate signal results.

## Acceptance Criteria

- A dedicated `workers/signals/` process owns feature and signal orchestration behind application-owned ports. Root build, typecheck, test, dev, start, smoke, and verification commands plus `README.md` and `AGENTS.md` are updated when the worker exists. It opens no market-data provider, brokerage, alert, AI, or execution connection.
- The worker claims the durable PostgreSQL canonical-revision journal by its accepted commit-ordered position and advances a per-run cursor only through the highest contiguously visible committed revision. Cursor advancement occurs in the same transaction that persists and associates every required feature result, evaluation, occurrence, supersession, or retraction; parallel work cannot skip a position or pass an in-flight predecessor. Redis is not a second durability boundary for this slice.
- While monitoring is disabled, the Phase 2 ledger remains the audit authority and no signal-run revision debt accrues. Initial enablement first proves every active market-data writer supports the accepted revision contract, then acquires the existing AAPL and SPY series locks in one fixed order plus the global revision-counter lock. Under that boundary it atomically creates one active live run, activates capture at a consistent watermark, stores the bounded same-session warm-up events, and records the first eligible evaluation bar per instrument. Pre-cutover bars are evidence only and receive no historical evaluations; bars committed after the watermark remain in the journal.
- Restart with the same configuration resumes the same durable run and cursor. A configuration change uses the same fixed-order series/counter lock boundary to freeze the prior run's stop watermark, capture the replacement's consistent warm-up/evaluation boundaries, create that pending run starting immediately after the watermark, and atomically switch capture ownership to it. The closing run drains its finite backlog first; later revisions accumulate only for the replacement and cannot be processed under the old configuration. After the prior run closes, the replacement becomes active and resumes from its stored bootstrap/cursor.
- Disabling monitoring uses the same lock boundary to freeze the active run's stop watermark and deactivate capture atomically before releasing the locks. Canonical commits after that boundary accrue no signal debt; the closing run drains only through its finite frozen watermark. A crash resumes that closing run while capture remains inactive. Later re-enablement creates a fresh cutover/bootstrap/run and never resumes across the uncaptured interval.
- Work is serialized or transactionally locked per instrument and exchange session. Every canonical `insert` or `replace` is processed in journal order and recomputes the bounded affected evaluation bars in event time; separate metadata identifies historical, out-of-order, and known-gap inserts. Duplicates and losing replacements create no work.
- Retrospective recomputation updates feature state for every affected historical revision but creates replacement evaluations only for bars at or after that run's per-instrument eligibility boundary. It uses each owned evaluation bar's canonical observation/knowledge-as-of context, excludes all bars at or after that bar, and never falls back to a superseded canonical candidate; a later winning event becomes current evidence and makes the result retrospective when required. Pre-cutover bars remain evidence-only, and a retrospective fire remains historical rather than newly on-time.
- Feature state is reconstructed from the run's consistent warm-up snapshot plus its immutable revision history through the durable cursor. It never depends on current global canonical rows alone or on an in-memory window surviving restart.
- The canonical-revision journal is append-only for Phase 3; pruning or lossy checkpointing requires a later archival ADR. A genuine position gap or failed progress stops the affected run and leaves committed journal work recoverable. A hard admission/capacity failure before canonical+journal commit rolls back that full transaction so the Phase 2 Redis entry remains unacknowledged; after commit, the signal revision—not the original Redis entry—is the recovery authority. No failure may drop work or permit run completion.
- Claims, batches, retries, backoff, in-memory state, database statements, and shutdown follow the P3-02 bounds. Shutdown stops new claims, commits or rolls back in-flight work, and closes PostgreSQL, timers, and telemetry within one documented deadline.
- Metrics cover fixed signal version/outcome counts, fixed suppression reasons, feature/evaluation latency, revision backlog and age, cursor lag, retry, retrospective recomputation, capacity/failure state, and worker lifecycle without event IDs, session IDs, evidence payloads, or unbounded labels.

## Validation

- Integration-test writer-capability rejection, fixed-order cutover locks with concurrent canonical commits, pre-cutover warm-up-only and evaluation-boundary behavior, same-config resume, atomic capture ownership during configuration rollover, pending replacement backlog, frozen-watermark disable during backlog, commits after disable, crash during disable, re-enable after an uncaptured interval, revision claim/cursor atomicity, rollback allocation, inverted commit attempts, crash before and after evidence persistence, canonical inserts/replacements and their arrival/gap metadata, bounded fan-out, per-instrument concurrency, genuine journal gaps, precommit capacity failure, postcommit signal failure, database outage/recovery, restart reconstruction, backpressure, retry exhaustion, and bounded shutdown.
- Prove no signal evaluation can precede the canonical-bar commit, no cursor can advance before all required evidence and run links commit, and no run can close with missing or wrong-configuration revisions.

## Dependencies

- P3-03 deterministic and reconstructable feature windows.
- P3-04 pure signal evaluation.
- P3-05 durable signal evidence and transactional handoff schema.

## Out of Scope

Do not connect directly to Alpaca, introduce a second Redis signal stream, share the market-data persistence consumer group, add Kafka, fetch historical backfill, send alerts, access a portfolio, or perform broker operations.
