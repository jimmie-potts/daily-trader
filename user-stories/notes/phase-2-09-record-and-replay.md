# P2-09 Implementation Note

- Status: Implemented; integrated service validation blocked
- Implemented: 2026-07-12

## What Was Implemented

The append-only PostgreSQL ledger can export a named session through its session-event links as portable format `daily-trader.market-data.recording.v1`. The canonical JSON manifest records event schema, source session, AAPL/XNAS and SPY/ARCX scope, Alpaca IEX real-time/zero-delay metadata, session bounds, count, configuration version, effective freshness threshold, source provenance, and a lowercase SHA-256 checksum calculated with the checksum field omitted.

`synthetic-aapl-spy-session-v1.json` is a checked-in immutable fixture containing invented canonical events, an AAPL gap, correction, and out-of-order case. It contains no market fact, credential, account identifier, raw provider payload, or control frame. Verification rejects malformed/noncanonical content, unknown versions, wrong scope, incomplete instruments, duplicate IDs, invalid bounds/counts/thresholds, and checksum changes. Replay accepts only the branded verified result, preserves original IDs and source times, supports injected paced or unpaced operation, and publishes production-shaped canonical fields through the application sink without opening a provider or broker.

The service-backed replay command derives a stable target session from the checksum, uses a per-run consumer group isolated from the normal persistence consumer, and persists each entry before publishing the next. Its session lifecycle uses an injected application clock, while paced replay uses an injected sleeper and explicit speed; unpaced replay has no ambient-time dependency. Success closes the target and removes the temporary group; failure leaves the session open for retry and still attempts bounded group/resource cleanup. The phase verifier goes further by using a unique run-scoped Redis stream/group across its initial and restart passes and deleting both after the restart. Global event IDs are linked into the target session, so repeated replay cannot claim success for an empty session or create duplicate ledger rows.

## Validation Evidence

- The replay target passed with 2 files and 23 tests.
- Tests verify the committed checksum and exact canonical bytes, export from ordered ledger events, gap/correction/out-of-order fixture coverage, corrupt/truncated/unsupported/wrong-scope/incomplete/noncanonical rejection, byte-identical replay into two separate clean targets and existing state, injected clock/pacing, and safe sink/sleeper failures. The service verifier uses the same two-clean-target comparison before its restart pass.
- All replay tests are credential-free and perform no provider or broker connection.

## Handoff

Run `npm run market-data:recording:verify` before `npm run market-data:replay`. Only a verified portable recording may cross the replay boundary. Regenerate the fixture through the exporter and review its checksum/provenance intentionally when the format or event schema changes.
