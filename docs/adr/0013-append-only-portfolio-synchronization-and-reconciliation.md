# ADR 0013: Append-Only Portfolio Synchronization and Reconciliation

- Status: Accepted
- Date: 2026-07-13

## Context

Read-only provider calls still need durable, restart-safe, auditable synchronization. Updating a few current rows in place would lose what the broker reported, make partial cycles indistinguishable from complete ones, and leave reconciliation without evidence. Phase 4 has no locally originated orders or independent accounting ledger from which to reconstruct cash and positions.

## Decision

PostgreSQL owns append-only portfolio synchronization cycles and normalized observation revisions for the account, positions, observed broker orders, and fills. Each externally sourced observation retains its schema version, provider, paper environment, account fingerprint, provider source identifier, provider as-of value when supplied, local receipt time, canonical normalized content, and deterministic content identity. Complete raw broker payloads and raw account identifiers are not persisted.

A cycle is created as `pending` and becomes exactly one of `completed` or `failed`. Its resource memberships, knowledge interval, counts, and terminal state are immutable after completion. Deterministic identities and database uniqueness make repeated provider pages, retries, and restart idempotent. A position, order, or fill absent from one complete collection is represented by that cycle's complete membership; absence from a partial collection has no state-changing meaning and is never converted to zero or deletion.

Only a completed cycle may atomically replace the selected current-cycle pointer and rebuild the local current projection. Promotion, cycle membership, projection rows, and the reconciliation result commit together. A failed cycle records a bounded non-sensitive failure classification, leaves the prior completed cycle selected, and makes synchronization health stale, failed, or unavailable as appropriate. One fenced worker lease per account fingerprint prevents overlapping processes from promoting competing cycles. Restart resumes from durable cycle state and never treats in-memory pages as audit authority.

Phase 4 reconciliation means provider-observation-versus-local-projection integrity. For a completed cycle, the application independently reconstructs the expected current projection from that cycle's immutable normalized membership and compares it with the rows selected for presentation. Reconciliation is `converged` only when account values, complete resource membership, observation identities, and derived portfolio result identity match exactly. A mismatch is durable drift and cannot be hidden by rewriting history. Missing or incomplete provider evidence yields `unknown` or `unavailable`, not convergence.

This is not independent accounting reconciliation. The application has no preexisting authoritative local cash ledger, locally submitted order state, complete transfer and fee activity, dividend and corporate-action history, or execution ledger in Phase 4. Observed orders and fills remain provider facts and do not become application `OrderIntent` or executable `Order` objects. Later execution work must reconcile its separately owned local order and accounting state against the broker under a new decision.

## Consequences

Every current portfolio view can be traced to one complete, immutable provider observation cycle and reproduced after restart. Partial failures cannot erase a good snapshot or make an absent resource look like zero. Storage grows append-only; retention or compaction requires a later archival decision.

The reconciliation label is deliberately narrow and truthful. It proves the integrity of synchronization and projection, but it does not claim that fills alone explain account equity, cash movement, corporate actions, or all historical position changes.
