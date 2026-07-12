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
it implicitly:

```sh
npm run services:reset
```

Run the start and smoke-check commands again to recreate and verify empty local
services.
