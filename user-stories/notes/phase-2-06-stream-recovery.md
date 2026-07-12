# P2-06 Implementation Note

- Status: Complete
- Completed: 2026-07-12

## What Was Implemented

The provider-neutral connection state machine distinguishes disabled, connecting, authenticating, subscribed, reconnecting, stopped, and terminal failure. The Alpaca adapter independently tracks inactivity and valid-event delivery; transport-connected never implies data-fresh. `MarketDataStreamSupervisor` owns bounded reconnect attempts with capped exponential backoff and injected jitter, creates one adapter/socket per attempt, resets attempts after a valid event, and stops cleanly through cancellation.

The live status projection records the latest reconnect boundary and suppresses `fresh` independently for AAPL and SPY until each symbol has a valid persisted bar received after that boundary. Freshness metrics use the same gated projection and emit `no_data` for missing symbols. Terminal adapter, Redis, and PostgreSQL failures are mapped to bounded authentication, entitlement, malformed, unsupported, timeout, backpressure, transport, Redis, or database metric reasons without provider messages.

The embedded session calendar, freshness classifier, and ordering tracker distinguish fresh, stale, future, no-data, outside-session, and unknown data plus complete, gapped, and unknown interval coverage. Missing core-session minutes are recorded without inventing provider sequences, fabricating bars, or silently repairing gaps. Phase 2 metrics cover lifecycle, reconnects, age, freshness, gaps, arrivals, classified failures, and boundary results with finite labels.

## Validation Evidence

- The provider/adapter/recovery target passed with 8 files and 77 tests.
- Fake-clock and scripted tests cover inactivity, stale-but-connected behavior, disconnects, deterministic jitter/backoff, retry exhaustion, exact AAPL/SPY resubscription, per-symbol post-reconnect freshness gating, stop during retry, gaps across open and closed periods, duplicates, corrections, late/out-of-order events, and bounded metrics.
- Error and metric tests confirm no credential, event ID, session ID, provider message, or unbounded label is emitted.

## Handoff

Keep connection, freshness, session, and gap states separate. Recovery may reconnect and resubscribe only to the approved scope; it must not backfill, invent bars, or retry terminal authentication, entitlement, contract, or unsupported-subscription failures indefinitely.
