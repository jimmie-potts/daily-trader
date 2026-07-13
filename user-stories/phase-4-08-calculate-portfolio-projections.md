# P4-08: Calculate Exact Portfolio Projections

## User Story

As a portfolio observer, I want exact profit-and-loss, allocation, concentration, and exposure calculations so that the dashboard is reproducible and never hides unsupported or unpriced holdings.

## Acceptance Criteria

- A pure versioned portfolio calculator consumes exactly one completed, reconciled cycle and uses only the arithmetic and valuation rules accepted in ADR 0014. It receives no raw provider object, database row, ambient clock, signal occurrence, or mutable current state.
- The private portfolio arithmetic wrapper uses string-only `big.js` under the 48-significant-digit and 18-fractional-digit policy. Exact comparison, addition, subtraction, and absolute value never round. Overflow or policy violation suppresses the projection explicitly.
- Broker marks and broker-reported signed position market values are the labeled valuation authority. The result binds the cycle knowledge interval and never presents a broker mark as an IEX, consolidated, exchange-timestamped, or independently real-time price.
- A complete aggregate requires USD account values and only supported `us_equity` positions with valid non-null broker marks, signed market values, and unrealized profit-and-loss values. Unsupported asset/currency, null mark, missing value, invalid exact value, or unreconciled input keeps every holding visible but suppresses affected aggregate output rather than omitting it.
- Gross exposure is the exact sum of absolute signed position market values. Net exposure is the exact sum of signed market values. Unrealized profit and loss is the exact sum of position unrealized profit-and-loss values. Day profit and loss is exact account equity minus exact account `last_equity`.
- Each position allocation is `absolute position market value / gross exposure * 100`, rounded once half-to-even to at most six fractional decimal places. Concentration is the greatest available allocation. Currency totals are never rounded.
- An empty supported account produces exact zero gross exposure, net exposure, and unrealized profit and loss, no allocations, and unavailable concentration. A zero gross denominator never produces zero, infinity, or `NaN` allocation.
- The deterministic projection identity binds arithmetic and valuation versions, completed cycle and reconciliation identity, exact account and position observations, unsupported/suppression state, and canonical result while excluding processing, worker, database, and rendering timestamps.

## Validation

- Table- and property-test long and short signed values, fractional quantities as evidence, empty portfolios, exact sums and subtraction, allocation and half-even ties, maximum six-decimal output, concentration, zero denominator, negative day P&L, overflow, null marks, unsupported holdings/currency, duplicate positions, and deterministic identity.
- Search production portfolio calculation code for JavaScript financial-number conversion, signal arithmetic imports, implicit rounding, silent partial sums, and missing-to-zero behavior.

## Dependencies

- P4-01 portfolio projection contracts and ADR 0014.
- P4-05 complete persisted snapshot reads.
- P4-07 converged reconciliation input.

## Out of Scope

Do not convert currency, substitute Phase 2 bars for broker marks, calculate realized or tax profit and loss, add a benchmark, evaluate portfolio risk, create an alert, recommend a trade, or produce an order intent.
