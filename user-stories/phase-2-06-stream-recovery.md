# P2-06: Recover Safely from Stream Failures

## User Story

As an operator, I want explicit stream lifecycle and recovery behavior so that disconnects never look like healthy, fresh market data.

## Acceptance Criteria

- A tested connection state machine distinguishes disabled, connecting, authenticating, subscribed, reconnecting, stopped, and terminal-failure states.
- Independently modeled freshness and gap health distinguish fresh, stale, no-data, outside-session, complete, gapped, and unknown states. Inactivity and heartbeat rules use injected time and never equate transport liveness with fresh market data.
- Retryable failures use bounded exponential backoff with capped jitter and attempt limits; authentication, entitlement, and contract failures do not enter an endless retry loop.
- Reconnection resubscribes exactly once to AAPL and SPY and does not mark data fresh until a valid post-reconnect bar arrives.
- Detectable missing intervals or provider sequences are recorded as gaps. If the feed has no sequence, the system uses the approved interval/timestamp rule and never claims completeness it cannot prove.
- Duplicate, late, and out-of-order arrivals follow P2-01 semantics. No bar is fabricated and no gap is silently repaired.
- Graceful shutdown cancels timers and closes the provider connection and telemetry within bounded deadlines. Redis and PostgreSQL shutdown belong to their owning stories.
- Safe metrics cover connection state, reconnect attempts, last valid event time, freshness, gaps, and classified drops without secret or unbounded labels.

## Validation

- Use fake clocks and scripted adapters to test timeout, stale-but-connected, disconnect, retry exhaustion, resubscription, gap, duplicate, late/out-of-order, and stop-during-backoff paths.

## Dependencies

- P2-05 authenticated provider subscription.

## Out of Scope

Do not backfill gaps, invent market bars, alert users, or submit orders.
