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

| Story                                              | Outcome                                    | Depends on          | Notes                                                             | Status                       |
| -------------------------------------------------- | ------------------------------------------ | ------------------- | ----------------------------------------------------------------- | ---------------------------- |
| [P2-01](./phase-2-01-market-data-contracts.md)     | Versioned contracts and event semantics    | Phase 1             | [Implementation](./notes/phase-2-01-market-data-contracts.md)     | Complete                     |
| [P2-02](./phase-2-02-safe-feed-configuration.md)   | Safe paper-feed configuration              | P2-01               | [Implementation](./notes/phase-2-02-safe-feed-configuration.md)   | Complete                     |
| [P2-03](./phase-2-03-provider-adapter-contract.md) | Replaceable adapter and deterministic fake | P2-01               | [Implementation](./notes/phase-2-03-provider-adapter-contract.md) | Complete                     |
| [P2-04](./phase-2-04-normalize-provider-bars.md)   | Lossless provider-bar normalization        | P2-01, P2-03        | [Implementation](./notes/phase-2-04-normalize-provider-bars.md)   | Complete                     |
| [P2-05](./phase-2-05-connect-paper-feed.md)        | Authenticated AAPL/SPY subscription        | P2-02, P2-04        | [Implementation](./notes/phase-2-05-connect-paper-feed.md)        | Provider bars pending        |
| [P2-06](./phase-2-06-stream-recovery.md)           | Bounded recovery and gap reporting         | P2-05               | [Implementation](./notes/phase-2-06-stream-recovery.md)           | Complete                     |
| [P2-07](./phase-2-07-redis-event-delivery.md)      | At-least-once Redis delivery               | P2-01, P2-04, P2-06 | [Implementation](./notes/phase-2-07-redis-event-delivery.md)      | Service validation blocked   |
| [P2-08](./phase-2-08-persist-market-data.md)       | Event ledger and one-minute bars           | P2-07               | [Implementation](./notes/phase-2-08-persist-market-data.md)       | Service validation blocked   |
| [P2-09](./phase-2-09-record-and-replay.md)         | Deterministic session replay               | P2-08               | [Implementation](./notes/phase-2-09-record-and-replay.md)         | Service validation blocked   |
| [P2-10](./phase-2-10-terminal-market-status.md)    | Latest bar prices and feed status          | P2-06, P2-08, P2-09 | [Implementation](./notes/phase-2-10-terminal-market-status.md)    | External validation blocked  |
| [P2-11](./phase-2-11-phase-verification.md)        | Reproducible Phase 2 handoff               | P2-01 through P2-10 | [Implementation](./notes/phase-2-11-phase-verification.md)        | External validations pending |

### Definition of Done

Each story requires risk-based automated tests, secret-safe observability, updated commands and schemas, and a note recording decisions and validation evidence. Provider credentials and network access must never be required by the normal CI path.

### Phase Exit Status

The implementation restricts provider scope to AAPL/XNAS and SPY/ARCX one-minute bars, delivers normalized events idempotently through Redis, records durable audit history and canonical bars, applies bounded recovery, reports entitlement and freshness separately from transport health, and replays the verified portable session deterministically. P2-01 through P2-10 have implementation notes and pass their recorded offline automated and static checks. P2-11 remains short of the phase exit criterion for two independent reasons: Docker was unavailable for the integrated Redis/TimescaleDB restart demonstration, and the credential-gated Sunday provider run authenticated/subscribed successfully but emitted no AAPL/SPY bar before its inactivity deadline. Signals, portfolios, alerts, orders, execution, web-dashboard work, additional assets, and trade-to-bar aggregation remain out of scope.

## Phase 3: First Deterministic Signal

### Goal

Complete the first market-data-to-signal vertical slice with one versioned breakout-plus-volume observation for AAPL and SPY. Evaluate only committed canonical one-minute bars, preserve exact inputs and every decision outcome, handle corrections without rewriting history, reproduce results from verified recordings, and explain the latest result in the terminal.

