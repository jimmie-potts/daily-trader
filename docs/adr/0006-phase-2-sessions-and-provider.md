# ADR 0006: Phase 2 Sessions and Provider Feed

- Status: Accepted
- Date: 2026-07-12

## Context

Phase 2 must distinguish expected market quiet from stale data and must expose the actual scope and entitlement of its first feed. Those meanings cannot depend on an ambient calendar lookup or silently change with provider behavior.

## Decision

Phase 2 covers only the US-equities core session. A normal session is the half-open interval `[09:30, 16:00)` in `America/New_York`; official holidays are closed and official early closes replace the normal close. Use an immutable embedded 2026-2028 session snapshot sourced from the [official NYSE hours and holidays calendar](https://www.nyse.com/trade/hours-calendars) as of 2026-07-12. There is no runtime calendar fetch or cache. Dates outside the snapshot are `unknown` and fail closed rather than being inferred from weekdays.

The only Phase 2 instruments are AAPL at `XNAS` and SPY at `ARCX`, denominated in USD. Provider-supplied one-minute bars are authoritative; trades are not aggregated into bars. The provider timestamp is the interval's inclusive left bound, and the bar end is one minute later. Bars outside the core session are classified `outside-session` and cannot become canonical current data.

Use Alpaca Market Data's IEX feed at `wss://stream.data.alpaca.markets/v2/iex`. Market-data credentials are separate from brokerage configuration. IEX is real-time single-exchange data, not a consolidated US-market feed, and that scope must be visible in status. Authenticate and subscribe only to AAPL and SPY bars, accept only provider event kind `T=b`, require the acknowledgement's bars to contain exactly AAPL and SPY, reject any reported non-bar subscription, and never fall back to another feed, endpoint, symbol, or brokerage capability. Alpaca acknowledgement variants may omit empty channel arrays and do not echo feed or delay metadata: actual feed identity is therefore constrained by the immutable IEX URL, while entitlement is established by successful authentication/subscription and explicit insufficient-subscription rejection. Status must not imply that the provider echoed metadata it did not send.

Classify a core-session bar as fresh until the validated freshness threshold after its bar end. The default is 120 seconds and the supported operator range is 60-300 seconds. The effective threshold must be passed through ingestion, persistence, status, and portable-recording metadata rather than read independently or inferred during replay. Freshness, session state, transport connection, and entitlement are independent states. Closed or outside-snapshot periods must not be reported as fresh merely because the socket is connected.

## Consequences

Tests and replay use the same embedded calendar, injected time, and recorded effective freshness threshold, including holidays and early closes. Extending calendar coverage, adding extended-hours data, changing feeds, adding instruments, or aggregating trades requires an explicit follow-up decision. Live brokerage and order execution remain out of scope.
