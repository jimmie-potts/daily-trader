# P1-02: Create the Shared Domain Package

## User Story

As a developer, I want application-owned domain primitives so that later adapters and services do not leak vendor-specific types into core logic.

## Acceptance Criteria

- A shared domain workspace builds independently and has no dependency on Next.js, Fastify, Redis, database clients, or provider SDKs.
- Initial primitives represent instrument identity, UTC timestamps, currencies, and explicitly unit-bearing values without using JavaScript floating point for exact financial values.
- Invalid values are rejected through explicit constructors or validation functions rather than silently coerced or defaulted to zero.
- Time-dependent behavior can receive an injected clock; domain modules do not scatter direct wall-clock access.
- Public types and non-obvious numeric or rounding assumptions are documented.
- Unit tests cover valid construction, invalid inputs, and serialization boundaries.

## Validation

- Build and test the domain workspace in isolation.
- Confirm the exported API contains only application-owned types.
- Search production domain code for forbidden framework and provider imports.

## Out of Scope

Do not implement portfolio calculations, market-event schemas, signal rules, risk rules, `OrderIntent`, `Order`, or provider adapters in this story.
