# P1-06: Provide Local PostgreSQL and Redis Services

## User Story

As a developer, I want reproducible local data services so that later persistence and event-delivery work can be built against known dependencies.

## Acceptance Criteria

- Docker Compose defines pinned PostgreSQL with TimescaleDB and Redis versions suitable for local development.
- Services bind only as needed for local access, use non-production sample credentials, persist data in named volumes, and include health checks.
- Startup order depends on health rather than fixed sleeps.
- A documented reset procedure is explicit about deleting local data and is never run implicitly.
- Minimal smoke checks prove the application can connect to each service through application-owned configuration.
- Connection failures are bounded, observable, and do not expose credentials in logs.
- No production infrastructure, broker service, Kafka, or Redpanda is introduced.

## Validation

- Start the services from a clean local environment and wait for healthy status.
- Run the connection smoke checks, restart the services, and verify recovery.
- Stop the stack without deleting volumes, then verify the documented destructive reset separately and intentionally.

## Dependencies

Requires the validated configuration from P1-05. Database schemas, migrations, and Redis stream semantics should be added with the first feature that owns them, backed by an ADR where required.
