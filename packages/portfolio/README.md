# `@daily-trader/portfolio`

Pure, provider- and persistence-independent Phase 4 paper-portfolio behavior.

The package validates normalized read-only Alpaca paper-account observations,
hashes provider identifiers before they enter application-owned contracts,
constructs deterministic canonical snapshots, calculates exact portfolio
projections, classifies snapshot changes, and verifies prepared local projection
integrity. Snapshot delta (`baseline`, `changed`, or `unchanged`) is deliberately
separate from reconciliation (`converged`, `drift`, or `unavailable`). It has no
HTTP, PostgreSQL, web, alert, order-submission, or execution capability.

## Exact arithmetic

Financial inputs and results remain canonical decimal strings. The isolated
`big.js` wrapper accepts at most 48 significant digits and 18 fractional digits.
Addition, subtraction, and absolute value are exact. Percentage division
multiplies by 100 and rounds once, half-even, to at most six fractional digits.
It never accepts JavaScript numbers or silently clamps an overflow.

## Valuation boundary

Position prices are explicitly broker marks observed during a bounded capture
interval. They are not Phase 2 IEX bars, exchange quotes, or authoritative
exchange timestamps. Aggregate P&L, allocation, concentration, and exposure are
withheld when any holding is unsupported or lacks required valuation fields;
missing data is never replaced with zero. Account currency is retained even
when it is unsupported; only complete USD projections are calculated. Position
allocation uses absolute signed broker market value divided by gross exposure,
and an empty portfolio reports unavailable concentration rather than zero.

Provider account, asset, client-order, order, fill, and request identifiers are
represented only by lowercase SHA-256 fingerprints in fixed kind-separated
Alpaca paper namespaces. Raw identifiers, credentials, account numbers, and
provider payloads do not belong in these contracts. Stored canonical snapshots
can be parsed only by exact-shape, constructor-backed validation that rechecks
all nested identities and byte-stable serialization.

Explicit multi-leg parent orders may lack a singular symbol, asset class, or
side. Those provider facts remain null with no inferred instrument and carry
`unsupported_order_structure`; concrete child-leg identity remains intact.
Nested containment supplies canonical `orderClass: mleg` even when a child
reports simple or empty class, while an omitted child order type remains null.
New snapshot/order observations use schema v2 for this structural model. The
reader still validates and restores legacy v1 bytes and identities without
allowing v2-only nullability or support reasons into legacy observations.

## Fill activity coverage

Alpaca applies the activity `after` and `until` filters to activity creation
time, with both bounds exclusive. Its fill object exposes the separate
`transaction_time` execution fact but does not expose the creation timestamp.
Snapshot coverage therefore records the open provider-created query interval
`(activityWindowStartedAt, activityCutoverAt)` and whether every page for that
query was read. `PortfolioFillObservation.transactionAt` is preserved
independently and is not validated against those query bounds.

The adapter queries with a bounded overlap before the prior cutover so an
activity created exactly at the seam is eligible for the next cycle; immutable
fill identities deduplicate overlap. This is complete pagination for one
bounded provider query, not complete transaction-time history, a gap-free
activity ledger, or full account history.
