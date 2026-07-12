# P1-02 Implementation Note

- Status: Complete
- Completed: 2026-07-11

## What Was Implemented

`@daily-trader/domain` defines validated, immutable application-owned primitives for instrument identity, UTC millisecond timestamps, uppercase currency codes, canonical exact decimal strings, and unit-bearing `Money`, `Price`, and `Quantity`. `Clock` and `FixedClock` make time explicit and replayable.

Exact financial values accept strings only. They reject whitespace, exponent notation, leading zeroes, trailing fractional zeroes, negative zero, and JavaScript numbers. Phase 1 deliberately provides no arithmetic; ADR 0002 and `packages/domain/README.md` require a later decision for decimal arithmetic, precision, and rounding.

## Validation Evidence

- Isolated domain type checking, tests, and build passed.
- Tests cover construction, invalid inputs, immutability, JSON serialization without precision loss, real UTC calendar validation, and fixed-clock determinism.
- Source inspection found no Next.js, Fastify, Redis, database, OpenTelemetry, or provider dependency and no direct wall-clock access.

## Handoff

Revalidate decoded external data through constructors. Do not cast raw strings to branded types. Later market-event types should reuse `InstrumentId` and `UtcTimestamp`; financial calculations must wait for the reviewed decimal/rounding ADR.
