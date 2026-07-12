# P3-07: Replay Signal Sessions Deterministically

## User Story

As a strategy developer, I want recorded canonical bars replayed through production signal interfaces so that the first signal and all of its evidence can be reproduced without external connections.

## Acceptance Criteria

- The immutable six-event Phase 2 recording and checksum remain unchanged. A separately versioned synthetic Phase 3 recording contains a unique canonical event catalog with enough contiguous AAPL/SPY bars for warm-up, non-fire, upward and downward fire, exact threshold equality, gap suppression, late/out-of-order historical insertion, known-gap fill, winning and losing replacements, supersession, and retraction.
- A versioned scenario schedule references the verified unique event catalog in delivery order and may reference the same event more than once to exercise duplicate or redelivery behavior. Portable recording validation continues to reject duplicate event IDs in the catalog.
- The verified replay-input manifest binds the complete named P3-01 semantic identity set plus replay catalog, schedule, and manifest versions/checksums, source metadata, expected scope, and session bounds without credentials, account data, raw provider frames, or derived output claims.
- Pre-run validation verifies every input version, checksum, scope, configuration value, catalog reference, schedule entry, and session bound before processing. Post-run validation exports the actual ordered run membership and canonical results, then compares them with the reviewed expected output checksum. Corrupt, truncated, incomplete, unsupported, or ambient-configuration-mismatched input fails explicitly.
- Replay creates an isolated signal-run target derived from the input and configuration checksums and drives the same feature, evaluation, persistence, and run-association ports used by the signal worker. It derives and verifies a session-local revision schedule through the production Phase 2 canonicalization contract or a reusable component proven by the same contract suite—not a hand-written parallel rule—under ADR 0008 precedence, including no revision for duplicates or losing replacements. It does not depend on a global canonical update that already-known Phase 2 event IDs would not produce.
- Replay windows may contain only events associated with the verified target recording. Unrelated canonical bars or evaluations already present in the database cannot enter the run or satisfy its expected membership.
- Globally known deterministic evaluations and occurrences are idempotently linked into the target run by replay target ordinal, never by the live journal cursor. The target remains open or failed after interruption and closes only after input coverage, ordered associations, counts, latest-revision projection, and output checksum verify; global row existence or an empty target cannot pass.
- Two isolated clean database targets, repeat replay into existing state, and replay after restart mid-window produce identical complete canonical output for the same ordered scenario. Equivalent correction arrival orders converge on the same latest-revision projection and non-superseded/non-retracted fired history; their append-only transition histories may legitimately differ.
- Operational journal positions/timestamps, database-generated identifiers/timestamps, worker timestamps, fencing values, and run-local generated IDs remain outside deterministic identities and canonical exports. Deterministic replay target ordinals provide output ordering, and canonical signal output is byte-identical where specified for the same ordered scenario.
- Replay opens no provider, broker, alert, AI, or execution connection and is not presented as historical backtesting or evidence that the strategy is profitable.

## Validation

- Verify the committed catalog, schedule, manifests, and checksums, then compare complete output for two isolated clean targets, an existing-state target, and an interrupted/restarted target. Compare latest-revision projections and non-superseded/non-retracted fired history, not necessarily intermediate audit rows, for correction-order variants.
- Test every input-manifest and post-run membership rejection, duplicate schedule reference, wrong-run association, sink/persistence failure, interrupted retry, bounded cleanup path, and prove all automated signal replay remains credential-free.

## Dependencies

- P3-05 canonical signal-run persistence and export.
- P3-06 production committed-bar processing ports and recovery behavior.

## Out of Scope

No provider-raw replay, historical data acquisition, backtest statistics, parameter optimization, simulated portfolio, fill model, recommendation, or broker connection is added.
