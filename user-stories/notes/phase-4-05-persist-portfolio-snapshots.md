# P4-05 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

Checksum-protected migration `0004_portfolio_monitoring.sql` adds portfolio synchronization cycles and request evidence, normalized account/position/observed-order/fill membership, projection and reconciliation records, the selected current pointer, and fenced worker status without modifying prior migrations. Cycles start pending and become one terminal completed or failed state. Completed cycles retain exact knowledge and open provider activity-creation query coverage, final request membership, resource counts, canonical snapshot bytes, and unsupported-position counts. The coverage bounds do not constrain the separately persisted fill execution timestamp.

`PortfolioRepository` writes exact PostgreSQL `NUMERIC` values through text codecs, verifies the final capture attempt, reconstructs prepared state from the persisted relational rows, recalculates reconciliation, and only then completes and promotes the candidate atomically. Database constraints and deferred guards prevent incomplete, non-converged, count-mismatched, or improperly fenced promotion. Failed or interrupted candidates remain auditable and cannot replace the prior complete current snapshot. Current reads reparse canonical snapshot bytes and recheck persisted membership, projection, and reconciliation integrity before reporting healthy state.

## Validation Evidence

- Portfolio repository tests passed for fenced leases, database-clock expiry, a nonlocking candidate check followed by final locked promotion revalidation, request idempotency, exact writes, complete atomic promotion, partial receipt rejection, rollback, failed-candidate retention, and tampered persisted observation revision.
- A clean disposable PostgreSQL database applied migrations 0001-0004, verified repeated migration checksums, persisted the sanitized fixture, and read back a baseline cycle with three positions, two observed orders, one bounded fill, an intentionally incomplete calculation, and converged projection integrity.
- A direct constraint check confirmed the bounded baseline query, suppressed aggregate state, persisted counts, and converged reconciliation; the disposable database was then removed without changing named service volumes.

## Handoff

The append-only cycle and normalized evidence are audit authority; the current pointer and projections are reproducible read models. Later work must never update completed evidence, treat partial absence as deletion or zero, bypass persisted-row reconciliation, or use an API/dashboard cache as current-state authority.
