# P3-03: Build Deterministic Feature Windows

## User Story

As a signal developer, I want bounded rolling features derived from eligible canonical bars so that the rule never uses future, missing, or silently substituted data.

## Acceptance Criteria

- A pure application-owned feature engine consumes an ordered bootstrap of committed canonical one-minute bars and the durable canonical revisions defined by P3-01. It receives no provider payload, Redis envelope, mutable database row, or ambient wall clock.
- Every distinct canonical evaluation-bar revision produces one deterministic feature-result identity: either a `ready` snapshot or a bounded `suppressed` reason. Repeating the pure calculation produces the same result; durable idempotency belongs to P3-05.
- The canonical `observationAsOf` is the winning evaluation bar event's recorded `receivedAt`, not the time the signal worker happens to process it. Worker lag is operational health and cannot change a fired, non-fired, or suppressed outcome.
- Inputs are ordered by instrument and normalized bar time. The evaluation bar and every bar after it are excluded from the shared reference window, including during retrospective recomputation when later bars already exist.
- Windows are isolated per instrument and known NYSE core session. They reset only at exchange-session boundaries—not at market-data ingestion-session, signal-run, worker-restart, or replay boundaries—and never cross an overnight period, holiday, early close, extended-hours interval, or unknown calendar date.
- A ready snapshot records the prior range high and low, exact prior volume sum and count, shared window bounds, role and ordinal for every evidence event ID, evaluation bar, observation-as-of and knowledge-as-of values, on-time or retrospective mode, source/feed/entitlement, and every semantic version needed by P3-01 without a rounded average.
- Contiguity is derived from canonical event timestamps and the versioned calendar, not Phase 2's arrival-time gap flag. Prior bars are judged by their persisted canonical identity, event-time eligibility, and contiguity; they are never dynamically reclassified as stale against a later worker or replay clock.
- On-time mode requires the evaluation event to satisfy the recorded freshness policy and every current evidence event to have been received no later than `observationAsOf`. `knowledgeAsOf` is the maximum immutable `receivedAt` across the current evaluation bar and current evidence, so a later historical insert or winning canonical replacement can produce a retrospective result without depending on revision arrival order. Triggering revision, arrival classification, and later worker time remain run/audit or health metadata, not global feature identity inputs.
- Insufficient warm-up, a missing interval, an evaluation bar whose end is future relative to `observationAsOf`, and a zero or unusable volume baseline yield explicit suppression rather than a partial window, zero fill, or fabricated value. Outside-session or unknown-calendar events cannot be canonical under Phase 2; encountering one is an invariant failure, not a synthetic signal evaluation.
- Every canonical insert or winning replacement identifies the bounded set of affected feature results in event time; arrival/gap metadata distinguishes forward inserts from historical or gap-filling inserts. A historical arrival is incorporated into retrospective results but cannot create an on-time result merely because it arrived later. Duplicates and losing replacements identify no affected result.
- In-memory state has a documented maximum per instrument, can be rebuilt purely from an ordered canonical bootstrap plus revisions, and never becomes the source of audit truth.
- IEX price and volume evidence remains labeled as real-time single-exchange data, not consolidated-market activity.

## Validation

- Use synthetic canonical bars to test warm-up boundaries, exact shared-window membership, both symbols, early close, exchange-session reset, holidays, unknown dates, gaps, future-as-of input, worker-lag independence, historical inserts and gap fills, duplicate delivery, zero volume, replacement fan-out, pure bootstrap rebuild, and maximum state bounds.
- Add property or table-driven tests proving the evaluation bar and later bars never enter its reference window, the same ordered revision history is reproducible, and different valid transition histories that converge on the same canonical bars converge on the same final feature projection.

## Dependencies

- P3-01 signal contracts and data-quality semantics.
- P3-02 immutable signal configuration.

## Out of Scope

Do not decide whether the signal fires, persist an occurrence, aggregate trades, backfill gaps, adjust for corporate actions, or calculate cross-session features.
