# P3-04: Evaluate the Breakout-Plus-Volume Signal

## User Story

As a market observer, I want one transparent breakout-plus-volume rule so that I can see a reproducible market observation with its exact supporting evidence.

## Acceptance Criteria

- One pure versioned rule maps each `ready` feature snapshot to a canonical `fired` or `not_fired` evaluation and maps each suppressed feature result to the corresponding suppressed evaluation. Repeated calls are identical; persistence later permits at most one durable effect per deterministic feature-result identity.
- An upward breakout requires the evaluation close to be strictly greater than the greatest prior high; a downward breakout requires it to be strictly less than the least prior low. Equality is not a breakout.
- Volume confirmation requires a positive usable baseline and compares `current volume × shared prior count` with `prior volume sum × configured multiplier` using the accepted exact arithmetic. Confirmation equality is accepted.
- No rounding is permitted before either the breakout or volume comparator. An exact sum or product that exceeds the accepted arithmetic bounds rejects or suppresses explicitly rather than rounding into or out of a signal, and JavaScript floating point never participates.
- A fired occurrence records direction, exact observed close and volume, exact breakout reference, volume sum/count/multiplier comparison, units, evaluation bar, observation/knowledge-as-of context, on-time or retrospective mode, role-ordered evidence, source/feed/entitlement, every semantic identity from P3-01, deterministic reason, and explanatory invalidation condition.
- The same complete P3-01 identity inputs produce the same evaluation and occurrence identities under live processing and replay, independent of operational processing timestamp.
- Any changed deterministic feature-result identity—including the evaluation-bar revision, eligibility/knowledge-as-of context, or ordered prior evidence—produces a distinct evaluation even when its outcome is unchanged. P3-05 owns durable supersession for every such change and retraction when a prior fired occurrence ceases to be valid.
- A retrospective fired evaluation is retained as a historical observation and cannot be presented as newly on-time. The explanatory invalidation condition is not continuously evaluated against later bars in Phase 3.
- The rule emits no alert, recommendation, risk decision, portfolio action, order intent, or execution request. Human-readable explanation is derived from persisted canonical evidence rather than stored as an unversioned market claim.

## Validation

- Table-test upward and downward breakouts, equality, price-only and volume-only conditions, both conditions, exact volume-threshold equality, zero baseline, very large and fractional exact values, warm-up and every suppression reason.
- Test stable repeated-call output, changed evidence with unchanged outcome, fired-to-not-fired and not-fired-to-fired corrections, on-time versus retrospective labeling, and preservation of prior evidence in the returned contracts.
- Record pure feature-plus-rule latency under a documented fixture and environment as observational evidence. Environment-dependent timing is not a correctness gate or evidence of strategy success.

## Dependencies

- P3-01 signal definition and arithmetic decisions.
- P3-02 effective versioned configuration.
- P3-03 deterministic feature snapshots.

## Out of Scope

No additional signal, strategy optimization, portfolio context, alert delivery, recommendation, backtest, simulated fill, broker action, or execution behavior is added.
