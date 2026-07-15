# P5-04: Persist Alert History and Actions

## User Story

As an operator, I want alert evidence, corrections, and my local review actions preserved append-only so that the dashboard can recover an auditable current view without deleting or rewriting history.

## Acceptance Criteria

- A new checksum-protected migration adds global alert lineages/revisions, target-local instances and run associations, immutable ordered evidence, source dispositions, alert-run start/stop watermarks, database-clock worker leases with monotonically increasing fence tokens, durable context claims, revision-validity transitions, user-disposition command outcomes/events, a durable scalar source cursor, current feed projections, and bounded worker status without rewriting earlier migrations.
- Database constraints enforce global versus target-local identity ownership, one ordered source effect per completed Phase 3 source ordinal/transition, valid correction relationships, immutable evidence, accepted revision/lineage/disposition states, and append-only lifecycle history.
- The first successfully committed source receipt snapshots Phase 4's current pointer and freezes either a terminal `completed`, fully validated, complete-membership, converged selection or an explicit unavailable claim with `contextSelectedAt`. Alert-effect retry always reuses that target-local claim. Cursor advancement, revisions, evidence, and all effects for the completed source ordinal then commit atomically; a crash never leaves a partial current alert or permits context reselection after a durable claim.
- Every live context-claim, source-disposition, alert-effect, cursor, and worker-status write requires the current owner identity, fence token, and unexpired database-time lease for that target/run. Acquire, renew, expiry, and reclaim are atomic; reclaim increments the fence; lease loss rolls work back; and a stale owner cannot commit after pause or replacement. Replay ownership uses a separate target namespace and cannot mutate the live owner or projection.
- Acknowledge and dismiss persist each well-formed command outcome under unique `(alertInstanceId, commandId)`. Exact retry returns that outcome plus a separately read latest projection; same-ID/different-input and stale expected versions conflict; same-current-state is a successful no-op; allowed later state changes append one event and increment only the disposition version. No action returns to `new` or changes signal evidence, revision validity, context, or broker state.
- Current feed and detail projections are derived deterministically from append-only history. Corrections may change revision validity and the current lineage projection while preserving user disposition and every prior revision.
- Historical alert, evidence, transition, context, and action records cannot be updated or deleted through application roles. Retention or archival is not introduced in the MVP.
- Exact values remain canonical strings, timestamps remain UTC, database identifiers remain internal, and credentials, raw account identifiers, provider payloads, and unbounded user text are never stored in alert tables.

## Validation

- Integration-test clean and seeded migration, checksum reruns, global/target identity collisions and isolation, activation/stop watermarks, pre-watermark backlog exclusion, zero-transition completed ordinals, database-clock lease acquire/renew/expiry/reclaim, monotonic fencing, stale-owner commit rejection for every fenced write class, replay/live ownership isolation, source receipt and terminal-selection context-claim rollback/commit boundaries, alert creation, the complete correction table, acknowledgement/dismissal state changes and no-ops, exact retry after later state change, command-key reuse, stale/concurrent versions, duplicate source work, concurrent claims, current projections, restart recovery, immutable rows, invalid states, and every orthogonal context combination.
- Inspect schema privileges, constraints, queries, and logs for destructive paths, unsafe values, secrets, provider types, broker methods, or accidental mutation of Phase 2 through Phase 4 evidence.

## Dependencies

- P5-01 alert contracts and accepted decisions.
- P5-03 deterministic alert composition.

## Out of Scope

Do not add an API or dashboard, purge history, create remote user identities, calculate risk, or persist an order or approval.
