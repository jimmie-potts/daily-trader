# ADR 0003: Local State and Event Delivery

- Status: Accepted
- Date: 2026-07-11

## Context

The application needs durable state, time-series support, and an event transport without premature distributed-system complexity.

## Decision

Use PostgreSQL 17 with TimescaleDB for durable application state and time-series data. Use Redis Streams for local event transport. Treat delivery as at-least-once: consumers must be idempotent and explicitly handle duplicates, gaps, late events, and out-of-order events. Durable decision records remain append-only.

Do not introduce Kafka or Redpanda without measured throughput or durability requirements and a new ADR. Phase 1 provisions healthy local services only; schemas and stream contracts arrive with the feature that owns them.

## Consequences

Local service versions are pinned and upgrades are intentional. Later ingestion work must define event identifiers, ordering keys, acknowledgements, retention, and replay semantics before publishing production events.
