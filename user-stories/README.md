# User Stories

Stories are ordered by dependency. A story is complete only when its acceptance criteria and validation pass and an implementation note is added under `user-stories/notes/`.

## Phase 1: Foundation

### Goal

Create a safe, repeatable TypeScript foundation. Contributors can install the workspace, run quality checks, start local TimescaleDB and Redis, and observe minimal application processes without financial credentials or market data.

### Prerequisites

Phase 0 choices affecting the scaffold must be accepted or recorded as ADRs. Defaults remain paper-only with execution disabled.

### Story Order

| Story                                              | Outcome                                        | Depends on          | Notes                                                             |
| -------------------------------------------------- | ---------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| [P1-01](./phase-1-01-monorepo-foundation.md)       | Monorepo foundation                            | Phase 0 decisions   | [Implementation](./notes/phase-1-01-monorepo-foundation.md)       |
| [P1-02](./phase-1-02-shared-domain-package.md)     | Framework-independent domain package           | P1-01               | [Implementation](./notes/phase-1-02-shared-domain-package.md)     |
| [P1-03](./phase-1-03-code-quality-toolchain.md)    | Formatting, linting, type checking, and builds | P1-01               | [Implementation](./notes/phase-1-03-code-quality-toolchain.md)    |
| [P1-04](./phase-1-04-test-foundation.md)           | Deterministic automated tests                  | P1-02, P1-03        | [Implementation](./notes/phase-1-04-test-foundation.md)           |
| [P1-05](./phase-1-05-configuration-and-secrets.md) | Validated, safe configuration                  | P1-01               | [Implementation](./notes/phase-1-05-configuration-and-secrets.md) |
| [P1-06](./phase-1-06-local-data-services.md)       | Local PostgreSQL/TimescaleDB and Redis         | P1-05               | [Implementation](./notes/phase-1-06-local-data-services.md)       |
| [P1-07](./phase-1-07-observability-foundation.md)  | Logging, metrics, and tracing conventions      | P1-03, P1-05        | [Implementation](./notes/phase-1-07-observability-foundation.md)  |
| [P1-08](./phase-1-08-continuous-integration.md)    | Required CI quality gate                       | P1-03, P1-04        | [Implementation](./notes/phase-1-08-continuous-integration.md)    |
| [P1-09](./phase-1-09-foundation-verification.md)   | Reproducible Phase 1 handoff                   | P1-01 through P1-08 | [Implementation](./notes/phase-1-09-foundation-verification.md)   |

### Definition of Done

Phase 1 stories are complete; their acceptance criteria, validation evidence, and implementation notes remain the handoff contract.

### Phase Boundary

Phase 1 excludes provider connections, market-event ingestion, signals, portfolios, order intents, broker submission, AI research, and live trading.

## Phase 2: Market-Data Ingestion

### Goal

Stream provider-supplied one-minute AAPL and SPY bars from one paper-compatible feed into the terminal worker, normalize them into application-owned events, deliver and persist them idempotently, record replayable sessions, and expose honest connection and freshness status.

### Phase 1 Handoff

Phase 2 builds directly on Phase 1's strict workspaces, exact string values, injected clocks, safe configuration, deterministic tests, secret-safe observability, and pinned TimescaleDB/Redis services. Phase 1 deliberately left the provider adapter, market-event schema, migrations, Redis Stream contract, and replay format to the features that now own them. ADRs 0006-0008 close those deferred decisions without weakening the original paper-only boundary.

### Story Order

