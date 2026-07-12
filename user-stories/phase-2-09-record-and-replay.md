# P2-09: Record and Replay Market Sessions

## User Story

As a strategy developer, I want recorded normalized sessions replayed through production interfaces so that future behavior can be reproduced without a provider connection.

## Acceptance Criteria

- The append-only event ledger is the durable local replay source; Redis retention is not presented as permanent recording. A portable immutable recording can be exported from and verified against a named ledger session for clean-target and CI replay.
- The portable recording contains canonical normalized events plus a manifest identifying schema version, instruments, feed/entitlement, session bounds, event count, source metadata, configuration version, and a content checksum without credentials or complete provider control frames.
- Replay reads a named ledger session or its verified portable recording and drives the production Redis/persistence boundary with an injected clock and explicit replay speed, including an unpaced deterministic mode.
- Replay never opens a provider or broker connection and refuses unknown schema versions, invalid checksums, unsupported instruments, and incomplete recordings.
- Replaying the same recording twice produces identical event IDs, ordering classifications, canonical one-minute bars, counts, and terminal status; idempotent replay into existing state adds no duplicate result.
- Original provider/as-of times remain distinct from replay processing time.

## Validation

- Record a sanitized fixture session containing AAPL/SPY bars plus duplicate, late, out-of-order, and gap cases.
- Export and verify its portable recording, replay it twice into separate clean targets and again into existing state, then compare canonical queries and checksums byte-for-byte where serialization is specified.
- Test corrupt, truncated, and unsupported-version recordings and prove all automated replay tests are credential-free.

## Dependencies

- P2-08 durable event and bar persistence.

## Out of Scope

Signal reproduction, historical backtesting, simulated fills, and provider-raw-message reprocessing belong to later phases.
