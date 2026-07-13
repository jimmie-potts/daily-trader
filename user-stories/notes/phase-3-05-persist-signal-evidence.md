# P3-05 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

Checksum-protected migrations add the append-only canonical-revision journal, signal runs and cursors, bootstrap membership, deterministic evaluations and occurrences, ordered evidence, run associations, transitions, replay membership, latest-revision projections, and writer fencing without rewriting the applied Phase 2 migration.

Exact values use PostgreSQL `NUMERIC` through text-only codecs. Global evaluation and occurrence rows are idempotent across runs, while each run retains its own ordered predecessor, supersession, and retraction history. Cursor advancement and every required evidence and transition effect commit atomically. Historical rows are never updated in place or hidden by the current projection.

## Validation Evidence

- Migration and repository tests passed for fresh/repeat application, checksums, exact round trips, revision atomicity, rollback, duplicate/concurrent calls, run sharing, transition cases, cursor namespace and claim fencing, deterministic projections, database failure, and interrupted retry.
- Disposable PostgreSQL verification passed repeated migrations, clean and existing-state targets, restart preservation, and append-only output checks.
- `npm run verify:phase3`: **Pass** — root CI completed 52 test files/544 tests and the dependency audit reported zero vulnerabilities.

## Handoff

PostgreSQL and immutable replay recordings are audit authority. Do not delete or compact evidence, mutate transition history, treat latest projections as the only truth, add dashboard ownership, or introduce portfolio, alert, broker, risk, or execution tables through this slice.
