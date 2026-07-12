# Phase 1: Foundation

## Goal

Create a safe, repeatable TypeScript foundation for Daily Trader. At the end of this phase, contributors can install the workspace, run its quality checks, start local PostgreSQL/TimescaleDB and Redis services, and observe a minimal application process. No market-data integration or trading behavior is included.

## Prerequisites

Phase 0 decisions that affect the scaffold must be accepted or recorded as ADRs before implementation, including the package manager, workspace tooling, decimal representation, event semantics, and provider choices. Defaults must remain paper-only with execution disabled.

## Story Order

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

## Definition of Done

Each story is complete only when its acceptance criteria pass, relevant tests and documentation are updated, and the change has been reviewed for secrets, unsafe defaults, live endpoints, and architectural boundary violations. New commands must be documented in both the root `README.md` and `AGENTS.md` when introduced.

## Phase Boundary

Phase 1 excludes market-provider connections, market-event ingestion, signal evaluation, portfolio synchronization, order intents, broker submission, AI research, and live trading. Those capabilities belong to later phases.
