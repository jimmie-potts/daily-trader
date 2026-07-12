# P2-08 Implementation Note

- Status: Implemented; integrated service validation blocked
- Implemented: 2026-07-12

## What Was Implemented

`infrastructure/postgres/migrations/0001_market_data.sql` creates named ingestion sessions with their effective freshness threshold, session-event audit links, an append-only normalized-event ledger, a TimescaleDB-backed canonical one-minute-bar table, and detected-gap state. The checksum-protected migration runner uses an advisory lock and per-migration transaction; reruns verify applied content without deleting data.

`MarketDataRepository` revalidates canonical event JSON, takes a per-market-series transaction lock, classifies duplicates, corrections, ordering, timeliness, and gaps, and persists each distinct event transactionally. Exact database `NUMERIC` values remain text through application codecs. Duplicate event IDs add at most one link to another open replay/source session and never copy the global ledger row. For one logical bar, the greatest `(receivedAt, eventId)` tuple becomes canonical while every correction remains in the ledger. Latest-bar queries exclude future bars and apply the effective configured freshness threshold. The Redis entry handler acknowledges only after repository success.

## Validation Evidence

- Persistence passed with 2 files and 19 tests; the current full worker suite passed with 19 files and 144 tests.
- Tests cover sessions, exact parameter values, accepted/duplicate/correction/out-of-order results, canonical precedence independent of arrival order, gaps, transaction commit/rollback, query and stored-data failures, latest-bar filtering, canonical ledger export, acknowledgement after commit, and safe error translation.
- Worker type checking and production build passed. The migration SQL was rechecked for matching canonical insert columns and parameters, durable freshness metadata, session-event references, and market-series locking.
- Docker-backed migration/service validation: **Not Run** because the Docker/WSL service boundary was unavailable (`UtilBindVsockAnyPort:307: socket failed 1`). This is recorded as unavailable, not passing, and remains part of P2-11 final verification.

## Handoff

Run `npm run market-data:migrate` before ingestion or replay against a new database. Never modify an applied migration, convert exact database values through JavaScript number, truncate audit history implicitly, or change canonical precedence without a new ADR and migration.
