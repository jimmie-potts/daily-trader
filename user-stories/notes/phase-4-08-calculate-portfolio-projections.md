# P4-08 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

`@daily-trader/portfolio` contains a private string-only `big.js` 7.0.1 wrapper with the ADR 0014 limits: 48 significant digits, 18 fractional digits, exact comparison/addition/subtraction/absolute value, and one final percentage operation rounded half-to-even to at most six fractional places. Results remain non-exponential canonical strings; overflow, invalid scale/precision, or a zero denominator becomes explicit unavailable evidence.

The pure versioned calculator consumes one complete snapshot plus converged projection integrity. It labels Alpaca paper broker marks as the valuation authority and computes exact gross exposure, net exposure, unrealized profit and loss, day profit and loss, position allocations, and concentration. An empty supported account produces exact zero exposure and unrealized totals with unavailable concentration. Unsupported currency or holdings, null marks, invalid required values, or unreconciled input keeps position evidence visible but suppresses aggregates rather than returning a partial sum.

## Validation Evidence

- `npm test --workspace=@daily-trader/portfolio`: **Pass** — arithmetic and projection tests covered long/short signs, fractional evidence, exact sums/subtraction, negative day P&L, empty accounts, zero denominators, allocation, concentration, six-place half-even ties, overflow, null marks, unsupported holdings/currency, duplicate positions, suppression, and deterministic identities.
- Portfolio type checking and linting passed with no import from the signal arithmetic implementation.
- Production calculation review found no JavaScript financial-number conversion, implicit currency rounding, Phase 2 price substitution, missing-to-zero conversion, or silent partial aggregate.

## Handoff

Broker marks and this exact policy define Phase 4 valuation. Currency conversion, additional asset support, alternate marks, realized or tax P&L, benchmarks, risk calculations, and new rounded operations require new semantics and an accepted decision.
