# Epic Catalog

Epics describe user outcomes and phase boundaries. An epic is not implemented merely because its scope is accepted; its stories must pass and receive implementation notes.

| Epic   | Outcome                               | Delivery status                              | Detail                                                                                                      |
| ------ | ------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| MVP-01 | Local read-only portfolio alerts      | Accepted scope; planned                      | [`mvp-01-local-read-only-portfolio-alerts.md`](./mvp-01-local-read-only-portfolio-alerts.md)                |
| PM-01  | Monitoring usability and breadth      | Directional                                  | [`Post-MVP Phase 6`](../../docs/planning/post-mvp-roadmap.md#phase-6-monitoring-usability-and-breadth)      |
| PM-02  | Evaluation and portfolio intelligence | Directional                                  | [`Post-MVP Phase 7`](../../docs/planning/post-mvp-roadmap.md#phase-7-evaluation-and-portfolio-intelligence) |
| PM-03  | Non-executable decision workflow      | Directional                                  | [`Post-MVP Phase 8`](../../docs/planning/post-mvp-roadmap.md#phase-8-decision-workflow)                     |
| PM-04  | Paper execution                       | Directional; separate authorization required | [`Post-MVP Phase 9`](../../docs/planning/post-mvp-roadmap.md#phase-9-paper-execution)                       |
| PM-05  | Hardening and shadow operation        | Directional                                  | [`Post-MVP Phase 10`](../../docs/planning/post-mvp-roadmap.md#phase-10-hardening-and-shadow-operation)      |
| PM-06  | Controlled live rollout               | Deferred; explicit decision required         | [`Post-MVP Phase 11`](../../docs/planning/post-mvp-roadmap.md#phase-11-controlled-live-rollout)             |

Only MVP-01 has dependency-ordered story definitions, and its implementation remains gated by P4-11. Directional post-MVP epics require their own scope and story-planning pass before authorization.
