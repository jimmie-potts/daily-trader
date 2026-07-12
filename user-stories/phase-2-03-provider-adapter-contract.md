# P2-03: Establish the Provider Adapter Contract

## User Story

As an application developer, I want a replaceable market-data adapter and deterministic test double so that provider details cannot control worker or domain behavior.

## Acceptance Criteria

- An application-owned interface defines connection, subscription, normalized-event delivery, status changes, cancellation, and bounded shutdown without exposing provider SDK types.
- Adapter errors distinguish retryable transport failures from authentication, entitlement, contract, malformed-data, and unsupported-subscription failures.
- A deterministic fake adapter can script authentication results, acknowledgements, bars, inactivity, disconnects, duplicates, gaps, late events, malformed messages, and shutdown using injected inputs and clocks.
- Sanitized fixtures cover provider control messages and AAPL/SPY one-minute bars, include provenance/sanitization guidance, and contain no real credential, account identifier, or customer data.
- A reusable contract suite verifies lifecycle ordering, cancellation, error classification, and one classification or emission for each received frame while preserving intentionally scripted provider duplicates. No event is emitted before authentication and subscription acknowledgement.
- Slow consumers cannot create unbounded in-memory buffering; the interface defines its backpressure or bounded-queue behavior.

## Validation

- Run the contract suite against the fake adapter without network access or ambient time.
- Inspect dependency direction to confirm worker/provider packages may depend on application contracts while `@daily-trader/domain` remains provider- and framework-independent.

## Dependencies

- P2-01 market-data contracts.

## Out of Scope

This story adds no external network connection, persistence, Redis delivery, or production credentials.
