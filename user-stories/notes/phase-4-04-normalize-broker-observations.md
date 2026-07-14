# P4-04 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

The Alpaca normalization boundary revalidates every untrusted account, position, observed-order, and fill envelope into `@daily-trader/portfolio` contracts. Exact fields must arrive as canonical decimal strings; number-typed values, exponent notation, malformed timestamps, unsupported enums, duplicate source rows, inconsistent quantities, invalid activity-query bounds, and incomplete resource sets fail the cycle rather than being coerced or omitted. Fill transaction time remains independent execution evidence and is not compared with the provider's activity-creation query interval because Alpaca omits the per-fill creation timestamp used by that filter.

Normalized account evidence retains the required exact cash/equity and blocking facts behind a nonsecret fingerprint. Position evidence retains provider symbol and classification, exact signed quantities and broker values, side, currency, as-of context, and supported or explicit unsupported state. USD `us_equity` instruments are mapped only when their identity is unambiguous; other assets, currencies, or venues remain visible and suppress unsupported aggregate calculations. Explicit nested `mleg` parents preserve absent, null, or empty asset, symbol, asset-class, and side facts as null with no instrument and `unsupported_order_structure`; the same structural classification remains when a provider happens to populate singular parent facts. Concrete child symbols and sides remain provider facts; absent, null, or empty child type remains null under the same unsupported structure reason. Canonical child `orderClass: mleg` describes its provider-supplied containment even when the child class is simple or empty, without deriving singular identity from sibling legs. Aggregate-parent role, rather than nullable fields or canonical class alone, prevents per-leg fill symbol, side, quantity, asset, or instrument facts from being inferred from the spread parent. Raw leg ratios remain unpromoted because ratio semantics are not yet supported. Observed orders and fills retain monitoring facts only and never become an intent, approval, recommendation, or request.

## Validation Evidence

- `npm test --workspace=@daily-trader/portfolio-worker`: **Pass** - 10 test files/71 tests covered populated and empty captures, fractions, shorts, null marks, unsupported asset/currency/venue, unknown symbols, malformed and number-typed financial values, timestamps, enums, duplicates, inconsistent order/fill quantities, held orders, explicit multi-leg parent and child omissions, ratio-realistic leg quantities, role-based aggregate-parent fill linkage, baseline/subsequent queries, exact-boundary transaction times, and created-at-versus-transaction-time divergence.
- Repeated decoding and receipt-time changes produced stable canonical identities; malformed single items failed the complete capture.
- Sanitized fixtures and safe-error review found no real account, position, order, fill, request, or credential identifier.

## Handoff

Persistence and calculation may consume only a fully normalized capture. They must not infer missing values, venue, currency, singular parent order identity, order meaning, or completeness from partial adapter data, and they must retain unsupported positions and order structures rather than filtering them.
