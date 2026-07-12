# P2-07 Implementation Note

- Status: Implemented; integrated service validation blocked
- Implemented: 2026-07-12

## What Was Implemented

Validated events are published to Redis Stream `daily-trader.market-data.v1` with fixed fields `schema_version`, `session_id`, `event_id`, `ordering_key`, and canonical `event_json`. Persistence owns consumer group `market-data-persistence-v1`. The publisher applies approximate `MAXLEN` 10,000 retention and a bounded client queue; raw provider frames and credentials never enter Redis.

The consumer reads in batches no larger than 100, reclaims entries idle for at least 60 seconds with `XAUTOCLAIM`, validates the exact field/schema contract, and acknowledges only after its handler succeeds. Redis connection, publish, read, reclaim, acknowledgement, schema, malformed-entry, retention-gap, and shutdown failures use safe bounded error codes. IDs that Redis reports as deleted from pending state by retention cause an explicit failure. Abort is checked between entries so shutdown leaves the next item pending instead of starting another full batch.

The credential-free phase verifier supplies a unique run-scoped stream and consumer group, preserves them only between its initial and restart passes, and removes them after the restart. Production keeps the fixed stream/group names; verification cannot reclaim pending work left by another run.

## Validation Evidence

- Redis delivery passed with 1 file/10 tests; the combined delivery/persistence/status target passed with 4 files/44 tests.
- Tests cover publish encoding, exact field rejection, unsupported versions, duplicate/redelivery shape, consumer-group creation, new reads, pending reclaim, handler failure before acknowledgement, successful acknowledgement, bounded batches, and safe shutdown errors.
- Safe inspection commands and the distinction between bounded Redis transport and durable recording are documented in `infrastructure/README.md`.

## Handoff

Do not treat Redis retention as permanent recording or acknowledge before the owning durable transaction commits. The production persistence group remains fixed; replay may use only a bounded temporary group with explicit cleanup. Add a versioned migration or contract change rather than guessing unknown fields.
