# P4-05: Persist Complete Portfolio Snapshots

## User Story

As an auditor, I want every paper-account synchronization cycle and normalized observation stored append-only so that the current portfolio view is complete, reproducible, and restart-safe.

## Acceptance Criteria

- New checksum-protected migrations add append-only portfolio cycles, normalized account/position/observed-order/fill revisions, immutable cycle membership, a selected current-cycle pointer, current projection tables, reconciliation results, worker lease and status, and versioned projection identities without modifying applied migrations.
- A cycle begins pending and records the expected account fingerprint, configuration and schema versions, request/resource receipt times, knowledge-interval bounds, resource counts, and bounded lifecycle. It becomes exactly one terminal completed or failed state.
- Completed cycles persist the exclusive activity-creation `after` bound, exclusive activity-creation `until` cutover, and initial-baseline flag. Presentation and replay can therefore distinguish complete pagination for the bounded open provider query from fill execution time, a gap-free ledger, and full account history.
- Deterministic observation identities and uniqueness make page redelivery, repeated source rows, retry, and restart idempotent. Distinct content for the same provider source ID appends a new observation revision; prior facts remain queryable.
- Only a fully fetched and normalized account plus complete position, order, and fill collections may complete. Promotion atomically commits immutable membership, selects that cycle as current, rebuilds the local projection, persists the reconciliation result, and updates worker status.
- A partial, malformed, truncated, account-mismatched, timed-out, rate-limited, canceled, database-failed, or shutdown-interrupted cycle cannot update current rows. The prior complete snapshot remains selected and its age/health becomes explicit.
- Absence has meaning only through complete cycle membership. A missing position, order, or fill in an incomplete resource read never becomes deletion, closure, fill, or zero. Current projections may replace membership, but append-only observations and completed cycles are never updated or deleted.
- PostgreSQL exact values use `NUMERIC` with text-only codecs. Database-generated identifiers and timestamps are operational and remain outside deterministic observation and portfolio identities.
- Read ports return one complete selected snapshot, its knowledge interval, full supported and unsupported holdings, bounded observed orders/fills, reconciliation, and health without returning raw payloads, credentials, or raw account identifiers.

## Validation

- Integration-test fresh/repeat migrations, exact round trips, duplicate and revised observations, complete and empty collections, atomic promotion, partial-cycle rollback, current-pointer fencing, concurrent workers, crash before and after promotion, restart, database outage, account mismatch, unsupported holdings, and deterministic read projections.
- Prove a failed cycle cannot alter the prior current snapshot and the selected projection can be reproduced byte-stably from its immutable membership.

## Dependencies

- P4-04 complete normalized broker observations.

## Out of Scope

Do not poll the broker, calculate portfolio aggregates, delete or compact history, create an alert or order, or treat a web/API cache as the system of record.
