# P5-06: Expose the Local Alert API

## User Story

As the local dashboard user, I want bounded alert feed, detail, acknowledge, and dismiss operations so that I can review alerts without exposing the application or changing broker state.

## Acceptance Criteria

- The loopback Fastify service exposes versioned bounded reads for a newest-first alert feed and one alert detail containing source evidence, current lineage projection, revision validity, user disposition, immutable creation-time portfolio context, and correction/action history.
- Feed pagination uses validated bounded parameters, stable deterministic ordering, explicit totals or continuation evidence, and `no-store`. Empty and past-end pages are truthful and bounded.
- The browser sends acknowledge/dismiss only to a same-origin Next.js route. That route requires the exact configured web Host and Origin, same-origin Fetch Metadata, JSON, bounded body, and `X-Daily-Trader-Action: disposition.v1`; it rejects missing/null/duplicated/forwarded/cross-site origins, form/preflight requests, and every CORS path before forwarding.
- Next.js forwards only to the fixed configured loopback Fastify authority, never a client-supplied target, through an exact application-header allowlist. Fastify requires a loopback socket, exact API Host, JSON, bounded body, and the internal marker; it specifically rejects `Origin`, `Forwarded`, `X-Forwarded-*`, `Sec-Fetch-Site`, `Sec-Fetch-Dest`, and `Sec-Fetch-User` rather than relying on a broad browser-header test, and it exposes no CORS or `OPTIONS` handler.
- Each command includes `commandId`, `expectedDispositionVersion`, and target `acknowledged` or `dismissed`. Evaluation checks exact command retry/key reuse first, then requires a matching current version before deciding no-op versus allowed state change; a stale new command conflicts even when it targets current state. Every response separates immutable command outcome from latest projection/version. No command changes revision validity, signal/portfolio evidence, or broker state.
- Both services bind only to their configured loopback authorities, require no login, expose no remote-user concept, and return no raw account, provider, database, cursor, lease, or credential identifier. Audit output identifies a local command, not a verified person or approval.
- Read and action operations use bounded database deadlines and cancellation. Safe errors distinguish invalid request, not found, conflict, unavailable, cancelled, and internal failure without leaking stored evidence or configuration.
- No route edits alert rules, snoozes or escalates an alert, approves a trade, creates an order intent, or calls a provider or broker. Existing portfolio broker access remains GET-only.

## Validation

- Test feed and detail reads, stable pagination, empty and past-end pages, every revision/lineage/disposition state, orthogonal context limitations, correction history, every disposition transition/no-op/retry/conflict, concurrent versions, invalid identifiers, exact Host/Origin/Fetch Metadata/custom-header checks at Next, internal Fastify checks, DNS-rebinding/forwarded/preflight/CORS rejection, oversized bodies, cancellation, timeout, database failure, and safe metrics/errors.
- Enumerate registered routes and inspect responses/logs to prove there is no public bind, permissive CORS, rule, risk, recommendation, order, approval, broker, execution, or secret exposure.

## Dependencies

- P5-04 append-only alert persistence.
- P5-05 durable signal-alert processing.

## Out of Scope

Do not add authentication, remote access, external notifications, filters, charts, rule editing, or any broker mutation.
