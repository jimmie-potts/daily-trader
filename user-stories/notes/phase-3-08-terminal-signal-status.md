# P3-08 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

The signal terminal selects one persisted live run by default and offers a separate explicitly named replay inspection mode. It renders bounded AAPL/SPY latest evaluation revisions, the latest valid fired history when present, exact evidence, semantic identities, observation and knowledge times, on-time or retrospective mode, worker lifecycle, journal health, cursor lag, and persistence health.

Missing, warming, suppressed, corrected, retracted, retrospective, stale-worker, backlog, gap, and unavailable states remain distinct. IEX evidence is labeled single-exchange, and every occurrence is labeled as an observation rather than a recommendation or position action. Output excludes credentials, account identifiers, provider payloads, internal event IDs, unbounded evidence, and controls.

## Validation Evidence

- Deterministic rendering tests passed for fired up/down, not-fired, suppression, no data, partial scope, historical-only fire, supersession, retraction, retrospective evidence, stale worker, backlog/gap, unavailable persistence, and fixed-clock output.
- Explicit replay inspection passed for clean and restarted replay targets; default live status passed for active, closing, completed, and failed live runs.
- `npm run verify:phase3`: **Pass** — 52 test files/544 tests and persisted live/replay status checks passed.

## Handoff

Status is a read-only projection over one selected run, never audit authority. Do not mix replay with live state or add dashboard, alert, notification, recommendation, portfolio, approval, broker, order, or execution controls here.
