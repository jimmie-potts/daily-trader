# P1-04: Establish Deterministic Testing

## User Story

As a developer, I want a shared testing foundation so that financial and event-driven behavior can be verified deterministically as it is introduced.

## Acceptance Criteria

- An ADR or documented decision identifies the test runner and test-file naming convention.
- Root and workspace commands run unit tests once and in watch mode where supported.
- Tests use an injected clock and explicit fixtures for time-sensitive behavior.
- Shared helpers make timestamps, identifiers, and exact decimal values readable without introducing global mutable state.
- Coverage reporting is available, but no arbitrary percentage is treated as a substitute for risk-based tests.
- At least one meaningful domain test proves the test pipeline, and a failing assertion returns a nonzero exit status.
- Guidance distinguishes future unit, contract, integration, replay, and failure tests.

## Validation

- Run the complete unit-test command twice and confirm identical results.
- Run domain tests independently.
- Confirm tests require no network access, broker credentials, or live market data.

## Out of Scope

Do not add fabricated provider payloads, database integration tests, strategy backtests, or replay behavior before their production interfaces exist.