| Story                                              | Outcome                                    | Depends on          | Notes                                                             | Status   |
| -------------------------------------------------- | ------------------------------------------ | ------------------- | ----------------------------------------------------------------- | -------- |
| [P2-01](./phase-2-01-market-data-contracts.md)     | Versioned contracts and event semantics    | Phase 1             | [Implementation](./notes/phase-2-01-market-data-contracts.md)     | Complete |
| [P2-02](./phase-2-02-safe-feed-configuration.md)   | Safe paper-feed configuration              | P2-01               | [Implementation](./notes/phase-2-02-safe-feed-configuration.md)   | Complete |
| [P2-03](./phase-2-03-provider-adapter-contract.md) | Replaceable adapter and deterministic fake | P2-01               | [Implementation](./notes/phase-2-03-provider-adapter-contract.md) | Complete |
| [P2-04](./phase-2-04-normalize-provider-bars.md)   | Lossless provider-bar normalization        | P2-01, P2-03        | [Implementation](./notes/phase-2-04-normalize-provider-bars.md)   | Complete |
| [P2-05](./phase-2-05-connect-paper-feed.md)        | Authenticated AAPL/SPY subscription        | P2-02, P2-04        | [Implementation](./notes/phase-2-05-connect-paper-feed.md)        | Complete |
| [P2-06](./phase-2-06-stream-recovery.md)           | Bounded recovery and gap reporting         | P2-05               | [Implementation](./notes/phase-2-06-stream-recovery.md)           | Complete |
| [P2-07](./phase-2-07-redis-event-delivery.md)      | At-least-once Redis delivery               | P2-01, P2-04, P2-06 | [Implementation](./notes/phase-2-07-redis-event-delivery.md)      | Complete |
| [P2-08](./phase-2-08-persist-market-data.md)       | Event ledger and one-minute bars           | P2-07               | [Implementation](./notes/phase-2-08-persist-market-data.md)       | Complete |
| [P2-09](./phase-2-09-record-and-replay.md)         | Deterministic session replay               | P2-08               | [Implementation](./notes/phase-2-09-record-and-replay.md)         | Complete |
| [P2-10](./phase-2-10-terminal-market-status.md)    | Latest bar prices and feed status          | P2-06, P2-08, P2-09 | [Implementation](./notes/phase-2-10-terminal-market-status.md)    | Complete |
| [P2-11](./phase-2-11-phase-verification.md)        | Reproducible Phase 2 handoff               | P2-01 through P2-10 | [Implementation](./notes/phase-2-11-phase-verification.md)        | Complete |

### Definition of Done

Each story requires risk-based automated tests, secret-safe observability, updated commands and schemas, and a note recording decisions and validation evidence. Provider credentials and network access must never be required by the normal CI path.

### Phase Exit Status

Phase 2 is complete. The implementation restricts provider scope to AAPL/XNAS and SPY/ARCX one-minute bars, delivers normalized events idempotently through Redis, records durable audit history and canonical bars, applies bounded recovery, reports entitlement and freshness separately from transport health, and replays the verified portable session deterministically. The credential-free CI and Docker-backed Redis/TimescaleDB service/restart path passed, and the 2026-07-13 credential-gated provider smoke authenticated, subscribed to exact Alpaca IEX AAPL/SPY bars, observed normalized one-minute bars for both approved symbols at 17:18Z, and shut down cleanly. Signals, portfolios, alerts, orders, execution, web-dashboard work, additional assets, and trade-to-bar aggregation remain out of scope.

## Phase 3: First Deterministic Signal

### Goal

Complete the first market-data-to-signal vertical slice with one versioned breakout-plus-volume observation for AAPL and SPY. Evaluate only committed canonical one-minute bars, preserve exact inputs and every decision outcome, handle corrections without rewriting history, reproduce results from verified recordings, and explain the latest result in the terminal.

### Roadmap Alignment

The governing implementation order and the repository's first vertical slice place one deterministic signal before paper-account synchronization. Phase 3 therefore owns only this initial signal and its evidence. Portfolio monitoring moves to Phase 4; the broader signal catalog remains separately scoped later work.

### Phase 2 Handoff and Prerequisite

Phase 2 supplies application-owned exact bar events, committed canonical AAPL/SPY bars, session/gap/freshness classifications, at-least-once Redis delivery, append-only audit history, injected clocks, and verified portable-recording interfaces. It deliberately supplies no decimal arithmetic, feature state, signal contract, canonical-bar-to-signal handoff, signal persistence, or signal presentation.

