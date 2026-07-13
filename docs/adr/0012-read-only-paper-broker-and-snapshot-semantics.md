# ADR 0012: Read-Only Paper Broker and Snapshot Semantics

- Status: Accepted
- Date: 2026-07-13

## Context

Phase 4 needs a trustworthy view of a paper brokerage account without creating an execution capability. Account, position, order, and fill resources are returned by separate provider requests, so they are not one atomic broker snapshot. The adapter must also preserve unsupported holdings instead of silently narrowing the account to the AAPL/SPY market-data scope.

## Decision

Use the Alpaca paper Trading API at the exact HTTPS base URL `https://paper-api.alpaca.markets/v2` behind an application-owned read-only adapter. Paper brokerage credentials are separate from market-data credentials. Portfolio synchronization defaults to disabled and requires an explicit read-only paper mode, a complete broker credential pair, and the expected paper account identifier. Live broker settings remain rejected and execution remains disabled.

The adapter exposes only these operations:

- `GET /account`
- `GET /positions`
- `GET /orders`
- `GET /account/activities/FILL`

Only bounded documented query parameters for pagination and read filtering are permitted. The adapter has no method for submitting, replacing, canceling, or closing an order or position; changing account configuration; or calling any other broker endpoint. Redirects, a changed origin or API version, a non-HTTPS URL, and any non-GET request fail before credentials can be sent. Provider payloads remain confined to the adapter and are revalidated into application-owned contracts.

The authenticated account identifier must match the configured expected paper account before a cycle can become eligible. The application persists a stable lowercase SHA-256 fingerprint of the provider name, paper environment, and canonical account identifier as its account key; the raw account identifier remains secret configuration and is never logged or returned by diagnostics or presentation interfaces.

Each synchronization cycle reads the full account resource, the bounded complete position collection, and complete paginated collections of observed orders. Alpaca documents activity `after` as created after and `until` as created before, so both filters are exclusive and apply to activity creation time ([activity endpoint](https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1)). The returned fill object exposes a distinct `transaction_time` execution fact and does not expose `created_at` ([fill activity object](https://docs.alpaca.markets/us/docs/account-activities)). The persisted activity bounds therefore mean the open provider-created query interval `(activityWindowStartedAt, activityCutoverAt)`, not a transaction-time interval.

The adapter moves each query's exclusive lower bound one bounded overlap before the prior exclusive cutover. An activity created exactly at the seam is then eligible for the next query, and immutable fill identities deduplicate overlap. `fillsComplete` means every bounded page for that provider-created interval was read; it does not claim complete transaction-time history, a gap-free activity ledger, or full account history. The first query is labeled a bounded initial baseline. Fill `transaction_time` remains separate evidence and may fall outside the provider-created query bounds without invalidating the capture. The account is not filtered to AAPL and SPY. Every holding is retained in the normalized cycle and classified as supported or unsupported. Unsupported assets remain visible and cannot be silently discarded, coerced to a supported instrument, or assigned a zero value.

A cycle records a knowledge interval from the first request start through the final response receipt, plus each resource's provider as-of value when one exists and its local receipt time. The interval is an honest representation of separately fetched resources, not a claim that the provider supplied an atomic snapshot. Only a cycle in which all four resources were fetched completely, validated, and associated with the same expected account may be promoted as current. Empty positions, orders, or fills are valid complete collections. A partial, truncated, rate-limited, timed-out, malformed, mismatched, or canceled cycle never becomes current.

## Consequences

Phase 4 can inspect a real paper account without acquiring a broker mutation path. Separate credentials and an exact endpoint prevent the market-data or live-broker boundary from being reused accidentally. The current view may span a bounded knowledge interval; consumers must display that interval and cannot describe it as a point-in-time broker transaction.

Fetching the full account means an unsupported holding can suppress complete portfolio aggregates while remaining visible for correction. A later provider, additional resource, streaming account feed, or write operation requires a follow-up ADR and explicit authorization.

The legacy account-activities response cannot prove execution-time completeness because it omits the creation timestamp used by its filters. Presentation must label both query bounds exclusive and must not describe them as a fill execution window.
