# P5-07: Display and Review Local Alerts

## User Story

As the owner of the local paper portfolio, I want a minimal explainable alert experience so that I can see what fired, understand its evidence and portfolio context, and record that I reviewed it.

## Acceptance Criteria

- The Next.js application adds a newest-first bounded alert feed and alert detail using only the P5-06 contract. Presentation never becomes signal, alert, portfolio-context, correction, or user-disposition authority.
- Every alert shows AAPL or SPY instrument/venue, direction, observation and knowledge timestamps, exact value and threshold evidence, concise reason, signal/configuration versions, data-quality state, current lineage projection, revision history, and user disposition.
- Creation-time portfolio context renders availability, freshness, selected reconciliation, latest-attempt lifecycle, latest-attempt reconciliation, calculation, membership, and support separately, including unknown states and exact limitations. A failed latest attempt shows its safe failure classification and reconciliation unavailable without presenting partial holdings. The view labels `contextSelectedAt`, the separate signal timestamps, knowledge interval, and broker-mark valuation authority, never invents a portfolio `suppressed` state, and never replaces historical context with the latest portfolio.
- Acknowledge and dismiss are the only controls and call only the same-origin P5-06 Next.js route. Pending, success, idempotent no-op/retry, conflict/refetch, unavailable, and failure states are accessible and truthful. Corrections remain separately visible and never reset the displayed disposition.
- PAPER ACCOUNT, READ ONLY, and EXECUTION DISABLED remain prominent. Local acknowledgement is described as review state, not approval.
- Rendering refreshes through a bounded local mechanism compatible with the five-second objective and handles empty, warming, delayed, stale, disconnected, corrected, unavailable, and database-failure states without presenting old state as current.
- Rendering is deterministic under an injected clock, responsive, keyboard-readable, and safe against untrusted stored text. It sends no alert or portfolio evidence to third-party analytics.
- The MVP includes no charts, custom filters, rule editor, login, external notification, snooze, escalation, recommendation, order intent, approval, or trading control.

## Validation

- Component or browser tests cover empty and populated feeds, detail, every revision/lineage/disposition state, all orthogonal context combinations, complete correction history including reactivation, every command result, same-origin routing, refresh, delayed/unavailable API, deterministic fixed-clock rendering, keyboard use, and untrusted text.
- Build and inspect the production web application for public URLs, raw identifiers, secrets, third-party disclosure, alert-rule controls, risk/recommendation language, approval language, and broker or execution actions.

## Dependencies

- P5-06 local alert API.

## Out of Scope

Do not add charts, filters, watchlists, configurable symbols, external channels, hosted access, risk actions, or trade preparation.
