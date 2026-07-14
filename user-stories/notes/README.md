# Implementation Notes

These notes record what each completed story established, how it was validated, and what later stories may safely assume. Read the relevant note and linked ADRs before extending a package.

| Story | Note                                                                   | Status   |
| ----- | ---------------------------------------------------------------------- | -------- |
| P1-01 | [Monorepo foundation](./phase-1-01-monorepo-foundation.md)             | Complete |
| P1-02 | [Shared domain package](./phase-1-02-shared-domain-package.md)         | Complete |
| P1-03 | [Code quality toolchain](./phase-1-03-code-quality-toolchain.md)       | Complete |
| P1-04 | [Test foundation](./phase-1-04-test-foundation.md)                     | Complete |
| P1-05 | [Configuration and secrets](./phase-1-05-configuration-and-secrets.md) | Complete |
| P1-06 | [Local data services](./phase-1-06-local-data-services.md)             | Complete |
| P1-07 | [Observability foundation](./phase-1-07-observability-foundation.md)   | Complete |
| P1-08 | [Continuous integration](./phase-1-08-continuous-integration.md)       | Complete |
| P1-09 | [Foundation verification](./phase-1-09-foundation-verification.md)     | Complete |

## Phase 2: Market-Data Ingestion

| Story | Note                                                                   | Status   |
| ----- | ---------------------------------------------------------------------- | -------- |
| P2-01 | [Market-data contracts](./phase-2-01-market-data-contracts.md)         | Complete |
| P2-02 | [Safe feed configuration](./phase-2-02-safe-feed-configuration.md)     | Complete |
| P2-03 | [Provider adapter contract](./phase-2-03-provider-adapter-contract.md) | Complete |
| P2-04 | [Provider-bar normalization](./phase-2-04-normalize-provider-bars.md)  | Complete |
| P2-05 | [Paper-compatible feed](./phase-2-05-connect-paper-feed.md)            | Complete |
| P2-06 | [Stream recovery](./phase-2-06-stream-recovery.md)                     | Complete |
| P2-07 | [Redis event delivery](./phase-2-07-redis-event-delivery.md)           | Complete |
| P2-08 | [Market-data persistence](./phase-2-08-persist-market-data.md)         | Complete |
| P2-09 | [Portable recording and replay](./phase-2-09-record-and-replay.md)     | Complete |
| P2-10 | [Terminal market status](./phase-2-10-terminal-market-status.md)       | Complete |
| P2-11 | [Phase 2 verification](./phase-2-11-phase-verification.md)             | Complete |

## Phase 3: First Deterministic Signal

The credential-free technical verifier and Docker/PostgreSQL service, restart, live-worker, and replay matrix passed before the external input dependency. The 2026-07-13 credential-gated provider smoke then observed normalized AAPL and SPY bars and resolved P2-11, making the completed Phase 3 notes eligible.

| Story | Note                                                                             | Status   |
| ----- | -------------------------------------------------------------------------------- | -------- |
| P3-01 | [Signal decisions and contracts](./phase-3-01-signal-decisions-and-contracts.md) | Complete |
| P3-02 | [Safe signal configuration](./phase-3-02-safe-signal-configuration.md)           | Complete |
| P3-03 | [Deterministic feature windows](./phase-3-03-deterministic-feature-windows.md)   | Complete |
| P3-04 | [Breakout-plus-volume rule](./phase-3-04-breakout-volume-signal.md)              | Complete |
| P3-05 | [Signal evidence persistence](./phase-3-05-persist-signal-evidence.md)           | Complete |
| P3-06 | [Canonical-bar processing](./phase-3-06-process-canonical-bars.md)               | Complete |
| P3-07 | [Deterministic signal replay](./phase-3-07-replay-signal-sessions.md)            | Complete |
| P3-08 | [Terminal signal status](./phase-3-08-terminal-signal-status.md)                 | Complete |
| P3-09 | [Phase 3 verification](./phase-3-09-phase-verification.md)                       | Complete |

The P3-09 note keeps the credential-gated provider input proof separate from synthetic signal behavior and records the 52-file/544-test CI plus Docker/PostgreSQL verification evidence.

## Phase 4: Read-Only Portfolio Monitoring

P4-01 through P4-10 have completed implementation notes. The credential-free package, adapter, normalization, persistence, worker, reconciliation, calculation, API, and dashboard behavior is implemented and tested. `npm run verify:phase4` passed root CI with 74 test files/991 tests plus clean disposable-database migration, a seeded migrations-0001-through-0003 upgrade, nullable multi-leg order constraint checks, fixture persistence, API including past-end pages, restart, orphan-recovery, pointer-preservation, deterministic-presentation, and cleanup. P4-11 remains open because the separately credential-gated paper-broker provider smoke has not run; fixture or technical-verifier evidence is not a substitute for that external account observation.

| Story | Note                                                                                     | Status                 |
| ----- | ---------------------------------------------------------------------------------------- | ---------------------- |
| P4-01 | [Portfolio contracts and decisions](./phase-4-01-portfolio-contracts-and-decisions.md)   | Complete               |
| P4-02 | [Safe paper portfolio configuration](./phase-4-02-safe-paper-portfolio-configuration.md) | Complete               |
| P4-03 | [GET-only paper broker adapter](./phase-4-03-read-only-broker-adapter.md)                | Complete               |
| P4-04 | [Broker-observation normalization](./phase-4-04-normalize-broker-observations.md)        | Complete               |
| P4-05 | [Portfolio snapshot persistence](./phase-4-05-persist-portfolio-snapshots.md)            | Complete               |
| P4-06 | [Paper-portfolio synchronization](./phase-4-06-synchronize-paper-portfolio.md)           | Complete               |
| P4-07 | [Projection-integrity reconciliation](./phase-4-07-reconcile-portfolio-projection.md)    | Complete               |
| P4-08 | [Exact portfolio projections](./phase-4-08-calculate-portfolio-projections.md)           | Complete               |
| P4-09 | [Read-only portfolio API](./phase-4-09-read-only-portfolio-api.md)                       | Complete               |
| P4-10 | [Paper-portfolio dashboard](./phase-4-10-paper-portfolio-dashboard.md)                   | Complete               |
| P4-11 | Technical verifier passed; no completion note because provider smoke has not run         | Provider smoke pending |

## Shared Phase Boundary

Phases 1-3 are complete: the safe foundation supports the exact AAPL/SPY market-data slice in ADRs 0006-0008 and the observation-only deterministic signal slice in ADRs 0009-0011. Market data and signal monitoring both default to disabled, and signal output remains an observation rather than a recommendation or position action.

Phase 4 remains authorized only as the read-only portfolio-monitoring slice described by ADRs 0012-0014. It defaults to disabled, uses separate paper broker credentials, exposes only four accepted GET resources, preserves unsupported holdings and incomplete states, and keeps broker marks visibly distinct from Phase 2 market data. Its external phase exit remains pending P4-11. It does not authorize alerts, notifications, portfolio-risk decisions, order intents, approvals, broker mutations, execution, live brokerage, AI research, or later phases.
