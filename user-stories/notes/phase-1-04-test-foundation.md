# P1-04 Implementation Note

- Status: Complete
- Completed: 2026-07-11

## What Was Implemented

Vitest is configured for co-located `*.test.ts` files with V8 coverage. ADR 0005 distinguishes current unit tests from future adapter contract, persistence integration, recorded replay, and injected-failure suites. Coverage is diagnostic and has no arbitrary percentage gate.

`@daily-trader/test-utils` supplies production-validated decimal, timestamp, instrument, money, price, and quantity fixtures; a fresh `FixedClock`; and a pure deterministic identifier helper. It owns no global counter or ambient current time.

## Validation Evidence

- The complete suite passed twice with the same 11 files and 86 tests.
- Domain tests passed independently through the workspace command.
- Tests used no network, broker credential, or live market data.
- A temporary known-failing assertion returned a nonzero status and identified the exact failure; the probe was removed.
- `npm run test:coverage` produced text, JSON summary, and HTML diagnostics.

## Handoff

Use explicit inputs and injected clocks in every time-sensitive test. Add sanitized contract fixtures only when an adapter contract exists. Replay tests should feed production interfaces and assert versioned deterministic output.
