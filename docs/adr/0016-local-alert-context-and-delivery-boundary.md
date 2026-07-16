# ADR 0016: Local Alert Context and Delivery Boundary

- Status: Accepted
- Date: 2026-07-15
- Implementation status: Planned; no alert API, worker, or dashboard behavior exists yet

## Context

The MVP must make an eligible market alert useful beside a paper portfolio without letting portfolio degradation hide the market observation or turn explanatory context into a risk decision. It must also support acknowledgement and dismissal in a local dashboard while preserving the existing GET-only broker boundary and avoiding public unauthenticated access. The existing Phase 4 current pointer does not retain historical promotion visibility, so "whatever is current when a retry runs" is not a stable context-selection rule.

## Decision

### Immutable Portfolio Context

Alert eligibility depends only on ADR 0015. Portfolio context is selected and persisted separately and can never veto an eligible market alert.

At the first successful durable receipt of an eligible source transition, one PostgreSQL repeatable-read transaction captures `contextSelectedAt` once from `transaction_timestamp()`, reads the Phase 4 current pointer and health evidence visible in that transaction snapshot, and commits a target-local immutable context claim before alert materialization advances the source cursor. A rolled-back attempt establishes no boundary. Every later retry, duplicate, correction, and restart reuses the committed claim and never reselects a newer portfolio cycle. This is creation-time context; it does not claim to be the portfolio state at the signal's earlier observation or `knowledgeAsOf` time. Replay supplies a fixed equivalent selection time and context fixture.

An available selection must follow the implemented Phase 4 terminal integrity boundary: `portfolio_sync_runs.state = 'completed'`; validated canonical snapshot identity and payload; complete account, position, order, and fill membership/counts; reconciliation `converged`; reconciliation expected-result identity equal to the validated projection identity; and a valid projection/payload. The selected current-pointer row and all joined evidence must be visible in the same transaction snapshot. A selected pointer that is missing, inconsistent, or corrupt produces an unavailable selection with an exact limitation rather than supplying holdings. Separately, the latest terminal synchronization attempt is chosen deterministically by `(captureCompletedAt, createdAt, syncRunId)` descending. Its lifecycle is `completed`, `failed`, or `unavailable`; a completed attempt has persisted `converged` reconciliation, while a failed attempt has a safe failure code and reconciliation `unavailable` because Phase 4 persists no reconciliation row for that run. Latest-attempt state never replaces a valid older selected pointer or supplies membership.

The context claim stores `contextSelectedAt`, the source signal observation/knowledge timestamps, nonsecret snapshot/projection/reconciliation content identities, knowledge interval, portfolio configuration version/hash, staleness policy version and threshold, valuation policy and `broker_mark` authority, the latest terminal-attempt lifecycle and safe failure classification, and exact limitation reasons. Freshness is evaluated once at `contextSelectedAt`; a future or invalid knowledge interval yields `unknown` with a typed limitation. Internal cycle IDs, hashes, the account fingerprint, and provider identifiers are not exposed to the browser.

Portfolio state is represented by orthogonal dimensions instead of one overloaded label:

- availability: `available` or `unavailable`;
- freshness: `fresh`, `stale`, or `unknown`, evaluated at `contextSelectedAt` with the persisted threshold;
- selected reconciliation: `converged` or `unavailable`; an available selected cycle is always converged;
- latest-attempt lifecycle: Phase 4 `completed`, `failed`, or `unavailable`, with an exact safe failure classification when failed;
- latest-attempt reconciliation: `converged` or `unavailable`; a failed Phase 4 run has no persisted reconciliation row and therefore maps to `unavailable` rather than inferred drift;
- aggregate and position calculation: Phase 4 `complete`, `incomplete`, or `unavailable`, with exact reason codes;
- membership: `held`, `not_held`, or `unknown`; and
- holding support: Phase 4 `supported`, `unsupported`, or `unknown`, with an exact reason when unsupported.

For a trustworthy terminal completed synchronization cycle, complete position membership present for the fixed instrument means `held` and absent means `not_held`; neither missing data nor an unavailable context is converted to not-held or zero. A stale but otherwise valid selection may therefore be `available`, `stale`, selected-`converged`, aggregate-`complete` or `incomplete`, and either `held` or `not_held` at the same time. A newer failed attempt separately reports lifecycle `failed`, its safe failure classification, and reconciliation `unavailable` without lending any partial rows to the selected context. There is no Phase 4 `suppressed` portfolio state: incomplete calculation and unavailable evidence retain their existing meanings.

Missing, stale, failed, incomplete, unsupported, or unavailable portfolio evidence leaves the alert visible with the precise limitations. Context supplies no suitability conclusion, risk score, recommendation, target position, approval, or executable action. A separately labeled current portfolio view may evolve, but it never rewrites the alert's creation-time context.

### Local Read and Command Boundary

MVP delivery is dashboard-only. Next.js and Fastify bind only to configured canonical loopback authorities, defaulting to `http://127.0.0.1:3000` for the web origin and `127.0.0.1:3001` for Fastify. There is no login, remote-user model, public listener, permissive CORS, or third-party analytics disclosure.

