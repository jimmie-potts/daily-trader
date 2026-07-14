# P4-11: Verify and Hand Off Phase 4

## User Story

As a contributor, I want one reproducible Phase 4 verification path so that read-only portfolio monitoring can be extended without hidden provider, snapshot, reconciliation, arithmetic, or presentation assumptions.

## Acceptance Criteria

- Completed P2-11 and P3-09 exits are recorded before Phase 4 verification begins, including the credential-gated AAPL/SPY provider observation and the Phase 3 Docker/PostgreSQL replay/restart acceptance matrix.
- A credential-free `npm run verify:phase4` command runs root quality gates and dependency audit, starts healthy local services, verifies both clean migration and a seeded migrations-0001-through-0003 upgrade, exercises sanitized empty and populated broker fixtures through the production adapter port, persists complete and failed cycles, reconciles projections, calculates exact results, renders API/dashboard state, restarts during an incomplete cycle, and cleans up bounded resources without deleting named volumes.
- The failure matrix covers disabled defaults, endpoint and method rejection, redirects, authentication/account mismatch, malformed and oversized payloads, exact-value rejection, empty and paginated resources, page-budget-versus-item-limit coherence, duplicate/revised observations, unsupported holdings/currency, nullable multi-leg structures, null marks, partial cycles, retry/rate limit, provider and database outage, fencing, expired leases, crash at each promotion boundary, staleness, reconciliation drift, arithmetic overflow and half-even boundaries, in-range and past-end API pagination, request cancellation, API outcome and duration metrics, loopback IPv6 URL construction, contradictory dashboard payloads, dashboard unavailable states, and shutdown.
- A separate credential-gated `npm run portfolio:provider-smoke` uses only the exact paper endpoint and four accepted GET resources, requires the authenticated account to match the configured expected paper account, derives internal fingerprinted state without emitting either identifier, accepts legitimately empty positions/orders/fills, emits only fixed method/resource counts, bounded collection counts, projection state, reconciliation state, and execution-disabled state, and shuts down cleanly. It does not persist provider observations and never creates, replaces, cancels, closes, or otherwise mutates broker state.
- Normal CI, fixture, migration, calculation, API, dashboard, and verification paths require no broker or market-data credential. Provider-smoke success is never inferred from a fake, and a nonempty paper account is not required.
- `README.md`, `AGENTS.md`, ADRs 0012-0014, package and worker documentation, migrations, sanitized fixtures, root commands, and completed story implementation notes match actual behavior.
- The final review finds no live endpoint, shared market/broker credential, non-GET broker capability, raw account identifier, complete production payload, JavaScript financial arithmetic, silent partial sum or zero fill, incomplete-cycle promotion, false accounting reconciliation, provider type in portfolio contracts, public unauthenticated portfolio exposure, alert/risk/order/execution path, AI call, unsafe log, or committed secret.

## Validation

- Run the documented workflow from a clean or equivalent isolated checkout, restart services while a cycle is incomplete, compare byte-stable API and dashboard output for the same selected completed cycle before and after restart, separately prove repeated calculation from identical canonical snapshot input is deterministic, and record exact commands and results in the P4-11 implementation note.
- Run the separate provider smoke only with ignored paper credentials and record safe outcome metadata without account, order, fill, position, request, or credential identifiers.

## Dependencies

- P4-01 through P4-10.

## Exit Criterion

Phase 4 is complete only when the full expected paper account is fetched through a provably GET-only adapter, every complete cycle and observation remains append-only and idempotent, partial cycles never replace current state, local projection integrity reconciles after restart, exact portfolio results follow ADR 0014, unsupported and unavailable holdings remain visible, and the local dashboard presents truthful paper/read-only health and values. Alerts, notifications, portfolio-risk decisions, order intents, approvals, broker mutations, execution, live brokerage, AI research, additional asset support, currency conversion, backtesting, and performance claims remain excluded.
