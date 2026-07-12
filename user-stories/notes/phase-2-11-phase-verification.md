# P2-11 Implementation Note

- Status: Implemented; service validation blocked and provider bar observation pending
- Implemented: 2026-07-12

## What Was Implemented

`npm run verify:phase2` is the reproducible credential-free Phase 2 path. It composes root quality gates, healthy local services, checksum-protected migrations, verified synthetic fixture ingestion, run-isolated Redis delivery, PostgreSQL persistence, terminal status, two clean replay targets plus existing-state replay, a service restart, and bounded cleanup without deleting named volumes. Separate root commands expose migration, recording verification, replay, status, and the credential-gated provider smoke.

The handoff documentation records the exact AAPL/XNAS and SPY/ARCX scope, Alpaca IEX entitlement, embedded 2026-2028 core-session calendar, exact event semantics, Redis ownership, durable canonical precedence, replay authority, and safety exclusions. The provider smoke remains outside CI and cannot be inferred from offline verification.

## Validation Evidence

- `npm run ci`: **Pass with the pinned npm 11.18.0** — formatting, lint, strict type checking, 34 test files/374 tests, coverage collection, package builds, API build, worker build, and the Next.js production build completed successfully.
- `npm run audit:dependencies`: **Pass** — the offline audit reported zero vulnerabilities.
- `npm run market-data:recording:verify`: **Pass** — the hardened six-event AAPL/SPY fixture, including its 120-second effective freshness threshold, matched SHA-256 `11dea5ee809119e623df13949c8605b792c5efb3004d78ccc359ee0e7550bb84`.
- `npm run smoke`: **Pass** — the API and disabled-by-default market-data worker smoke checks completed without provider or broker access.
- The final static safety review found and corrected bounded-state, configured-freshness, transient-provider-error, Redis retention-gap, concurrent-correction, replay-session ownership, consumer-group isolation, replay-retry, classified-failure visibility, and shutdown/resource-release defects before the final CI pass. WebSocket close timeout now force-terminates the provider transport, Redis clients are destroyed after bounded cleanup, and checked-out PostgreSQL clients are force-released when graceful shutdown cannot finish. A repeat scan found no execution path, live-broker capability, unsafe financial-number conversion, credential/raw-frame logging, or unbounded event-identity collection in the long-running worker.
- `npm run verify:phase2`: **Blocked at `services:up`** after its embedded CI and dependency audit passed. Docker Desktop's Linux engine was unavailable and returned `WSL ... UtilBindVsockAnyPort:307: socket failed 1`; therefore migration, Redis delivery, TimescaleDB persistence, restart, replay-after-restart, and ephemeral-database cleanup were not reached and are **not** represented as passing. The verifier attempted `services:stop` even after failed startup; that cleanup command reached the same unavailable Docker boundary and was reported as failed. No verification database was created, and the temporary verifier state file was removed.
- Targeted evidence: `packages/market-data` 5 files/107 tests; configuration 1 file/47 tests; provider/adapter/recovery 8 files/77 tests; Redis delivery 1 file/10 tests; replay 2 files/23 tests; status 1 file/15 tests; persistence 2 files/19 tests; full worker 19 files/144 tests. Worker typecheck and production build passed.
- Credential-gated Alpaca provider smoke on 2026-07-12: **Partial; not passed**. Live IEX connection, authentication, and exact AAPL/SPY bars subscription succeeded. No Sunday minute bar arrived before the bounded inactivity deadline, so the command failed safely with `ALPACA_INACTIVITY_TIMEOUT`; normalized live AAPL/SPY bars and clean success shutdown remain to be demonstrated during an active session.

## Handoff

Phase 2 ends at trustworthy market-data ingestion, recovery, delivery, persistence, replay, and status. Signals, portfolios, alerts, order intents, brokers, execution, AI research, additional assets, extended hours, raw-provider replay, Kafka, and live brokerage remain excluded. Do not begin a later phase or claim external provider validation from the credential-free path.

P2-01 through P2-10 are implemented and pass their offline tests and static review. P2-11 remains short of its exit criterion until both `npm run verify:phase2` completes against healthy local services and the separately credential-gated provider smoke observes normalized AAPL and SPY bars with truthful feed/entitlement status and graceful shutdown. Rerun the provider smoke during an active market session and replace the partial evidence above only after both approved symbols are actually observed.
