# P5-01: Define Alert Contracts and Decisions

## User Story

As a platform developer, I want exact, versioned alert contracts and accepted lifecycle decisions so that composition, persistence, processing, replay, API behavior, and presentation share one non-executable meaning.

## Acceptance Criteria

- ADRs 0015 and 0016 are accepted before an alert package, migration, worker, API action, or dashboard alert is implemented. Acceptance fixes alert eligibility, source-watermark cutover, the complete correction table, revision validity, user disposition, append-only audit history, deterministic portfolio-context selection, the local command boundary, and the measurement contract.
- A provider-, framework-, and persistence-independent application package owns immutable alert identities, revisions, evidence, creation-time portfolio context, revision-validity transitions, user-disposition events, and current projections. Existing domain, market-data, signal, and portfolio packages do not gain a reverse dependency on alert behavior.
- The MVP contract accepts only eligible on-time `breakout_plus_volume.v1` occurrences for AAPL/XNAS and SPY/ARCX. An alert remains an observation rather than a recommendation, portfolio-risk decision, position action, order intent, approval, or execution request.
- Global lineage identity binds alert semantic/schema version, signal definition/configuration hash, instrument/venue, and evaluation-bar boundary while excluding signal/alert runs, capture interval, source revision, clock, portfolio, and disposition. Corrections under that key share a lineage; changed signal configuration creates a new lineage.
- Global revision identity binds the lineage to deterministic source evaluation/occurrence content. Target-local instance identity separately binds the live installation or named replay target, first run association, and immutable context claim; context, current projection, and disposition cannot collide across isolated targets.
- Revision validity is exactly `active`, `superseded`, or `retracted`; current lineage projection and user disposition `new`, `acknowledged`, or `dismissed` are separate contracts. Historical supersession cannot be confused with current lineage validity.
- Alert evidence retains source versions, ordered signal evidence, observation and knowledge timestamps, value and threshold, reason, data-quality state, correction relationship, and the immutable portfolio-context reference. Missing values are explicit and never silently zero-filled.
- Retrospective recomputation cannot open a fresh alert. Contracts cover fired-to-fired supersession, fired-to-non-fire retraction, retracted-to-fired reactivation, repeated corrections, correction lineages with no alert, and duplicates without deleting history or resetting user disposition.
- Portfolio context models availability, freshness, selected reconciliation, latest-attempt lifecycle and reconciliation, calculation, membership, and support independently. A failed latest attempt retains its safe failure classification, maps reconciliation to unavailable because no Phase 4 reconciliation row exists, never supplies holdings, and never invents a portfolio `suppressed` state.
- Disposition commands require command identity and expected version, allow acknowledgement/dismissal changes but never return to `new`, and keep correction validity/versioning orthogonal.
- Public alert types contain no provider SDK type, raw provider payload, credential, account identifier, recommendation, risk approval, order, or broker-mutation method.

## Validation

- Unit-test contract construction, immutability, canonical serialization, lineage stability across compatible runs, lineage separation across configuration changes, global revision reuse, target-local context separation, fixed scope, ordered evidence, every revision/lineage/disposition combination, the complete correction table, cutover provenance, orthogonal context combinations, and rejection of invalid or provider-shaped input.
- Audit dependency direction and public exports to prove alert contracts do not introduce a provider, web framework, database, broker, order, execution, AI, or external-notification dependency.

## Dependencies

- Completed P3-09 signal handoff.
- Completed P4-11 Phase 4 exit.

## Out of Scope

Do not add environment settings, migrations, a worker, an API route, a dashboard control, external notifications, risk rules, order intents, or execution.
