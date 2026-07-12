# P2-05: Connect and Subscribe to the Paper-Compatible Feed

## User Story

As an operator, I want the terminal worker to authenticate and subscribe to AAPL and SPY so that it receives provider-supplied one-minute bars from the configured paper-compatible feed.

## Acceptance Criteria

- The initial adapter uses the provider selected by ADR 0004 behind the P2-03 interface; provider dependencies remain isolated to that adapter.
- After configuration validation, the worker opens one bounded WebSocket session, authenticates, and subscribes only to the approved AAPL/SPY one-minute-bar channels.
- Subscription acknowledgement, actual feed identity, entitlement/delay status, and provider timestamps are validated before bars are accepted.
- Authentication, entitlement, protocol, subscription, and connection-timeout failures produce classified safe status without fallback to another feed, endpoint, symbol, or live brokerage capability.
- Credentials, authorization frames, and complete provider messages are neither logged nor attached to traces.
- Cancellation and process signals close the socket and telemetry cleanly within a documented deadline.

## Validation

- Use a controlled fake WebSocket to test authentication order, exact subscription scope, success, rejection, timeout, cancellation, and payload redaction.
- Run a separately documented, credential-gated AAPL/SPY smoke session. Record only sanitized status and event metadata; normal CI remains offline.

## Dependencies

- P2-02 safe feed configuration.
- P2-04 provider-bar normalization.

## Out of Scope

Reconnect policy, database/Redis work, broker account access, extra event types, extra symbols, and trading are excluded.