### Roadmap Alignment

The governing implementation order and the repository's first vertical slice place one deterministic signal before paper-account synchronization. Phase 3 therefore owns only this initial signal and its evidence. Portfolio monitoring moves to Phase 4; the broader signal catalog remains separately scoped later work.

### Phase 2 Handoff and Prerequisite

Phase 2 supplies application-owned exact bar events, committed canonical AAPL/SPY bars, session/gap/freshness classifications, at-least-once Redis delivery, append-only audit history, injected clocks, and verified portable-recording interfaces. It deliberately supplies no decimal arithmetic, feature state, signal contract, canonical-bar-to-signal handoff, signal persistence, or signal presentation.

The Phase 3 backlog may be reviewed while P2-11 is pending, but implementation must not begin and Phase 3 cannot exit until `npm run verify:phase2` passes on healthy Redis/TimescaleDB services and the credential-gated provider smoke observes normalized AAPL and SPY bars. A naturally occurring live signal is not required; provider validation proves the input boundary and synthetic replay proves signal behavior.

### Story Order

| Story                                                   | Outcome                                             | Depends on          | Status                    |
| ------------------------------------------------------- | --------------------------------------------------- | ------------------- | ------------------------- |
| [P3-01](./phase-3-01-signal-decisions-and-contracts.md) | Exact-decimal signal semantics and contracts        | P2-11 exit          | Planned; blocked on P2-11 |
| [P3-02](./phase-3-02-safe-signal-configuration.md)      | Immutable versioned signal configuration            | P3-01               | Planned                   |
| [P3-03](./phase-3-03-deterministic-feature-windows.md)  | Data-quality-aware rolling feature state            | P3-01, P3-02        | Planned                   |
| [P3-04](./phase-3-04-breakout-volume-signal.md)         | One explainable breakout-plus-volume rule           | P3-01 through P3-03 | Planned                   |
| [P3-05](./phase-3-05-persist-signal-evidence.md)        | Append-only evaluations and complete evidence       | P3-03, P3-04        | Planned                   |
| [P3-06](./phase-3-06-process-canonical-bars.md)         | Recoverable committed-bar signal processing         | P3-03 through P3-05 | Planned                   |
| [P3-07](./phase-3-07-replay-signal-sessions.md)         | Deterministic signal replay and correction recovery | P3-05, P3-06        | Planned                   |
| [P3-08](./phase-3-08-terminal-signal-status.md)         | Truthful terminal signal explanation and health     | P3-05 through P3-07 | Planned                   |
| [P3-09](./phase-3-09-phase-verification.md)             | Reproducible Phase 3 handoff                        | P3-01 through P3-08 | Planned                   |

Implementation notes are added under `user-stories/notes/` only when a story's acceptance criteria and validation pass.

Every Phase 3 story transitively inherits the P2-11 implementation block; P3-01 shows the direct dependency in the table.

### Definition of Done

Each story requires deterministic risk-based tests, explicit data-quality suppression, exact-decimal signal arithmetic, append-only audit evidence, bounded in-memory state and durable recovery, safe observability, and documentation matching actual behavior. Normal CI and replay remain credential-free. Phase 3 never treats an occurrence as a recommendation or position action.

### Phase Exit

Phase 3 is complete only when the approved breakout-plus-volume observation is calculated from committed canonical bars with reviewed exact-decimal arithmetic, every evaluation, occurrence, and run association is persisted idempotently with complete versioned evidence, every run-owned post-cutover canonical revision is processed under the correct configuration, historical changes append deterministic superseding or retracting results, restart loses no required work, and two isolated clean replays plus existing-state replay produce identical canonical signal output for the same ordered scenario. Portfolio state, additional signal types, alerts, notifications, order intents, risk approval, broker access, execution, AI research, additional assets, extended hours, backtesting, and performance claims remain out of scope.
