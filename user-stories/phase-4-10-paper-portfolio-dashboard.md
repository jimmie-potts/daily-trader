# P4-10: Display the Read-Only Paper Portfolio

## User Story

As a paper-account owner, I want a clear portfolio dashboard so that I can inspect synchronized holdings, valuation, and health without mistaking the application for a trading interface.

## Acceptance Criteria

- The Next.js application renders one read-only paper-portfolio view from the P4-09 API contract or the same persisted read port. Presentation never becomes snapshot, reconciliation, or calculation authority.
- PAPER ACCOUNT, READ ONLY, and EXECUTION DISABLED are prominent. The page contains no buy, sell, submit, replace, cancel, close, approve, snooze, alert, recommendation, or risk-override control.
- The summary shows account cash and equity observations, exact day and unrealized profit and loss, gross and net exposure, concentration, calculation completeness, broker-mark valuation authority, completed-cycle knowledge interval, last-complete age, and synchronization/reconciliation health.
- Position rows show supported or unsupported state, symbol and application venue when known, side, exact quantity, broker mark, signed market value, unrealized profit and loss, allocation when available, currency, and truthful unavailable reasons. Unsupported and null-mark holdings remain visible.
- Bounded observed order and fill sections are labeled provider observations, not local intents or executable orders. They expose no raw provider or database identifier.
- Empty, warming, stale, partial-cycle failure, provider unavailable, account mismatch, reconciliation drift, suppressed calculation, unsupported holding, null mark, and database unavailable states are explicit and visually distinct from a healthy empty account.
- Rendering is deterministic under an injected clock, responsive, keyboard-readable, and safe against untrusted text. It does not include raw HTML from provider data or send broker/account data to third-party analytics.

## Validation

- Component or browser tests cover complete populated and empty portfolios, long/short rows, stale last-good data, all health and suppression states, unsupported/null-mark visibility, bounded observed orders/fills, deterministic fixed-clock rendering, and non-GET/action absence.
- Build the production web app and inspect rendered output for secrets, account IDs, internal IDs, raw payloads, provider-write links, alert controls, recommendations, and execution language.

## Dependencies

- P4-09 versioned read-only portfolio API.

## Out of Scope

Do not add live updates, charting, watchlists, alerts, notifications, portfolio-risk actions, order intents, approvals, broker mutations, execution, or AI analysis.
