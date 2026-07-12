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

### Starting Point

Phase 1 deliberately contains no provider SDK, market-event schema, database migration, Redis stream, or replay contract. Read the [Phase 1 implementation notes](./notes/README.md) and accepted [ADRs](../docs/adr/README.md) before starting P2-01.

### Story Order

| Story                                              | Outcome                                    | Depends on          | Status  |
| -------------------------------------------------- | ------------------------------------------ | ------------------- | ------- |
| [P2-01](./phase-2-01-market-data-contracts.md)     | Versioned contracts and event semantics    | Phase 1             | Planned |
| [P2-02](./phase-2-02-safe-feed-configuration.md)   | Safe paper-feed configuration              | P2-01               | Planned |
| [P2-03](./phase-2-03-provider-adapter-contract.md) | Replaceable adapter and deterministic fake | P2-01               | Planned |
| [P2-04](./phase-2-04-normalize-provider-bars.md)   | Lossless provider-bar normalization        | P2-01, P2-03        | Planned |
| [P2-05](./phase-2-05-connect-paper-feed.md)        | Authenticated AAPL/SPY subscription        | P2-02, P2-04        | Planned |
| [P2-06](./phase-2-06-stream-recovery.md)           | Bounded recovery and gap reporting         | P2-05               | Planned |
| [P2-07](./phase-2-07-redis-event-delivery.md)      | At-least-once Redis delivery               | P2-01, P2-04, P2-06 | Planned |
| [P2-08](./phase-2-08-persist-market-data.md)       | Event ledger and one-minute bars           | P2-07               | Planned |
| [P2-09](./phase-2-09-record-and-replay.md)         | Deterministic session replay               | P2-08               | Planned |
| [P2-10](./phase-2-10-terminal-market-status.md)    | Latest bar prices and feed status          | P2-06, P2-08, P2-09 | Planned |
| [P2-11](./phase-2-11-phase-verification.md)        | Reproducible Phase 2 handoff               | P2-01 through P2-10 | Planned |

### Definition of Done

Each story requires risk-based automated tests, secret-safe observability, updated commands and schemas, and a note recording decisions and validation evidence. Provider credentials and network access must never be required by the normal CI path.

### Phase Exit

A controlled provider session streams only AAPL and SPY, delivers normalized events idempotently through Redis, records them in a durable append-only ledger, stores canonical one-minute bars, survives a tested disconnect, reports entitlement and freshness separately from transport health, and replays twice to the same canonical result. Signals, portfolios, alerts, orders, execution, web-dashboard work, additional assets, and trade-to-bar aggregation remain out of scope.
