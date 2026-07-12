# ADR 0004: Paper Provider Boundary

- Status: Accepted
- Date: 2026-07-11

## Context

The first vertical slice needs paper-compatible market data, while provider replacement and safe failure are core requirements.

## Decision

Use Alpaca's paper environment as the initial candidate behind application-owned provider interfaces. Phase 1 adds no SDK, credential, connection, or provider payload. Phase 2 must validate entitlements and timestamps at an adapter boundary and retain source identifiers and as-of times.

Live brokerage configuration and unattended execution remain disabled and out of scope. A future provider change should primarily affect its adapter and configuration.

## Consequences

No domain package may import provider SDK types. Tests will use sanitized fixtures only after adapter contracts exist. Live access requires a separate explicit decision and scope.
