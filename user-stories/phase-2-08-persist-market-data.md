# P2-08: Persist Events and One-Minute Bars

## User Story

As a data consumer, I want normalized events and canonical bars stored durably so that market sessions survive restarts and remain auditable.

## Acceptance Criteria

- Versioned, application-owned migrations create an append-only normalized-event ledger and a TimescaleDB-backed one-minute-bar model, with documented migration ownership and upgrade procedure.
- Storage retains event/schema version, application event ID, instrument and venue, interval, exact OHLC/volume values, currency/units, provider/source IDs, original provider timestamp, normalized UTC times, entitlement/delay status, and ingestion time.
- Database numeric types and codecs round-trip canonical exact values without JavaScript `number` conversion or precision loss.
- Unique constraints and transactions implement P2-01 idempotency and correction rules. Duplicate redelivery changes neither the event ledger nor canonical bar state; conflicting corrections retain audit history.
- The Redis consumer acknowledges only after the required durable transaction succeeds. Database timeout, disconnect, malformed row, and constraint failure leave recoverable work and emit safe diagnostics.
- Queries for the latest AAPL/SPY bar use deterministic ordering and do not treat a future, late, or stale bar as current.
- Shutdown stops new consumption, completes or rolls back bounded in-flight transactions, and closes the PostgreSQL pool before its deadline.

## Validation

- Test fresh migrations, repeat migration checks, exact-value round trips, idempotent redelivery, correction/late ordering, transaction rollback, database outage/recovery, concurrent duplicates, and restart persistence against local TimescaleDB and Redis.

## Dependencies

- P2-07 Redis event delivery.

## Out of Scope

Do not calculate bars, indicators, profit and loss, portfolio state, signals, or retention analytics.
