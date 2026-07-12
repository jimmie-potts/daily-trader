# P2-07: Deliver Normalized Events Through Redis Streams

## User Story

As a downstream consumer, I want normalized bars delivered with explicit at-least-once semantics so that restarts and duplicate delivery do not corrupt application state.

## Acceptance Criteria

- A versioned Redis Stream contract defines stream and consumer-group ownership, field encoding, event and ordering keys, acknowledgement rules, pending-entry recovery, retention, and bounded backpressure.
- Only validated application-owned events are published; raw provider payloads and credentials never enter Redis.
- The production worker routes every accepted normalized provider event through the publisher while fixture-driven tests can exercise the same boundary offline.
- Publisher and consumer behavior follows P2-01 rules for duplicates, gaps, corrections, late events, and out-of-order events.
- Consumers are idempotent by application event identity; a crash after processing but before acknowledgement can redeliver without changing the canonical result.
- Redis connection, command, acknowledgement, malformed-entry, and shutdown failures are bounded, observable, and never treated as successful delivery.
- Shutdown stops intake, drains or explicitly abandons bounded work according to the contract, and closes Redis resources before its deadline.
- Stream schema version incompatibility fails explicitly rather than being guessed or silently discarded.
- Local setup and inspection commands are documented without destructive reset as an implicit step.

## Validation

- Integration-test publish/consume, duplicate delivery, crash-before-ack recovery, pending-entry reclaim, ordering cases, retention, unsupported versions, Redis restart, and Redis unavailable behavior against the pinned local service.
- Confirm metric labels are bounded and stream entries contain no provider frame or secret.

## Dependencies

- P2-01 delivery semantics.
- P2-04 normalized bar events.
- P2-06 production stream lifecycle.

## Out of Scope

Redis is transport, not the durable replay authority. Do not introduce Kafka, signals, portfolio events, or order events.
