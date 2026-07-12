# ADR 0008: Market-Data Delivery, Persistence, and Replay

- Status: Accepted
- Date: 2026-07-12

## Context

Phase 2 needs bounded at-least-once transport, durable audit history, deterministic canonical bars, and portable replay without treating Redis as permanent storage.

## Decision

Publish validated events to Redis Stream `daily-trader.market-data.v1`. The persistence owner uses consumer group `market-data-persistence-v1`. Each entry has the fixed UTF-8 fields `schema_version`, `session_id`, `event_id`, `ordering_key`, and `event_json`; `event_json` is the canonical application event and contains no raw provider frame or credential. Reject unsupported field or schema versions.

Apply approximate `MAXLEN` retention of 10,000 entries. Recover pending work with `XAUTOCLAIM` after 60 seconds of idle time in batches no larger than 100. If Redis reports pending IDs deleted by retention, fail with an explicit retention-gap outcome. A consumer acknowledges an entry only after its required PostgreSQL transaction commits. A crash, timeout, rollback, or unavailable dependency leaves the entry recoverable; delivery failures and trimming-related gaps are explicit operational failures.

PostgreSQL/TimescaleDB owns the durable append-only normalized-event ledger and deterministic canonical one-minute-bar state. Event ID uniqueness makes redelivery idempotent. A session-event association table lets the same global event identity belong to source and replay sessions without copying the ledger row. Transactions take a market-series advisory lock before duplicate/correction classification, so concurrent duplicates and corrections cannot both make an unlocked decision. A correction appends its distinct event to the ledger; the eligible event with the greatest `(receivedAt, eventId)` tuple is canonical for its logical ordering key, so replay order and processing time cannot change the result. Prior versions remain queryable. Exact OHLC and volume values use PostgreSQL `NUMERIC` with text-only application codecs and are revalidated as canonical decimal strings without conversion through JavaScript `number`.

A named ledger session can be exported as immutable canonical JSON containing a versioned manifest and ordered normalized events. The manifest records scope, source metadata, and the effective freshness threshold; a lowercase SHA-256 checksum covers the canonical recording bytes with the checksum field omitted. Exported recordings contain no credential or complete provider control frame.

Replay first verifies schema, scope, effective threshold, and checksum, then sends the recorded normalized events through the production Redis and persistence boundary using an injected clock and explicit pacing, including unpaced mode. Replay uses an isolated, temporary consumer group created at the stream tail, persists each published entry before publishing the next, and destroys the group during bounded cleanup; it therefore cannot lose entries to the normal persistence consumer or outrun bounded stream retention. Its deterministic target session is derived from the recording checksum. A failed replay leaves that session open for safe retry, while successful repeated replay links the same global event identities without duplicate ledger rows. Replay never opens a provider or broker connection.

## Consequences

Redis is bounded transport, not the replay authority; PostgreSQL and verified portable recordings provide durability. Consumers must monitor pending entries, retention pressure, delivery failures, and ledger gaps. Raw-provider replay, signals, backtesting, portfolio state, brokers, Kafka, and live execution remain out of scope.
