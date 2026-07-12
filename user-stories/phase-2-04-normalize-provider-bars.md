# P2-04: Normalize Provider One-Minute Bars

## User Story

As a data consumer, I want provider bars translated losslessly into application-owned events so that downstream behavior remains exact, validated, and replaceable.

## Acceptance Criteria

- A pure provider-boundary decoder validates message shape, symbol, event kind, entitlement metadata, source identifiers, interval, timestamps, and numeric tokens before constructing an application event.
- JSON numeric lexemes are captured and canonicalized without binary floating-point conversion. Nonfinite, exponent, negative-volume, missing, or otherwise invalid values are rejected according to P2-01.
- Prices must be positive, volume must be nonnegative, and `low <= open/close <= high` must hold using the approved exact comparison policy.
- AAPL and SPY map to the approved `InstrumentId` venues; unknown symbols, intervals, currencies, and event kinds are rejected or explicitly ignored with a classified reason.
- Normalized bars retain source/provider identity, original provider timestamp precision, normalized UTC bar time, injected receive/process times, exact OHLC/volume values, schema version, and feed entitlement/delay status.
- The same valid input and injected times produce the same event identifier and canonical serialization.
- Authentication/control messages and complete raw payloads never appear in domain objects or logs.

## Validation

- Run sanitized-fixture contract tests for valid bars, zero/negative/incorrectly ordered OHLC cases, trailing-zero and large-value tokens, timestamp offsets/precision, malformed payloads, wrong symbols, unsupported intervals, and entitlement errors.
- Verify no normalization path accepts or constructs an exact financial value from JavaScript `number`.

## Dependencies

- P2-01 market-data contracts.
- P2-03 provider adapter contract and fixtures.

## Out of Scope

Do not aggregate trades, calculate indicators, connect to the provider, publish events, or persist bars.
