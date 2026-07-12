# Market-Data Contracts

`@daily-trader/market-data` owns the provider-neutral Phase 2 market-data model. It depends only on `@daily-trader/domain` and Node.js built-ins. Provider sockets, Redis, PostgreSQL, and observability belong to adapters and process owners outside this package.

## Phase 2 scope

- AAPL at `XNAS` and SPY at `ARCX`
- Alpaca IEX provider-supplied one-minute bars
- USD-per-share prices and share volume
- NYSE core-session classification from the immutable 2026-2028 ADR 0006 snapshot
- Application event schema `daily-trader.market-data.one-minute-bar.v1`

Provider numeric tokens must be passed in as strings before a general JSON parser can convert them to JavaScript numbers. Canonicalization removes insignificant fractional zeroes, while positivity and OHLC ordering use only the domain decimal comparator. No financial arithmetic or rounding is implemented here.

The provider-neutral adapter contract delivers at most one awaited event callback at a time and owns no event queue. A slow callback therefore applies backpressure without creating unbounded memory. Production adapters remain responsible for bounded socket shutdown and may translate a consumer failure into a classified contract error.

The process-local ordering tracker retains at most 10,000 recent event identities; PostgreSQL remains authoritative for durable duplicate and correction handling. Freshness helpers accept the validated effective threshold, defaulting to ADR 0006's 120 seconds when an application owner does not override it.

Calendar dates outside 2026-2028 are `unknown` and fail closed. The package never fetches a calendar, invents a provider sequence, fills a missing bar, connects to a provider, or performs persistence, signal, portfolio, or execution behavior.
