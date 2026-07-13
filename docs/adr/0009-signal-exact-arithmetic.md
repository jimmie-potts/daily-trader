# ADR 0009: Signal Exact Arithmetic

- Status: Accepted
- Date: 2026-07-12

## Context

ADR 0002 requires a separately accepted arithmetic implementation, precision and scale limits, overflow behavior, canonical conversion, and operation-specific rounding before financial calculations are introduced. Phase 3 needs exact addition, multiplication, and comparison for prior volume sums and breakout-volume thresholds. JavaScript binary floating point cannot participate in those calculations.

The arithmetic dependency must remain small, deterministic, maintained, and isolated from application contracts. The public [`big.js` 7.0.1 package](https://www.npmjs.com/package/big.js/v/7.0.1) is MIT licensed, has no runtime dependencies, supports string construction and exact addition/multiplication, and has a focused upstream test suite. TypeScript declarations are supplied by the MIT-licensed DefinitelyTyped package. The committed dependency graph remains subject to the repository's offline high-severity audit.

## Decision

Use pinned `big.js` 7.0.1 only behind the private `@daily-trader/signals` arithmetic wrapper. Application boundaries continue to use canonical decimal strings and unit-bearing types.

The wrapper has these rules:

- It accepts strings only. It first applies the domain canonical-decimal validator, so whitespace, exponent notation, leading zeroes, trailing fractional zeroes, signed zero, primitive numbers, and non-finite values are rejected before `big.js` construction.
- Every accepted operand and result has at most 48 significant decimal digits and at most 18 fractional digits. Values outside either bound fail explicitly.
- Phase 3 exposes exact comparison, addition, multiplication, and multiplication by a bounded integer count only. Addition and multiplication are exact in `big.js`; no division, square root, negative exponent, formatting precision, or other rounding operation is permitted.
- Results are converted with non-exponential fixed notation, canonicalized, and revalidated against the same precision and scale limits. A result outside the policy fails with `arithmetic_overflow`; it is never rounded, clamped, converted to infinity, or passed through a JavaScript `number`.
- The volume multiplier is a canonical exact string from 1 through 10 inclusive. The shared lookback count is an integer from 1 through 390. Count arithmetic is operational integer arithmetic; it is converted to decimal text before multiplication with an exact financial value.
- Feature construction and signal evaluation translate bounded arithmetic failure into an explicit suppressed result. They never turn overflow into a fired or non-fired comparison.

There is no Phase 3 rounding mode because no accepted operation requires rounding. Any later division, average, allocation, currency conversion, or display rounding requires a new or amended accepted ADR naming its precision and operation-specific rounding rule.

## Consequences

The breakout and volume comparators are reproducible across live processing and replay, including fractional and large values within the policy. The bounded wrapper prevents untrusted decimal text from causing unbounded memory or CPU work and prevents library behavior from leaking into contracts.

The limits intentionally reject some syntactically valid Phase 2 decimals. Such data remains durable market evidence but produces explicit signal suppression until a reviewed arithmetic-policy version broadens the bounds. Changing the library, bounds, accepted operations, canonical conversion, or multiplier range changes the arithmetic-policy version and therefore signal identity.
