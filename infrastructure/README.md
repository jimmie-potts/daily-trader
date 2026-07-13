# Local Data Services

The Compose stack runs pinned TimescaleDB/PostgreSQL and Redis images for local
development only. Both ports bind to `127.0.0.1`, and the database credentials
are intentionally non-production samples matching the configuration defaults.

## Start and verify

Start both services and let Compose wait on their health checks; no fixed sleep
is needed:

```sh
npm run services:up
```

After building the workspace, run the application-owned smoke check:

```sh
npm run services:check
```

The check loads `@daily-trader/config`, applies bounded connection timeouts,
queries the installed TimescaleDB extension version, and requires Redis to
answer `PING` with `PONG`. Its output contains safe endpoint metadata only.

## Apply application migrations

With TimescaleDB healthy, apply or verify the versioned schema:

```sh
npm run db:migrate
```

The runner takes an advisory lock, applies each new migration in a transaction,
and records its SHA-256 checksum. A repeated run checks the existing migration;
it does not drop tables, truncate market-data history, or delete volumes. A
checksum change to an already applied migration fails explicitly and requires a
new migration rather than rewriting history.

The Phase 2 schema owns named ingestion sessions with effective freshness metadata, session-to-event audit links, an append-only normalized event ledger, TimescaleDB-backed canonical one-minute bars, and detected gaps. Market-series advisory locks serialize duplicate and correction classification without serializing AAPL against SPY. Exact OHLC and volume columns use PostgreSQL `NUMERIC`; application codecs keep them as text instead of converting them to JavaScript floating point.

The Phase 3 migrations extend that schema with frozen data-quality metadata; signal runs, bootstrap evidence, boundaries, and source-specific cursors; the append-only canonical-revision journal; deterministic evaluations, occurrences, ordered evidence, and run-scoped transitions; replay membership and output checksums; writer fencing; and worker status. The full technical verifier has applied and checksum-checked them in disposable PostgreSQL databases and passed its replay, restart, and live-service checks. That credential-free result does not complete Phase 3 while the P2-11 provider smoke remains pending.

### Signal capture and writer capability

Signal monitoring is disabled by default. While no run owns live capture, the Phase 2 ledger and canonical bars continue normally and no signal revision debt accrues. Enabling or rolling over capture takes the AAPL and SPY series locks in a fixed order and then the application-owned revision-counter lock. Canonical changes owned by that run append exactly one gap-free journal position in the same transaction; a journal or capacity failure rolls back the ledger, canonical update, counter, and revision together.

An active paper market-data persistence process registers and renews a leased capability for `daily-trader.market-data.canonical-revision.v1`, the effective freshness threshold, and the accepted data-quality policy, then retires it during bounded graceful shutdown. Signal cutover rejects a missing legacy capability, a retired or incompatible row, or a future-dated heartbeat. An exact accepted row whose lease expired is treated as an inactive crashed writer, not a cutover blocker. Database triggers require a newly opened or active persistence process during capture to declare its current writer-session identity and hold a fresh capability compatible with the run before a canonical update can commit. A deferred constraint rechecks that lease at commit, so expiration while waiting for the global revision counter rolls back the complete transaction. A fresh replacement process can still drain Redis entries produced by an expired session; the expired process itself is fenced. This is a safety handshake, not a broker or execution capability.

The signal worker reads PostgreSQL journal positions and advances its durable run cursor only in the same transaction as the corresponding evaluation evidence and transitions. Redis remains the Phase 2 delivery transport; it is not a second signal-work authority.

## Inspect Redis safely

The Phase 2 transport is Redis Stream `daily-trader.market-data.v1`; persistence
owns consumer group `market-data-persistence-v1`. Inspect a bounded number of
canonical application events and the group's pending summary without printing
environment variables or connection configuration:

```sh
docker compose -f infrastructure/compose.yaml exec redis redis-cli --raw XRANGE daily-trader.market-data.v1 - + COUNT 10
docker compose -f infrastructure/compose.yaml exec redis redis-cli XPENDING daily-trader.market-data.v1 market-data-persistence-v1
```

Stream entries contain canonical normalized event JSON, never raw provider
frames or credentials. `XRANGE` is still operational data inspection: do not
paste its output into public logs or issues. The stream uses approximate
`MAXLEN` retention of 10,000 entries; it is bounded transport, not permanent
recording. PostgreSQL and verified portable recordings are the durable sources.

`npm run verify:phase2` uses Redis database 15 with a unique stream and consumer group derived from that verifier run. Its initial and restart passes share only that run-scoped state; the restart pass removes the group and stream. A failed or interrupted older run cannot be reclaimed by a later run because the later run has a different key and group. Do not reuse verifier-prefixed streams for application data.

The separately versioned Phase 3 signal replay is PostgreSQL-backed and credential-free. Replay targets are isolated by verified input/configuration checksum and cannot close merely because globally deterministic evaluation rows already exist. Completion requires the expected ordered run membership and canonical output checksum. The Phase 3 verifier has passed the service-backed clean-target, existing-state, exact interrupted-prefix, and interrupted/restart replay matrix.

Verify the checked-in artifact without a service connection, then use a healthy migrated local database for replay and explicit replay inspection:

```sh
npm run signal:recording:verify
npm run signal:replay
npm run signal:replay:inspect -- <target-id>
```

`npm run verify:phase3` manages the full credential-free technical matrix, including service start/stop, four temporary databases, repeated migration checks, two clean targets, repeat into existing state, exact partial-membership preservation across interrupted replay and service restart, and the live canonical-revision worker cutover/restart/rollover/disable path. It drops only its temporary databases and preserves named Compose volumes. The current implementation passed this matrix; the command still reported the Phase 3 exit blocked until the separate provider smoke observes both AAPL and SPY.

Inspect health and logs without printing application configuration:

```sh
docker compose -f infrastructure/compose.yaml ps
docker compose -f infrastructure/compose.yaml logs timescaledb redis
```

## Stop safely

Stop containers while preserving the containers and named data volumes:

```sh
npm run services:stop
```

To remove the stopped containers and network while still preserving both data
volumes, run `npm run services:down`. Restart with `npm run services:up`, then rerun `npm run services:check` to confirm the services recover with their local data intact. A service health check proves PostgreSQL/TimescaleDB and Redis availability only; it does not prove the Phase 3 migration, signal replay, or restart acceptance path.

## Destructive reset

The following command permanently deletes the local PostgreSQL and Redis data.
Run it only when an intentional clean reset is required; no project script runs
it implicitly. Migration, replay, status, `verify:phase2`, and any Phase 3 verification must not invoke it:

```sh
npm run services:reset
```

Run the start and smoke-check commands again to recreate and verify empty local
services.
