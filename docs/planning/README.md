# Product Planning

This directory is the durable product-planning source for Daily Trader. It separates current implementation truth from accepted future scope and from directional work that is not yet authorized.

## Planning Status

| Area          | Status                                                        | Source of truth                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phases 1-3    | Implemented and complete                                      | [`user-stories/README.md`](../../user-stories/README.md) and implementation notes                                                                                                                              |
| Phase 4       | P4-01 through P4-10 implemented; P4-11 provider smoke pending | [`user-stories/README.md`](../../user-stories/README.md#phase-4-read-only-portfolio-monitoring)                                                                                                                |
| MVP / Phase 5 | Product scope accepted; implementation not started            | [`mvp-local-read-only-alerts.md`](./mvp-local-read-only-alerts.md), [`setup prerequisites`](./mvp-setup-prerequisites.md), and [`MVP-01`](../../user-stories/epics/mvp-01-local-read-only-portfolio-alerts.md) |
| Post-MVP      | Directional sequence only; not implementation-authorized      | [`post-mvp-roadmap.md`](./post-mvp-roadmap.md)                                                                                                                                                                 |

## Truth Vocabulary

- **Implemented** means code, tests, validation evidence, and an implementation note exist.
- **Accepted scope** means the product and architectural boundary has been agreed, but it does not claim that runtime behavior exists.
- **Planned** means a dependency-ordered story exists and has not yet passed its acceptance criteria.
- **Directional** means the outcome is placed on the roadmap but still needs explicit scope, ADRs, stories, and authorization before implementation.

No Phase 5 implementation note should be created until the corresponding story is implemented and validated. P4-11 provider evidence and the Phase 5 three-session MVP soak remain separate gates and must never be inferred from fixtures.

## Current Plan

1. Close P4-11 with the separately credential-gated, four-resource GET-only Alpaca paper-account smoke.
2. Implement the Phase 5 stories in dependency order to deliver the local read-only portfolio-alert MVP.
3. Pass the credential-free Phase 5 technical matrix and the separate three-session local-market soak.
4. Select and explicitly authorize one post-MVP phase before creating its implementation stories.

The MVP keeps the broker boundary GET-only and execution disabled. Acknowledge and dismiss are local application-state changes only; they are not approvals, risk decisions, order intents, or broker mutations.

The [`MVP setup prerequisites`](./mvp-setup-prerequisites.md) list the exact external accounts, environment names, and credential-free paths. No live-broker, AI, notification, hosted-service, or authentication key is required.

## Change Control

Any proposed change to the MVP's fixed instruments, signal definition, delivery channel, local access boundary, alert eligibility, lifecycle states, latency target, or execution boundary must update the MVP charter, its epic and stories, and the relevant ADR before implementation.