The user originally reprioritized Phase 3 implementation ahead of the remaining P2-11 provider demonstration without waiving that dependency. P2-11 is now complete: `npm run verify:phase2` passed on healthy Redis/TimescaleDB services, and the 2026-07-13 credential-gated provider smoke observed normalized AAPL and SPY bars. A naturally occurring live signal is not required; provider validation proves the input boundary and synthetic replay proves signal behavior.

### Story Order

| Story                                                   | Outcome                                             | Depends on          | Notes                                                                  | Status   |
| ------------------------------------------------------- | --------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- | -------- |
| [P3-01](./phase-3-01-signal-decisions-and-contracts.md) | Exact-decimal signal semantics and contracts        | P2-11 exit          | [Implementation](./notes/phase-3-01-signal-decisions-and-contracts.md) | Complete |
| [P3-02](./phase-3-02-safe-signal-configuration.md)      | Immutable versioned signal configuration            | P3-01               | [Implementation](./notes/phase-3-02-safe-signal-configuration.md)      | Complete |
| [P3-03](./phase-3-03-deterministic-feature-windows.md)  | Data-quality-aware rolling feature state            | P3-01, P3-02        | [Implementation](./notes/phase-3-03-deterministic-feature-windows.md)  | Complete |
| [P3-04](./phase-3-04-breakout-volume-signal.md)         | One explainable breakout-plus-volume rule           | P3-01 through P3-03 | [Implementation](./notes/phase-3-04-breakout-volume-signal.md)         | Complete |
| [P3-05](./phase-3-05-persist-signal-evidence.md)        | Append-only evaluations and complete evidence       | P3-03, P3-04        | [Implementation](./notes/phase-3-05-persist-signal-evidence.md)        | Complete |
| [P3-06](./phase-3-06-process-canonical-bars.md)         | Recoverable committed-bar signal processing         | P3-03 through P3-05 | [Implementation](./notes/phase-3-06-process-canonical-bars.md)         | Complete |
| [P3-07](./phase-3-07-replay-signal-sessions.md)         | Deterministic signal replay and correction recovery | P3-05, P3-06        | [Implementation](./notes/phase-3-07-replay-signal-sessions.md)         | Complete |
| [P3-08](./phase-3-08-terminal-signal-status.md)         | Truthful terminal signal explanation and health     | P3-05 through P3-07 | [Implementation](./notes/phase-3-08-terminal-signal-status.md)         | Complete |
| [P3-09](./phase-3-09-phase-verification.md)             | Reproducible Phase 3 handoff                        | P3-01 through P3-08 | [Implementation](./notes/phase-3-09-phase-verification.md)             | Complete |

### Current Implementation Evidence

- ADRs 0009-0011 and `@daily-trader/signals` implement bounded string-only exact arithmetic, fixed semantic/configuration identities, deterministic feature windows, one `breakout_plus_volume.v1` rule, run-scoped transitions, and a separately versioned replay core.
- The generalized migration and market-data repository implement frozen ledger quality metadata, the canonical-revision journal, append-only signal evidence, signal runs/cursors, replay membership, and a leased writer-capability handshake for atomic live-run cutover.
- `workers/signals/` implements monitoring-only durable journal processing, same-configuration resume and configuration rollover, replay persistence, worker health, and terminal status without a provider, Redis, portfolio, broker, alert, AI, order, or execution connection.
- `npm run verify:phase3` passed credential-free CI with 52 test files/544 tests, dependency audit, repeated disposable-database migrations, two clean replay targets, repeat into existing state, exact interrupted-prefix preservation across service restart, live canonical-revision processing and restart, configuration rollover, bounded disable drain, persisted live/replay status, and bounded cleanup.
- The Docker/PostgreSQL Phase 3 service, clean-target replay, existing-state replay, interrupted/restart, and live-worker technical acceptance paths passed. The separate P2-11 credential-gated AAPL/SPY provider-bar observation passed on 2026-07-13, resolving the final Phase 3 dependency.

P3-01 through P3-09 now have implementation notes recording their completed acceptance and validation evidence. Code presence and unit/static checks alone did not justify those notes before the external dependency passed.

