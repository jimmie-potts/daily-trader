# P4-04: Normalize Paper Broker Observations

## User Story

As a portfolio developer, I want broker resources validated into exact application-owned observations so that malformed or unsupported account data cannot silently enter portfolio state.

## Acceptance Criteria

- P4-04 revalidates every untrusted account, position, observed-order, and fill envelope from P4-03. Unknown required semantics, malformed timestamps, invalid identifiers, unsupported enum versions, inconsistent quantities, and noncanonical financial values fail the cycle explicitly.
- Exact broker numeric fields must be strings and pass canonical decimal validation before construction. JavaScript `number`, exponent notation, non-finite values, silent rounding, coercion, and missing-to-zero conversion are rejected.
- The account observation retains USD cash, equity, `last_equity`, status, trading-blocked facts needed for truthful display, provider/source identity, provider as-of time when present, local receipt time, and account fingerprint without the raw account identifier.
- Each position retains provider symbol and asset classification, supported application instrument when one exists, exact signed quantity, broker mark, signed market value, cost basis and unrealized profit and loss when supplied, currency, side, source identity, and as-of context. A null mark remains null.
- USD `us_equity` holdings are eligible for supported normalization when their application instrument identity is unambiguous. Other currency, asset class, unknown symbol/venue mapping, and unsupported values produce visible unsupported position observations; they are neither dropped nor made eligible for complete aggregates.
- Observed orders retain only immutable normalized provider facts required for monitoring, including side, exact quantities and prices when present, status, type, time in force, and lifecycle timestamps. Fill observations retain exact quantity and price, side, transaction time, and source relationship. The transaction time is execution evidence and is not compared with the adapter's distinct activity-creation query bounds because Alpaca does not return the per-fill creation timestamp used by those filters. Neither contract becomes a local order, approval, recommendation, or execution request.
- Deterministic observation identities bind schema, provider, paper environment, account fingerprint, resource kind, source identifier, canonical normalized content, and provider/as-of context while excluding receipt, worker, database, and retry timestamps.
- The full normalized resource set is returned only when every page and item validates. One rejected item cannot be omitted to make the collection appear complete.

## Validation

- Fixture-test valid, empty, fractional, negative/short, null-mark, unsupported asset/currency, unknown symbol, malformed numeric, number-typed numeric, timestamp, enum, duplicate source ID, inconsistent order/fill, account-fingerprint, exact query-boundary transaction times, and created-at-versus-transaction-time divergence cases.
- Prove canonical serialization and identities are stable across repeated decoding and that fixtures, errors, diagnostics, and logs contain no real account or broker identifiers.

## Dependencies

- P4-01 normalized observation contracts.
- P4-03 read-only adapter envelopes and sanitized fixtures.

## Out of Scope

Do not persist observations, decide cycle completeness, calculate totals, infer missing venue or currency, convert currencies, reconcile accounting, or mutate broker state.
