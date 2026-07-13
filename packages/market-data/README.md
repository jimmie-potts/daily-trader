# Market-Data Contracts

`@daily-trader/market-data` owns the provider-neutral market-data model and the Phase 3 canonical-revision handoff contract. It depends only on `@daily-trader/domain` and Node.js built-ins. Provider sockets, Redis, PostgreSQL, signal behavior, and observability belong to adapters and process owners outside this package.

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

## Phase 3 canonical revisions

Schema `daily-trader.market-data.canonical-revision.v1` describes only committed changes to a logical canonical bar. An `insert` has no previous canonical event; a `replace` names distinct previous and new event IDs. Duplicates, losing replacement candidates, and noncanonical events are explicit no-op decisions and do not receive a journal position or revision identity.

The deterministic revision ID covers the schema, operation, logical bar key, previous and new canonical event IDs, market-event schema, and immutable arrival/gap metadata. Arrival metadata includes the durable `accepted`, `correction`, or `out_of_order` classification plus historical and derived out-of-order flags. Gap metadata includes the durable `complete`, `gapped`, or `unknown` state plus the known-gap-fill flag. The positive PostgreSQL `BIGINT` processing position is exposed as canonical decimal text so it is never coerced through a JavaScript number. It orders durable work but is excluded from revision identity and later global feature or signal identity.

The pure canonical transition decider applies the exact Phase 2 `(receivedAt, eventId)` precedence to a current canonical event and an eligible candidate. It returns immutable, position-free insert/replace material or an explicit duplicate, losing-replacement, or noncanonical no-op. Live ingestion and replay through the production persistence path therefore share one precedence rule.

Constructors validate supported AAPL/SPY one-minute logical keys, event IDs, operation invariants, metadata combinations, and schema versions. Canonical serialization is fixed-order and all returned contracts are immutable. The data-quality policy and embedded calendar identities are exported from this package so signal configuration and replay do not duplicate market-data semantic literals.
