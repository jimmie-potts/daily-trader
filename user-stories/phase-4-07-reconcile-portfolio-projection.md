# P4-07: Reconcile the Local Portfolio Projection

## User Story

As an operator, I want the selected local projection checked against its complete provider observation so that synchronization drift is explicit and no partial state is described as reconciled.

## Acceptance Criteria

- For every completed cycle, a pure reconciler independently derives the expected account, position, observed-order, and fill membership from immutable normalized cycle associations and compares it with the local current projection prepared for promotion.
- Reconciliation is `converged` only when cycle identity, account values, complete membership, selected observation revisions, supported/unsupported classification, portfolio result identity when present, and projection version match exactly.
- Missing cycle membership, duplicate current rows, wrong observation revision, account-fingerprint mismatch, partial resource state, projection-calculation mismatch, or unrecognized version produces durable bounded drift or unavailable evidence. It is never repaired by mutating append-only history or rewriting provider facts.
- Promotion and reconciliation commit atomically. A non-converged candidate cannot be selected as healthy current state; the last converged snapshot remains available with explicit age while the failed candidate and reason remain auditable.
- Startup and restart re-run projection integrity for the selected cycle before reporting healthy. Database corruption, unsupported version, or irreproducible projection makes reconciliation unhealthy even when the broker is reachable.
- The display distinguishes provider availability, last-complete age, cycle completeness, projection integrity, and portfolio calculation completeness. None is collapsed into a single connected flag.
- The reconciler makes no claim that fills reconstruct all positions, cash, equity, transfers, fees, dividends, splits, or corporate actions. The first complete provider cycle is an observed baseline, not an independently verified accounting opening balance.
- Reconciliation emits no operational alert in Phase 4 and cannot approve, reject, create, or alter an order or risk decision.

## Validation

- Table-test convergence and every membership, revision, account, unsupported-holding, projection, version, and missing-evidence drift; integration-test atomic promotion rejection, database tampering, restart recheck, prior-snapshot retention, and recovery after a later valid cycle.
- Prove two identical complete cycles reconcile identically and that incomplete provider input can never produce `converged`.

## Dependencies

- P4-05 immutable cycles and current projections.
- P4-06 recoverable synchronization lifecycle.

## Out of Scope

Do not reconstruct an accounting ledger, ingest transfers, fees, dividends, or corporate actions, reconcile local execution state, send alerts, or change broker data.
