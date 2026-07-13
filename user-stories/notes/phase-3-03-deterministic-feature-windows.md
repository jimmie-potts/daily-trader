# P3-03 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

`@daily-trader/signals` implements bounded, pure feature windows over ordered committed canonical bars. Windows are isolated by instrument and known NYSE core session, contain only the configured immediately preceding contiguous bars, exclude the evaluation bar and every later bar, and rebuild from immutable bootstrap evidence plus ordered revisions.

Each feature result is either a complete ready snapshot or an explicit suppression. Observation time comes from the evaluation event's immutable receipt time; knowledge time comes from current evidence. Historical inserts and winning corrections produce retrospective results without look-ahead, while gaps, unknown sessions, future-as-of input, zero baselines, insufficient warm-up, and arithmetic overflow never receive fabricated values.

## Validation Evidence

- Unit and table-driven tests passed for AAPL/SPY isolation, warm-up, exact membership, session reset, holidays, early close, unknown dates, gaps, duplicate and out-of-order input, historical insertion, winning replacement fan-out, future-as-of input, zero volume, restart rebuild, and bounded state.
- Determinism tests proved later bars never enter an earlier window and equivalent final canonical state converges on the same final feature projection.
- `npm run verify:phase3`: **Pass** — the 52-file/544-test CI and restart/replay matrix completed successfully.

## Handoff

Feature state is a bounded cache, not audit truth. Continue to reconstruct from the frozen bootstrap and durable revisions, preserve explicit suppression, and never introduce ambient time, cross-session evidence, backfill, corporate-action adjustment, or zero fill implicitly.
