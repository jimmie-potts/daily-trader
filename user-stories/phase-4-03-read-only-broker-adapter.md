# P4-03: Implement the Read-Only Paper Broker Adapter

## User Story

As a portfolio developer, I want a replaceable GET-only paper broker adapter so that account observations can be fetched without exposing an order or position mutation capability.

## Acceptance Criteria

- An application-owned adapter port exposes only reads for account, positions, orders, and fill activities. The Alpaca implementation calls exactly `GET /account`, `GET /positions`, `GET /orders`, and `GET /account/activities/FILL` under the ADR 0012 base URL.
- The adapter interface has no generic request escape hatch and no method for submit, replace, cancel, cancel-all, close-position, close-all, account configuration, watchlist mutation, or any other broker operation. Runtime request construction rejects every method other than GET.
- The HTTP transport is injected behind a small boundary, sends credentials only to the exact approved HTTPS origin, rejects redirects, bounds response bytes and pages, honors cancellation and deadlines, and closes resources within the configured shutdown deadline.
- Account, the bounded position collection, and complete order/fill pagination are read with bounded documented filters. Empty collections are valid. A repeated page, cursor loop, missing continuation, excess page count, truncation, rate limit, timeout, authentication failure, account mismatch, malformed response, or unavailable provider produces a typed non-sensitive failure rather than a partial success.
- Fill page completeness is scoped to the persisted open provider-created interval `(after, until)`. Alpaca applies both bounds exclusively to activity creation time while the returned fill exposes a separate execution timestamp and no creation timestamp. The first query is labeled a bounded baseline rather than full account history; later queries move the lower bound before the prior cutover, deduplicate immutable fill identities, keep an activity created exactly at the seam eligible, and never turn an incomplete query into an absence claim. This is not transaction-time completeness or a gap-free activity ledger.
- Provider response types remain private to the adapter. The adapter returns untrusted resource envelopes for P4-04 normalization and never converts exact numeric text through JavaScript `number`.
- One deterministic fake implements the same port for credential-free unit, worker, persistence, API, dashboard, and verification tests. Sanitized fixtures contain no real credential, account identifier, order identifier, fill identifier, or complete production payload.
- Observability records bounded operation, outcome, latency, retry/rate-limit classification, and page count without URL, query values, credentials, account identifiers, provider source IDs, or payloads.

## Validation

- Run a shared contract suite against the deterministic fake and Alpaca adapter harness for all four reads, empty resources, pagination, exclusive created-at boundaries, created-at-versus-transaction-time divergence, retries, cancellation, shutdown, malformed data, response limits, redirects, wrong origins, auth/account mismatch, and provider failures.
- Assert every emitted request is GET to one allowed path and prove no production adapter export can express a broker mutation.

## Dependencies

- P4-01 broker-observation contracts.
- P4-02 exact read-only paper configuration.

## Out of Scope

Do not normalize or persist observations, poll continuously, open a live account, subscribe to broker streams, or create, cancel, replace, or simulate an order.
