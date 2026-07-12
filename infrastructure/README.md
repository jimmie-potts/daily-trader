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

## Apply market-data migrations

With TimescaleDB healthy, apply or verify the versioned schema:

```sh
npm run market-data:migrate
```

The runner takes an advisory lock, applies each new migration in a transaction,
and records its SHA-256 checksum. A repeated run checks the existing migration;
it does not drop tables, truncate market-data history, or delete volumes. A
checksum change to an already applied migration fails explicitly and requires a
new migration rather than rewriting history.

The initial schema owns named ingestion sessions with effective freshness metadata, session-to-event audit links,
an append-only normalized event ledger, TimescaleDB-backed canonical one-minute
bars, and detected gaps. Market-series advisory locks serialize duplicate and
correction classification without serializing AAPL against SPY.
Exact OHLC and volume columns use PostgreSQL `NUMERIC`; application codecs keep
them as text instead of converting them to JavaScript floating point.

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
volumes, run `npm run services:down`. Restart with `npm run services:up`, then
rerun `npm run services:check` to confirm the services recover with their local
data intact.

## Destructive reset

The following command permanently deletes the local PostgreSQL and Redis data.
Run it only when an intentional clean reset is required; no project script runs
it implicitly. Migration, replay, status, and `verify:phase2` must not invoke it:

```sh
npm run services:reset
```

Run the start and smoke-check commands again to recreate and verify empty local
services.
