# Domain Primitives

`@daily-trader/domain` contains application-owned, framework-independent value
types. It has no runtime dependencies and does not import provider, web,
database, or messaging libraries.

## Numeric model

`ExactDecimal` is a branded, canonical decimal string. Accepted values use
ordinary decimal notation such as `"0"`, `"12.34"`, or `"-0.5"`. Exponents,
leading zeroes, trailing fractional zeroes, whitespace, `NaN`, infinity, and
JavaScript `number` values are rejected. This preserves all supplied digits and
prevents accidental binary floating-point conversion.

These primitives deliberately provide **no arithmetic or rounding operations**.
Callers must not convert them to `number` for financial calculations. Before
calculations are introduced, the project must adopt and document a reviewed
decimal implementation, precision policy, and operation-specific rounding
rules. Construction validates representation only; it does not round values.

`Money` is an amount in one currency. `Price` is an amount in one currency per
unit of an identified instrument. `Quantity` is an amount of an identified
instrument. The constructors preserve these units in serialized objects.

## Time and identity

`UtcTimestamp` accepts canonical ISO 8601 UTC text at millisecond precision,
for example `"2026-07-11T14:30:00.000Z"`. Offsets and ambiguous local times are
rejected. Time-dependent domain behavior should depend on `Clock`; tests can
use the immutable `FixedClock`.

An `InstrumentId` combines a canonical uppercase symbol with a four-character
venue code. Currency validation enforces the ISO 4217 lexical form (three
uppercase letters), but does not claim that every syntactically valid code is
currently assigned by the ISO registry.

All value objects are frozen and serialize as plain JSON data. Deserialized
data is untrusted and must pass through the constructors again before use.
