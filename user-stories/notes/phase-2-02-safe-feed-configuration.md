# P2-02 Implementation Note

- Status: Complete
- Completed: 2026-07-12

## What Was Implemented

`@daily-trader/config` now owns a frozen market-data configuration. Its default mode is `disabled`; explicit `paper` mode requires a complete market-data credential pair and fixes the provider, feed, endpoint, and subscription to Alpaca IEX AAPL/SPY bars. Connection, inactivity, freshness, shutdown, queue, retry, backoff, and jitter bounds are validated together before a connector can be created.

Market-data credentials are separate from paper-broker configuration. Live broker settings remain rejected and execution remains disabled. `.env.example` documents credential-free fixture/replay operation and the separately gated provider mode. Safe diagnostics report only bounded nonsecret settings and whether credentials are configured; they omit the WebSocket URL and credential values.

## Validation Evidence

- The targeted configuration suite passed with 1 file and 47 tests.
- Tests cover disabled defaults, valid paper settings, exact frozen scope, credential pairing, unsupported provider/feed/symbol/endpoint rejection, cross-field timeout and retry bounds, failure before connector creation, diagnostics, and recognizable-secret redaction.
- Normal CI, migration, fixture verification, replay, and terminal-status paths require no market-data credential.

## Handoff

Read market-data settings only through `loadConfig`; do not read `process.env` inside adapters. Never reuse brokerage credentials, accept an arbitrary endpoint, silently reorder or broaden symbols, or introduce a live market-data mode without a separately accepted scope.
