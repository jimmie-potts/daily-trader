# P4-09: Expose the Read-Only Portfolio API

## User Story

As a dashboard developer, I want a bounded read-only portfolio API so that presentation can consume persisted current state without becoming the system of record.

## Acceptance Criteria

- Fastify exposes versioned GET-only endpoints for the selected current portfolio summary and bounded observed positions, orders, and fills. No POST, PUT, PATCH, DELETE, broker proxy, generic query, order, approval, alert, or mutation route is added.
- API handlers read only P4-05/P4-08 repository projections. They do not call Alpaca, calculate from provider payloads, start synchronization, mutate persistence, or cache a competing current state.
- Responses identify PAPER and READ-ONLY mode, execution disabled, completed cycle and knowledge interval, last-complete age, synchronization and reconciliation health, calculation completeness, valuation authority, exact canonical values with units/currency, supported and unsupported positions, and bounded observed-order/fill state.
- Fill state includes the exclusive activity-created-after bound, exclusive activity-created-before cutover, and initial-baseline flag. It labels fill transaction time as separate execution evidence; no response implies that the bounds describe execution-time completeness, a gap-free activity ledger, or full account history.
- Missing, stale, failed, unavailable, unsupported, null-mark, and unreconciled states return explicit typed status without fabricated rows or zero totals. A stale last-complete snapshot may remain visible only with its age and degraded state.
- The detailed orders page uses schema v2 and exposes nullable symbol, asset class, side, or order type only for visibly unsupported multi-leg structures. A valid offset beyond the selected collection returns an available empty page with the unchanged total and no next offset.
- Responses and logs exclude credentials, raw account identifiers, account fingerprints when not operationally required, provider request URLs, complete provider payloads, and internal database, order, fill, or event identifiers. Cache control is `no-store`.
- Phase 4 API access remains local and loopback-only under the existing foundation boundary. A remote or multi-user deployment requires separately accepted authentication and authorization work.
- Request bounds, pagination, stable ordering, schema version rejection, database timeout, cancellation, correlation ID, metrics, and safe errors are deterministic and tested.

## Validation

- Integration-test complete, empty, stale, failed-sync, drifted, suppressed, unsupported, nullable multi-leg order facts, null-mark, unavailable-database, in-range and past-end pagination, invalid-version, and fixed-clock responses plus method rejection for every non-GET method.
- Snapshot or schema-test responses and search them for recognizable credentials, account identifiers, raw payload fields, internal IDs, order controls, and unsafe numeric values.

## Dependencies

- P4-05 persisted current reads and health.
- P4-07 reconciliation state.
- P4-08 exact portfolio projections.

## Out of Scope

Do not expose a public API, add user accounts, proxy the broker, stream updates, send notifications, acknowledge alerts, create order intents, or mutate any portfolio or broker state.
