# P4-07 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

`@daily-trader/portfolio` implements a pure prepared-projection builder, snapshot-delta classifier, and provider-observation-versus-local-projection reconciler. Convergence binds one complete snapshot, account values, sorted position/order/fill membership, selected observation identities, supported and unsupported classification, prepared-projection version, and the exact portfolio-result identity when present.

The repository performs reconciliation twice around calculation and again from the actual rows persisted for promotion. A current read reconstructs the selected state and verifies the stored prepared projection, projection result, reconciliation identity, and canonical payloads. Missing membership, duplicates, wrong revisions, account mismatch, unknown versions, tampering, incomplete evidence, or a calculation-identity mismatch produces drift or unavailable state. The code never mutates provider facts to manufacture convergence and never claims that fills reconstruct an independent cash or position ledger.

## Validation Evidence

- `npm test --workspace=@daily-trader/portfolio`: **Pass** — reconciliation tests covered baselines and later changes, exact convergence, missing/incomplete evidence, account and revision mismatch, duplicate or tampered local rows, projection-result mismatch, unknown versions, deterministic serialization, and identical-input stability.
- Repository regression tests changed a persisted position revision before completion; the transaction rolled back, no current pointer changed, and the candidate could not be reported converged.
- Disposable PostgreSQL fixture persistence reproduced converged reconciliation from immutable membership on readback.

## Handoff

`converged` means synchronization/projection integrity only. Later code must keep provider availability, cycle completeness, last-good age, projection integrity, and calculation completeness separate and must not reinterpret this result as accounting, execution, or risk reconciliation.
