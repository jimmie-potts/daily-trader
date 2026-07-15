# Architecture Decision Records

ADRs capture consequential choices that later work must be able to revisit explicitly. Each record uses a stable number and one of `Proposed`, `Accepted`, `Superseded`, or `Rejected`.

| ADR                                                                        | Decision                                      | Status   |
| -------------------------------------------------------------------------- | --------------------------------------------- | -------- |
| [0001](./0001-foundation-runtime-and-workspaces.md)                        | Foundation runtime and workspaces             | Accepted |
| [0002](./0002-exact-values-and-time.md)                                    | Exact values and time                         | Accepted |
| [0003](./0003-local-state-and-event-delivery.md)                           | Local state and event delivery                | Accepted |
| [0004](./0004-paper-provider-boundary.md)                                  | Paper provider boundary                       | Accepted |
| [0005](./0005-test-strategy.md)                                            | Test strategy                                 | Accepted |
| [0006](./0006-phase-2-sessions-and-provider.md)                            | Phase 2 sessions and provider                 | Accepted |
| [0007](./0007-market-event-exact-and-ordering-semantics.md)                | Market-event exact and ordering semantics     | Accepted |
| [0008](./0008-market-data-delivery-persistence-and-replay.md)              | Market-data delivery, persistence, and replay | Accepted |
| [0009](./0009-signal-exact-arithmetic.md)                                  | Signal exact arithmetic                       | Accepted |
| [0010](./0010-canonical-revision-journal-and-run-handoff.md)               | Canonical revision journal and run handoff    | Accepted |
| [0011](./0011-first-signal-semantics.md)                                   | First signal semantics                        | Accepted |
| [0012](./0012-read-only-paper-broker-and-snapshot-semantics.md)            | Read-only paper broker and snapshot semantics | Accepted |
| [0013](./0013-append-only-portfolio-synchronization-and-reconciliation.md) | Portfolio synchronization and reconciliation  | Accepted |
| [0014](./0014-portfolio-exact-arithmetic-and-valuation.md)                 | Portfolio exact arithmetic and valuation      | Accepted |
| [0015](./0015-alert-eligibility-lifecycle-and-audit.md)                    | Alert eligibility, lifecycle, and audit       | Accepted |
| [0016](./0016-local-alert-context-and-delivery-boundary.md)                | Local alert context and delivery boundary     | Accepted |

ADRs 0015-0016 define accepted Phase 5 planning semantics. Their accepted status records the design decision; it does not claim that alert runtime behavior is implemented. Phase 5 story and implementation-note status remains authoritative for delivery.
