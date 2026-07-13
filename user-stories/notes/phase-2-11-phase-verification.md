# P2-11 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

`npm run verify:phase2` is the reproducible credential-free Phase 2 path. It composes root quality gates, healthy local services, checksum-protected migrations, verified synthetic fixture ingestion, run-isolated Redis delivery, PostgreSQL persistence, terminal status, two clean replay targets plus existing-state replay, a service restart, and bounded cleanup without deleting named volumes. Separate root commands expose migration, recording verification, replay, status, and the credential-gated provider smoke.

The handoff documentation records the exact AAPL/XNAS and SPY/ARCX scope, Alpaca IEX entitlement, embedded 2026-2028 core-session calendar, exact event semantics, Redis ownership, durable canonical precedence, replay authority, and safety exclusions. The provider smoke remains outside CI and cannot be inferred from offline verification.

## Validation Evidence

- `npm run ci`: **Pass with the pinned npm 11.18.0** — formatting, lint, strict type checking, 34 test files/376 tests, coverage collection, package builds, API build, worker build, and the Next.js production build completed successfully.
- `npm run audit:dependencies`: **Pass** — the offline audit reported zero vulnerabilities.
- `npm run market-data:recording:verify`: **Pass** — the hardened six-event AAPL/SPY fixture, including its 120-second effective freshness threshold, matched SHA-256 `11dea5ee809119e623df13949c8605b792c5efb3004d78ccc359ee0e7550bb84`.
- `npm run smoke`: **Pass** — the API and disabled-by-default market-data worker smoke checks completed without provider or broker access.
- The final static safety review found and corrected bounded-state, configured-freshness, transient-provider-error, Redis retention-gap, concurrent-correction, replay-session ownership, consumer-group isolation, replay-retry, classified-failure visibility, and shutdown/resource-release defects before the final CI pass. WebSocket close timeout now force-terminates the provider transport, Redis clients are destroyed after bounded cleanup, and checked-out PostgreSQL clients are force-released when graceful shutdown cannot finish. A repeat scan found no execution path, live-broker capability, unsafe financial-number conversion, credential/raw-frame logging, or unbounded event-identity collection in the long-running worker.
- `npm run verify:phase2`: **Pass** against Docker Desktop Engine 29.1.2, Redis 8.2.7, and TimescaleDB 2.28.2/PostgreSQL 17. The command applied the migration to a temporary database, processed the six-event recording through the run-scoped Redis stream, persisted it idempotently into two isolated replay targets plus existing state, rendered truthful status, stopped and restarted both services, and reproduced the same event order plus recording/status checksums after restart. Cleanup dropped the temporary database, removed the run-scoped Redis stream/group, removed its state file, and stopped the containers while preserving named volumes.
- The first Docker-backed run exposed a real integration defect: node-redis 6 selected RESP3, but the raw `XREADGROUP` decoder accepted only the RESP2 nested-array response. The boundary now validates both documented forms and tests the live RESP3 map shape, without weakening entry, field, or single-stream validation.
- Targeted evidence: `packages/market-data` 5 files/107 tests; configuration 1 file/47 tests; provider/adapter/recovery 8 files/77 tests; Redis delivery 1 file/12 tests; replay 2 files/23 tests; status 1 file/15 tests; persistence 2 files/19 tests; full worker 19 files/146 tests. Worker typecheck and production build passed.
- Credential-gated Alpaca provider smoke on 2026-07-13: **Pass**. `node --env-file=dev.env workers/market-data/dist/provider-smoke.js` connected and authenticated against the fixed IEX market-data endpoint, received the exact AAPL/SPY bars-only subscription acknowledgement, observed normalized AAPL/XNAS and SPY/ARCX one-minute bars at 17:18Z, and shut down cleanly after both symbols were present. The recorded evidence contains no credential, account identifier, provider event ID, or raw frame.

## Handoff

Phase 2 ends at trustworthy market-data ingestion, recovery, delivery, persistence, replay, and status. Signals, portfolios, alerts, order intents, brokers, execution, AI research, additional assets, extended hours, raw-provider replay, Kafka, and live brokerage remain excluded.

P2-01 through P2-11 are complete. The credential-free CI, Redis/TimescaleDB service and restart path, deterministic replay, terminal status, and separately credential-gated AAPL/SPY provider observation have all passed. Later phases may rely on the exact AAPL/XNAS and SPY/ARCX one-minute IEX boundary while preserving its single-exchange, core-session, paper-only scope.