Fastify exposes versioned bounded feed/detail reads. The browser does not send state-changing requests directly to the Fastify port. It posts acknowledge/dismiss commands to a same-origin Next.js route, which acts as a bounded backend-for-frontend and forwards only validated commands to a fixed loopback Fastify target.

The browser-to-Next request requires the exact configured `Host` and `Origin`, same-origin Fetch Metadata, JSON, a bounded body, and the non-simple `X-Daily-Trader-Action: disposition.v1` header. Missing, null, duplicated, forwarded, cross-site, changed-scheme/host/port, form, preflight, and CORS requests are rejected before forwarding. Exact origin/host validation plus the required non-simple header and absence of CORS is the no-login anti-CSRF boundary; no browser credential or reusable CSRF cookie is introduced.

The Next.js route never accepts a client-supplied upstream URL. Its server-to-server transport uses the configured loopback Fastify authority and an exact application-header allowlist containing the JSON metadata and fixed internal request marker. It sends no `Origin`, `Forwarded`, `X-Forwarded-*`, `Sec-Fetch-Site`, `Sec-Fetch-Dest`, or `Sec-Fetch-User`. Fastify requires a loopback socket, exact API `Host`, expected JSON shape/size, and the internal marker and rejects those specifically forbidden headers; it does not rely on a broad "no browser headers" test. Fastify exposes no CORS or `OPTIONS` handler. These checks prevent browser cross-origin writes and DNS rebinding; they do not authenticate a native process already running as the same operating-system user.

A disposition command contains a bounded client command ID, expected disposition version, and target `acknowledged` or `dismissed`. One transaction locks the disposition projection, enforces ADR 0015's transition rules, records the immutable command outcome under unique `(alertInstanceId, commandId)`, and advances the disposition version only when an event is appended. Evaluation order is fixed: an existing command ID returns its exact recorded outcome only when the payload matches; a new command must match the current disposition version; then a current-state target records a successful no-op or an allowed change appends one event. Thus a stale new command conflicts even when its target happens to equal current state.

Every response separates the command outcome from the latest current projection and its version. An exact retry returns the original outcome plus the latest projection, same-ID/different-input is a conflict, and stale concurrent input returns a conflict plus the latest projection. Clients compare versions and refetch after any response that is older than the feed they hold. System corrections remain orthogonal and do not change the disposition version.

The command service depends only on the alert application/repository boundary. It cannot call a provider, portfolio worker, broker, order, risk, execution, external-notification, or AI path. Audit text identifies a local installation command, not a verified person. The Alpaca adapter remains restricted to the four GET resources in ADR 0012, and local alert-state mutation must never be described as broker write capability.

### Responsiveness and Operating Proof

Under documented healthy local conditions, the objective is p95 at or below five seconds from the successful canonical-bar database commit to the first successful Next.js dashboard read containing the resulting alert. For each scenario, the canonical persistence boundary returns only after PostgreSQL acknowledges `COMMIT`; a verifier hook then records a correlated start marker on the verifier-owned monotonic clock immediately after that acknowledgement. The same verifier clock records the completed dashboard response. Provider receipt time, transaction `CURRENT_TIMESTAMP`, revision `journaled_at`, signal-transition time, and worker wall clocks are not substitutes; a missing or uncorrelated marker fails the sample.

The technical verifier includes at least 100 distinct eligible materializations across both instruments and the accepted portfolio-context combinations, includes every eligible sample, reports the sorted sample set and nearest-rank p95 at `ceil(0.95 * n)`, and requires every nominal sample to remain at or below five seconds. A breach is operational evidence and never permission to drop captured work. Lower latency is post-MVP work.

The separate live soak covers three distinct complete regular core sessions from the first through the final expected one-minute boundary in the embedded exchange calendar. Each passing session requires:

- no unexplained AAPL or SPY canonical-bar gap;
- no unresolved market-data, signal, or alert cursor gap and no lost or duplicate required alert effect;
- bounded recovered reconnects/retries only, with no failed worker or exhausted retry at close;
- a zero signal and alert backlog after the documented post-close drain;
- at least one terminal `completed` synchronization cycle with converged integrity and a fresh terminal `completed` converged cycle at close; an `incomplete` projection remains valid when its exact unsupported or unavailable calculation reason is shown; and
- clean bounded shutdown with safe, non-identifying evidence.

A naturally occurring live signal is not required. The soak proves external connectivity and operational continuity; credential-free fixtures and replay prove alert creation, corrections, context combinations, command behavior, and the latency percentile.

## Consequences

An AAPL or SPY alert remains visible whether the instrument is held, not held, stale, unsupported, follows a failed latest synchronization attempt, has reconciliation unavailable, or temporarily lacks usable portfolio context. Context selection is stable across retries without pretending the mutable Phase 4 current pointer is a historical visibility journal.

The no-login local boundary stays narrow but has an exact browser-to-Next-to-Fastify authenticity contract. Hosted access, authentication, multiple users, external notifications, snooze, escalation, lower-latency objectives, configurable instruments, portfolio-risk semantics, and broker mutation remain post-MVP work.
