# ADR 0014: Portfolio Exact Arithmetic and Valuation

- Status: Accepted
- Date: 2026-07-13

## Context

Phase 4 must calculate profit and loss, allocation, concentration, and exposure without JavaScript floating point. ADR 0009 permits only Phase 3 signal operations behind the signal package and explicitly requires a later decision before division or rounding. Portfolio values also need one labeled valuation authority and explicit behavior for unsupported assets and missing broker marks.

## Decision

Use pinned `big.js` 7.0.1 behind a private `@daily-trader/portfolio` arithmetic wrapper. The portfolio package does not depend on the signal package or import its private wrapper. Application contracts continue to use canonical decimal strings and unit-bearing values.

The wrapper accepts canonical decimal strings only and permits at most 48 significant decimal digits and 18 fractional digits for each accepted input and exact non-percentage result. It exposes exact comparison, addition, subtraction, and absolute value, plus one bounded percentage operation. Exact results are converted to non-exponential canonical text and revalidated. Overflow or a value outside the precision/scale policy suppresses the affected portfolio projection; it is never rounded, clamped, replaced with zero, or converted through JavaScript `number`.

The percentage operation computes `numerator * 100 / denominator`, rounds once at the final result using round-half-to-even, retains at most six fractional decimal places, removes insignificant trailing zeroes, and revalidates the canonical result. No currency value or exposure total is rounded. A zero denominator produces an explicit unavailable percentage rather than zero or infinity.

Alpaca paper broker marks and broker-reported signed position market values are the Phase 4 valuation authority. Every position and projection labels that authority as a paper-broker mark and binds it to the complete cycle's knowledge interval; it does not relabel the mark as IEX, consolidated, exchange-timestamped, or provider-real-time market data when the broker did not supply that evidence. Phase 2 canonical bars remain separate market observations and are not silently mixed into the portfolio calculation.

A complete aggregate projection requires one complete account cycle in USD and only supported `us_equity` positions with valid non-null broker marks, signed market values, and unrealized profit-and-loss values. Unsupported assets, unsupported currency, null marks, or invalid exact values remain visible but suppress all aggregates that would otherwise omit them. There is no currency conversion or synthetic mark.

For a complete projection:

- gross exposure is the exact sum of the absolute signed market value of every position;
- net exposure is the exact sum of signed position market values;
- unrealized profit and loss is the exact sum of position unrealized profit-and-loss values;
- day profit and loss is exact account equity minus exact account `last_equity`;
- position allocation is `absolute position market value / gross exposure * 100` under the accepted percentage rule; and
- concentration is the greatest available position allocation.

An account with no positions has exact zero gross exposure, net exposure, and unrealized profit and loss, an empty allocation list, and unavailable concentration because no position exists. Cash and account equity remain separately labeled broker observations; they are not silently substituted into gross exposure.

## Consequences

The same completed cycle produces the same portfolio projection across worker runs, API reads, and dashboard rendering. Currency totals remain exact, while percentage rounding is explicit, bounded, and confined to one final operation. Broker marks are visible as broker evidence rather than being confused with the single-exchange market-data feed.

Adding another currency or asset class, calculating from quotes or canonical bars, changing mark authority, changing arithmetic limits, or adding another rounded operation changes the portfolio semantic version and requires an amended or follow-up ADR.