### Definition of Done

Each story requires deterministic risk-based tests, explicit data-quality suppression, exact-decimal signal arithmetic, append-only audit evidence, bounded in-memory state and durable recovery, safe observability, and documentation matching actual behavior. Normal CI and replay remain credential-free. Phase 3 never treats an occurrence as a recommendation or position action.

### Phase Exit

Phase 3 is complete. The approved breakout-plus-volume observation is calculated from committed canonical bars with reviewed exact-decimal arithmetic; every evaluation, occurrence, and run association is persisted idempotently with complete versioned evidence; every run-owned post-cutover canonical revision is processed under the correct configuration; historical changes append deterministic superseding or retracting results; restart loses no required work; and isolated clean, existing-state, and interrupted/restart replays reproduce the required canonical output. Portfolio state, additional signal types, alerts, notifications, order intents, risk approval, broker access, execution, AI research, additional assets, extended hours, backtesting, and performance claims remain out of scope.

## Phase 4: Read-Only Portfolio Monitoring

### Goal

Synchronize the full expected Alpaca paper account through a provably GET-only adapter, preserve complete append-only observation cycles, reconcile the selected local projection against its immutable provider evidence, calculate exact portfolio values under reviewed rules, and display a truthful local read-only dashboard.

### Phase 3 Handoff and Boundary

Phase 4 builds on the completed market-data and deterministic-signal foundations but does not join signal observations to portfolio actions. ADRs 0012-0014 fix the paper broker, snapshot, synchronization, reconciliation, valuation, and arithmetic meanings before implementation. Broker state is read-only provider evidence; observed orders and fills are not local order intents or execution objects.

The provider account is not filtered to AAPL and SPY. Unsupported holdings remain visible and suppress incomplete aggregates rather than being silently discarded. Broker resources are separately fetched over a bounded knowledge interval, so only complete cycles are promoted and no cycle is described as an atomic provider snapshot.

### Story Order

| Story                                                       | Outcome                                              | Depends on          | Notes                                                                      | Status                 |
| ----------------------------------------------------------- | ---------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- | ---------------------- |
| [P4-01](./phase-4-01-portfolio-contracts-and-decisions.md)  | Versioned portfolio contracts and accepted decisions | P3-09 exit          | [Implementation](./notes/phase-4-01-portfolio-contracts-and-decisions.md)  | Complete               |
| [P4-02](./phase-4-02-safe-paper-portfolio-configuration.md) | Disabled-by-default read-only configuration          | P4-01               | [Implementation](./notes/phase-4-02-safe-paper-portfolio-configuration.md) | Complete               |
| [P4-03](./phase-4-03-read-only-broker-adapter.md)           | Replaceable GET-only paper broker adapter            | P4-01, P4-02        | [Implementation](./notes/phase-4-03-read-only-broker-adapter.md)           | Complete               |
| [P4-04](./phase-4-04-normalize-broker-observations.md)      | Exact normalized account observations                | P4-01, P4-03        | [Implementation](./notes/phase-4-04-normalize-broker-observations.md)      | Complete               |
| [P4-05](./phase-4-05-persist-portfolio-snapshots.md)        | Append-only complete snapshot persistence            | P4-04               | [Implementation](./notes/phase-4-05-persist-portfolio-snapshots.md)        | Complete               |
| [P4-06](./phase-4-06-synchronize-paper-portfolio.md)        | Bounded recoverable paper synchronization            | P4-02 through P4-05 | [Implementation](./notes/phase-4-06-synchronize-paper-portfolio.md)        | Complete               |
| [P4-07](./phase-4-07-reconcile-portfolio-projection.md)     | Provider-to-local projection integrity               | P4-05, P4-06        | [Implementation](./notes/phase-4-07-reconcile-portfolio-projection.md)     | Complete               |
| [P4-08](./phase-4-08-calculate-portfolio-projections.md)    | Exact P&L, allocation, concentration, and exposure   | P4-01, P4-05, P4-07 | [Implementation](./notes/phase-4-08-calculate-portfolio-projections.md)    | Complete               |
| [P4-09](./phase-4-09-read-only-portfolio-api.md)            | Local GET-only portfolio API                         | P4-05, P4-07, P4-08 | [Implementation](./notes/phase-4-09-read-only-portfolio-api.md)            | Complete               |
| [P4-10](./phase-4-10-paper-portfolio-dashboard.md)          | Truthful read-only paper dashboard                   | P4-09               | [Implementation](./notes/phase-4-10-paper-portfolio-dashboard.md)          | Complete               |
| [P4-11](./phase-4-11-phase-verification.md)                 | Reproducible Phase 4 handoff                         | P4-01 through P4-10 | Technical verifier passed; provider smoke not run                          | Provider smoke pending |

