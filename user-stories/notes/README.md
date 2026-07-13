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

| Story | Note                                                                   | Status                |
| ----- | ---------------------------------------------------------------------- | --------------------- |
| P2-01 | [Market-data contracts](./phase-2-01-market-data-contracts.md)         | Complete              |
| P2-02 | [Safe feed configuration](./phase-2-02-safe-feed-configuration.md)     | Complete              |
| P2-03 | [Provider adapter contract](./phase-2-03-provider-adapter-contract.md) | Complete              |
| P2-04 | [Provider-bar normalization](./phase-2-04-normalize-provider-bars.md)  | Complete              |
| P2-05 | [Paper-compatible feed](./phase-2-05-connect-paper-feed.md)            | Provider bars pending |
| P2-06 | [Stream recovery](./phase-2-06-stream-recovery.md)                     | Complete              |
| P2-07 | [Redis event delivery](./phase-2-07-redis-event-delivery.md)           | Complete              |
| P2-08 | [Market-data persistence](./phase-2-08-persist-market-data.md)         | Complete              |
| P2-09 | [Portable recording and replay](./phase-2-09-record-and-replay.md)     | Complete              |
| P2-10 | [Terminal market status](./phase-2-10-terminal-market-status.md)       | Provider bars pending |
| P2-11 | [Phase 2 verification](./phase-2-11-phase-verification.md)             | Provider bars pending |

## Phase 3: First Deterministic Signal (Implementation Present; Notes Pending)

Phase 3 has a dependency-ordered [story backlog](../README.md#phase-3-first-deterministic-signal), and implementation is present because the user explicitly reprioritized it ahead of the remaining P2-11 provider-bar demonstration. No Phase 3 implementation note exists yet because code presence is not story completion.

| Story | Implementation state      | Note eligibility                                       |
| ----- | ------------------------- | ------------------------------------------------------ |
| P3-01 | Present; technical pass   | Blocked by P2-11 provider-observation dependency       |
| P3-02 | Present; technical pass   | Blocked by the transitive P2-11 dependency             |
| P3-03 | Present; technical pass   | Blocked by the transitive P2-11 dependency             |
| P3-04 | Present; technical pass   | Blocked by the transitive P2-11 dependency             |
| P3-05 | Present; technical pass   | Blocked by the transitive P2-11 dependency             |
| P3-06 | Present; technical pass   | Blocked by the transitive P2-11 dependency             |
| P3-07 | Present; technical pass   | Blocked by the transitive P2-11 dependency             |
| P3-08 | Present; technical pass   | Blocked by the transitive P2-11 dependency             |
| P3-09 | Technical verifier passed | Blocked by the P2-11 provider-observation prerequisite |

Add a story note only after its dependencies, acceptance criteria, and validation have passed. The note must record exact commands and results; it must not infer provider success from synthetic data or infer PostgreSQL/restart success from unit mocks.

## Shared Phase Boundary

Phase 1 supplied the safe foundation; Phase 2 adds the market-data slice described by ADRs 0006-0008; and the current Phase 3 workspace adds only the deterministic signal slice described by ADRs 0009-0011. Market data and signal monitoring both default to disabled. Signal output is an observation, not a recommendation or position action. The implementation has no portfolio state, alert, notification, order intent, risk approval, broker access, AI research, additional asset, consolidated feed, or execution behavior. Phase 3 does not authorize Phase 4 or later work.
