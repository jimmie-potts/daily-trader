# P2-10 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

The terminal-status layer defines a read-only repository query for latest persisted canonical AAPL/SPY events plus Redis delivery and PostgreSQL persistence health. An injected clock and session calendar build a pure deterministic model in stable AAPL-then-SPY order. Present rows are explicitly labeled `BAR CLOSE`, never quote, and show exact close/currency/unit, normalized bar and as-of times, original provider timestamp, receive time, signed age, freshness, arrival timeliness, provider/feed, entitlement, and delay milliseconds.

Missing data remains missing without zero-fill or symbol substitution. The separate overall line reports provider connection lifecycle, the last successful arrival from the full append-only ledger rather than only the latest two bars, gap state, Redis delivery, and PostgreSQL persistence. A presentation-owned source row supports delayed-data rendering without changing the current canonical IEX real-time/zero-delay event contract.

## Validation Evidence

- The targeted status suite passed with 1 file and 15 tests.
- Assertions cover fresh, stale, future, delayed, late, gapped, disconnected, reconnecting, closed-market, unknown-calendar, no-data, partial AAPL/SPY, degraded/unavailable dependencies, deterministic output, and mismatched repository slots.
- Tests prove rendered output excludes recognizable secrets, raw payload fields, event IDs, unused OHLC values, and volume.
- Sanitized service replay: **Pass** — the initial and post-restart verifier passes rendered byte-identical status for persisted AAPL/SPY bars with healthy Redis/PostgreSQL state.
- Credential-gated provider boundary on 2026-07-13: **Pass** — `node --env-file=dev.env workers/market-data/dist/provider-smoke.js` authenticated and subscribed to exact AAPL/SPY bars on Alpaca IEX, reported the configured real-time single-exchange entitlement truthfully, observed normalized one-minute AAPL/XNAS and SPY/ARCX bars at 17:18Z, and shut down cleanly. This evidence validates the live input and source-status boundary without implying that the provider echoed feed metadata or that the smoke persisted a separate status projection.

## Handoff

Terminal status is a projection, not a source of truth. Query canonical persisted events, preserve AAPL/SPY ordering, keep transport and freshness independent, and never relabel delayed data as real-time or a one-minute close as a quote.
