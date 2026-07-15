# P5-09: Verify and Hand Off the MVP

## User Story

As a contributor, I want one reproducible technical verification path and a separate local-market soak so that the read-only alert MVP can be declared complete without hidden durability, latency, provider, context, or execution assumptions.

## Acceptance Criteria

- P4-11 is complete before P5-01 implementation begins. Fixture or prior technical evidence is never substituted for the required real paper-account GET-only provider smoke.
- A credential-free `npm run verify:phase5` command runs root quality gates and dependency audit; starts healthy local services; verifies clean and seeded-upgrade migrations; exercises fixed alert contracts, configuration, composition, persistence, processing, API actions, dashboard states, replay, restart, and cleanup without deleting named volumes.
- The failure matrix covers disabled defaults, activation with upstream backlog, zero-transition completed source ordinals, incomplete upstream ordinals, disable/drain/re-enable and signal handoff, invalid scope/origin/settings, stale/gapped/invalid market input, every correction-table row, duplicate/retry, every orthogonal portfolio-context state, global/target identity isolation, database outage, cursor gaps, backpressure, database-clock lease expiry/reclaim, stale-worker fencing at every write boundary, replay/live ownership isolation, crash at each context/effect boundary, command concurrency/idempotency, API cancellation and exact request-authenticity failures, contradictory dashboard payloads, and shutdown.
- At least 100 distinct eligible materializations across AAPL/SPY and the accepted context combinations are dashboard-readable within five seconds. A verifier-owned monotonic clock starts immediately after the canonical persistence port receives PostgreSQL `COMMIT` acknowledgement and ends on the correlated successful Next.js dashboard response; provider, statement, journal, transition, and worker timestamps are rejected as substitutes. Verification includes every eligible sample and reports clock markers, ordered samples, nearest-rank index `ceil(0.95 * n)`, p95, and maximum.
- Clean, existing-state, repeated, and interrupted/restarted replay produces the expected alert identities, transition history, action history, context evidence, and current checksum without mixing replay into live status.
- A separate credential-gated local soak operates the accepted market-data, signal, paper-portfolio, alert, API, and dashboard path across three distinct complete regular core sessions from the first through final expected minute. Each pass has no unexplained AAPL/SPY bar gap, unresolved cursor gap, lost/duplicate required effect, failed worker, exhausted retry, or post-drain signal/alert backlog; reconnects recover within bounds, portfolio synchronization is completed and converged with fresh evidence at close, and shutdown is clean.
- A naturally occurring live alert is not required during the soak. The live sessions prove external connection and operating continuity; the credential-free scenario matrix proves alert creation and corrections.
- The operating runbook starts local services, market-data, signals, portfolio, alerts, Fastify, and Next.js in dependency order and verifies each status. Before any process shutdown, it atomically freezes alert capture and records the finite stop watermark, keeps the required upstream signal path and alert worker running until Phase 3 completion and alert effects drain through that watermark, and only then stops Next.js, Fastify, alerts, portfolio, signals, market-data, and local services in documented reverse dependency order. It names the planned alert worker/status/replay commands and contains no credentials.
- Final review finds no external notification, public listener, permissive CORS, login, rule editor, additional symbol or signal, portfolio-risk decision, recommendation, order intent, approval, broker mutation, live endpoint, AI call, unsafe log, or committed secret.
- README, AGENTS, planning docs, ADRs 0015-0016, epic MVP-01, Phase 5 stories, commands, schemas, and completed implementation notes match delivered behavior. Lower latency remains recorded as a post-MVP improvement.

## Validation

- Run the documented technical verifier from a clean or equivalent isolated checkout, exercise the dedicated alert process and root commands, repeat the restart and replay paths, inspect deterministic API/dashboard output, and record exact commands and results in the P5-09 implementation note.
- Run the separate three-session local soak with ignored paper credentials and record only safe bounded evidence for each explicit pass criterion. Do not infer external success from fixtures or require a live order, fill, or naturally occurring signal.

## Dependencies

- P5-01 through P5-08.
- Completed P4-11 Phase 4 exit.

## Exit Criterion

Phase 5 and MVP-01 are complete only when one local user can receive one durable explainable AAPL or SPY alert from the accepted signal path, inspect immutable creation-time portfolio context, acknowledge or dismiss it, observe truthful correction state, restart and replay without loss or duplication, satisfy the measured five-second objective and three-session operating evidence, and retain an entirely GET-only paper-broker boundary with execution disabled.
