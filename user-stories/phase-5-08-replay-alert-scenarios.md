# P5-08: Replay Alert Scenarios

## User Story

As a contributor, I want credential-free deterministic alert replay and restart scenarios so that alert identity, corrections, portfolio context, and user disposition can be reproduced without relying on a naturally occurring live signal.

## Acceptance Criteria

- A separately versioned Phase 5 recording extends the verified Phase 3 signal scenario through production alert composition and persistence ports. It does not alter the immutable Phase 2 or Phase 3 recording artifacts.
- The recording includes pre-start backlog, a completed source ordinal with zero transitions, eligible fire, non-fire and suppression, supersession, retraction, reactivation, repeated corrections, a fired correction for a no-alert lineage, duplicate transitions, disable/re-enable boundaries, and held, not-held, unknown, stale, latest-attempt failure with reconciliation unavailable, incomplete, unsupported, and unavailable context dimensions.
- Catalog, schedule, configuration, context fixtures, manifest, and expected ordered alert output have stable checksums. Verification rejects any mismatch before persistence.
- Equivalent ordered input produces the same global lineage/revision identities and normalized canonical alert content in clean, existing-state, repeated, and interrupted/restarted targets. Each named replay target retains its own instance/context/run associations; comparisons exclude those target-local identifiers while verifying their internal stability and isolation.
- User dispositions are replay-testable as a separate append-only command schedule covering allowed changes, no-op, exact retry, same-key mismatch, stale/concurrent versions, and correction preservation.
- Replay targets are isolated from live alert status and cannot close merely because global deterministic rows already exist. Inspection requires an explicit target and is unmistakably labeled replay.
- Root `alert:recording:verify`, `alert:replay`, and `alert:replay:inspect -- <target-id>` commands verify and inspect the isolated artifacts without becoming live worker commands.
- Replay makes no profitability, strategy-success, risk, recommendation, or performance claim and opens no provider, broker, external notification, or AI connection.

## Validation

- Verify recording checksums, two clean targets, repeat into existing state, pre-watermark exclusion, captured-debt restart, disabled-gap exclusion, duplicate input, exact interrupted-prefix preservation, every correction-table row and context combination, action schedule, byte-stable current projection, and expected output checksum.
- Prove replay cannot mutate live current pointers, broker observations, signal history, portfolio projections, alert live status, or credentials.

## Dependencies

- P5-04 append-only alert persistence.
- P5-05 durable signal-alert processing.

## Out of Scope

Do not add historical strategy backtesting, market simulation, profit-and-loss evaluation, live provider validation, or execution.
