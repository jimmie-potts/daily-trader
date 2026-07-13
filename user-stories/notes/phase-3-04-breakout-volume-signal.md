# P3-04 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

The pure `breakout_plus_volume.v1` rule maps a ready feature snapshot to fired or not-fired and preserves every suppressed feature outcome. Upward breakout is strict close-above-prior-high, downward breakout is strict close-below-prior-low, and volume confirmation uses the exact cross-product comparison with equality accepted. No intermediate average or rounding participates.

A fired occurrence retains direction, exact price and volume operands, multiplier and count, units, observation and knowledge context, on-time or retrospective mode, source entitlement, ordered evidence, semantic identities, deterministic reason, and an explanatory invalidation condition. It creates no alert, recommendation, portfolio state, risk result, order intent, or execution request.

## Validation Evidence

- Rule tests passed for both directions, equality boundaries, price-only and volume-only cases, exact threshold equality, warm-up and suppression, fractional and large exact values, overflow, changed evidence, fired/non-fired corrections, and retrospective labeling.
- Stable repeated calls and live/replay identities were verified independently of processing time.
- `npm run verify:phase3`: **Pass** — the root 52-file/544-test run and reviewed synthetic signal scenario passed.

## Handoff

`breakout_plus_volume.v1` has one fixed meaning. Additional signals, changed thresholds, profitability claims, portfolio suitability, active-position semantics, alerts, and execution require separately versioned later work.
