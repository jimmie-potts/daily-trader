# P4-05 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

Checksum-protected migration `0004_portfolio_monitoring.sql` adds portfolio synchronization cycles and request evidence, normalized account/position/observed-order/fill membership, projection and reconciliation records, the selected current pointer, and fenced worker status without modifying prior migrations. Additive migration `0005_portfolio_mleg_orders.sql` introduces current snapshot/order schema v2 writes while preserving byte- and identity-stable legacy v1 reads. Nullable singular identity and order type are allowed only on explicit unsupported v2 multi-leg structures; relational checks reject empty text, incomplete non-mleg rows, v1 use of the new reason, and non-mleg misuse of `unsupported_order_structure`. Cycles start pending and become one terminal completed or failed state. Completed cycles retain exact knowledge and open provider activity-creation query coverage, final request membership, resource counts, canonical snapshot bytes, and unsupported-position counts. The coverage bounds do not constrain the separately persisted fill execution timestamp.

`PortfolioRepository` writes exact PostgreSQL `NUMERIC` values through text codecs, verifies the final capture attempt, reconstructs prepared state from the persisted relational rows, recalculates reconciliation, and only then completes and promotes the candidate atomically. Database constraints and deferred guards prevent incomplete, non-converged, count-mismatched, or improperly fenced promotion. Failed or interrupted candidates remain auditable and cannot replace the prior complete current snapshot. Current reads reparse canonical snapshot bytes and recheck persisted membership, projection, and reconciliation integrity before reporting healthy state.

## Validation Evidence

- Portfolio repository tests passed for fenced leases, database-clock expiry, a nonlocking candidate check followed by final locked promotion revalidation, request idempotency, exact writes, complete atomic promotion, partial receipt rejection, rollback, failed-candidate retention, and tampered persisted observation revision.
- A clean disposable PostgreSQL database applied migrations 0001-0005 and verified repeated migration checksums. A second disposable database applied 0001-0003, retained seeded completed signal-worker state while the normal runner upgraded through 0004/0005 twice, and exposed the new portfolio schema without altering the seed. The rollback-only multi-leg constraint matrix accepted nullable and fully populated v2 parent/child shapes in a pending cycle while rejecting nullable or specially classified v1 rows and non-mleg misuse of `unsupported_order_structure` before the default synchronized fixture was read back.
- A direct constraint check confirmed the bounded baseline query, suppressed aggregate state, persisted counts, and converged reconciliation; the disposable database was then removed without changing named service volumes.

## Handoff

The append-only cycle and normalized evidence are audit authority; the current pointer and projections are reproducible read models. Later work must never update completed evidence, treat partial absence as deletion or zero, bypass persisted-row reconciliation, or use an API/dashboard cache as current-state authority.
