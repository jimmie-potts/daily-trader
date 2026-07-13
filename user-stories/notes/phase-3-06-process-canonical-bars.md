# P3-06 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

`workers/signals` is a dedicated monitoring-only PostgreSQL worker. It establishes atomic live-run cutover only after compatible paper-writer capability checks, processes the durable canonical-revision journal in order, and advances the fenced run cursor in the same transaction as all required signal evidence and transitions.

Same-configuration restart resumes the durable run. Configuration rollover freezes the old run and transfers capture at one watermark; disablement freezes a finite backlog; re-enable after an uncaptured interval creates a fresh bootstrap and run. Capacity, revision gaps, lease loss, unsupported versions, exhausted retry, or database failure stop safely without dropping required work.

## Validation Evidence

- Worker and persistence tests passed for capability rejection, fixed-order cutover, bootstrap eligibility, cursor atomicity, concurrent canonical commits, restart, configuration rollover, bounded disable drain, crash recovery, re-enable without backfill, capacity, retry, fencing, and shutdown.
- The Docker/PostgreSQL live verifier passed same-config restart, expired-writer rejection, rollover, bounded disable drain, re-enable without backfill, and persisted worker health.
- `npm run verify:phase3`: **Pass** — 52 test files/544 tests and the complete service-backed worker matrix passed.

## Handoff

The worker consumes only committed PostgreSQL canonical revisions. Redis, Alpaca, portfolio, alerts, AI, orders, and broker operations remain outside this process, and no failure may advance a cursor past incomplete durable effects.
