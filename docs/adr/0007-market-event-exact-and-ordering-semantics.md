# ADR 0007: Market-Event Exact and Ordering Semantics

- Status: Accepted
- Date: 2026-07-12

## Context

Provider decoding, delivery, storage, and replay need one deterministic interpretation of exact values, timestamps, identity, corrections, ordering, lateness, and gaps. Provider payload types and JavaScript floating point cannot define those meanings.

## Decision

Use a versioned application-owned one-minute-bar event. Preserve the provider RFC 3339 timestamp at its original precision and separately store normalized UTC timestamps at millisecond precision for the bar boundary, receipt, and processing or replay time.

Capture provider numeric tokens as lexemes before they can become JavaScript `number` values. Reject exponent notation, non-finite values, invalid signs, and values that violate the bar schema. Canonicalize accepted decimal text, including removal of insignificant trailing fractional zeroes, before domain construction. Prices must be positive, volume must be nonnegative, and OHLC ordering is checked with a narrow sign-and-digit string comparison over canonical decimals. This comparison performs no arithmetic or rounding and does not select the deferred general decimal library.

The application event ID is the lowercase SHA-256 digest of the canonical provider, feed, instrument, interval, provider bar timestamp, and canonical bar content. Receipt, processing, and replay times are excluded. The logical ordering key is instrument, interval, and normalized bar start.

Classify an arrival as follows:

- The same event ID is a duplicate and cannot change canonical state.
- A different event ID with the same ordering key is a correction; both versions remain auditable.
- A bar older than the greatest accepted bar start for its instrument and interval is out of order.
- A bar arriving more than the ADR 0006 freshness threshold after its bar end is late, independently of its duplicate, correction, or ordering classification.

Where the provider supplies no sequence, do not invent one. A gap is detectable only when expected core-session minute boundaries in the embedded calendar are skipped. Gap state is unknown when coverage cannot prove completeness. Never fabricate, interpolate, or silently backfill a missing bar.

The long-running adapter's duplicate/correction cache retains at most 10,000 recent event identities. Eviction may reduce an old arrival to an out-of-order classification at that operational boundary; durable PostgreSQL uniqueness, session links, and market-series serialization remain authoritative for idempotency and correction classification. No process retains every session event identifier in memory.

## Consequences

Canonical serialization and event identity are stable across live ingestion and replay. Receive and replay clocks remain observable without changing identity. Raw numeric lexemes and complete provider frames are discarded after validation, canonicalization, and identity construction. Trade aggregation, numeric calculations, gap repair, and additional event kinds remain deferred.