### Accepted Decisions

- The exact broker base is `https://paper-api.alpaca.markets/v2`, with separately named paper broker credentials and only GET account, positions, orders, and `FILL` activities.
- The account fingerprint is persisted instead of the raw account identifier. Separately fetched resources retain a knowledge interval; only complete cycles become current.
- Reconciliation proves provider-observation-versus-local-projection integrity, not independent accounting reconstruction.
- Broker marks are the labeled Phase 4 valuation authority. Complete aggregates require USD `us_equity` positions with non-null valid broker marks; every unsupported holding remains visible.
- Portfolio arithmetic uses a private string-only `big.js` wrapper with 48 significant digits, 18 fractional digits, exact sums/subtraction/absolute values, and final percentage rounding half-to-even to at most six decimal places.

### Current Implementation Evidence

- ADRs 0012-0014 and `@daily-trader/portfolio` implement immutable application-owned observations, open provider-created fill-query coverage with separate execution timestamps, canonical serialization and identities, exact projections, snapshot deltas, and provider-observation-versus-local-projection reconciliation.
- `workers/portfolio/` implements the four-resource GET-only Alpaca paper adapter, strict normalization, sanitized fixtures, bounded retry and shutdown, fenced synchronization, append-only PostgreSQL persistence, current-state integrity checks, status, metrics, and the separate provider-smoke command.
- Migration `0004_portfolio_monitoring.sql` implements complete-cycle membership, request evidence, terminal-state and promotion guards, projection/reconciliation persistence, the current pointer, and worker lease/status without changing the earlier phase migrations.
- The loopback Fastify API exposes only versioned GET portfolio summary and bounded positions, observed orders, and fills. The Next.js dashboard labels paper, read-only, execution-disabled state and keeps unsupported, unavailable, stale, and bounded provider-created activity-query evidence visible.
- `npm run verify:phase4` passed the credential-free matrix: root CI with 73 test files/921 tests, dependency audit, sanitized fixture verification, repeated clean migrations, complete-cycle persistence, exact projection and reconciliation, all read-only API resources, dashboard build/tests, an incomplete cycle across a real service restart, orphan recovery, last-good pointer preservation, deterministic presentation, and bounded cleanup without deleting named volumes. The separate provider smoke remains P4-11's only open evidence.

### Definition of Done

Every story requires deterministic risk-based unit, adapter-contract, persistence, restart, failure, calculation, API, and presentation tests proportional to its behavior. Normal CI and fixtures remain credential-free. A separately gated paper-account smoke may read a legitimately empty account but must never mutate it. Implementation notes are created only after each story's acceptance criteria and dependencies pass.

### Phase Exit Status

P4-01 through P4-10 are implemented and have story-level validation notes. Phase 4 is not yet fully exited: the separately credential-gated `npm run portfolio:provider-smoke` has not run against the explicitly expected paper account, so P4-11 remains open. Fixture success and the credential-free technical matrix must never be described as that external provider proof.

When P4-11 is eligible to close, the provider smoke must confirm that the expected full paper account can be fetched through the accepted four-resource GET-only boundary and shut down cleanly, including a legitimately empty account. Alerts, notifications, portfolio-risk decisions, order intents, approvals, broker mutations, execution, live brokerage, AI research, additional asset support, currency conversion, backtesting, and performance claims remain out of scope.
