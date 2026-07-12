# P2-02: Add Safe Paper-Feed Configuration

## User Story

As an operator, I want validated market-feed configuration that is separate from brokerage execution so that the worker cannot silently broaden its access or leak credentials.

## Acceptance Criteria

- `@daily-trader/config` owns a frozen market-data configuration with an execution-free default mode and an explicit paper-feed mode.
- Paper-feed URL, credential pair, feed selection, AAPL/SPY subscriptions, connection timeout, inactivity timeout, freshness threshold, and bounded reconnect settings are parsed once with documented limits.
- Paper mode rejects missing credential halves, insecure or unsupported endpoints, additional symbols, unsupported feeds, and invalid timeout/backoff combinations before opening a socket.
- Existing invariants remain: broker mode is paper, execution is disabled, and all `LIVE_BROKER_*` settings are rejected.
- Safe diagnostics report only whether credentials are configured, selected symbols, requested feed, and nonsecret bounds. Values, account identifiers, authorization headers, and complete URLs are never emitted.
- `.env.example`, configuration tests, and contributor documentation explain credential-free fixture/replay use and the separately gated provider mode.

## Validation

- Test safe defaults, valid paper settings, every rejected combination, immutability, and diagnostic redaction with recognizable secret values.
- Prove invalid configuration fails before provider, Redis, or database connection attempts.

## Dependencies

- P2-01 market-data contracts and operating semantics.

## Out of Scope

Do not connect to a provider, enable broker account access, introduce live-broker configuration, or make credentials a CI requirement.
