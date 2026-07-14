# AGENTS.md

This file defines repository-wide instructions for AI coding agents working on Daily Trader. More-specific `AGENTS.md` files may be added inside subdirectories; when present, the nearest file governs that subtree while these safety requirements remain in force.

## Mission

Build a trustworthy, real-time portfolio monitoring and market decision-support application. Optimize for correctness, explainability, deterministic behavior, safe failure, and auditability before speed or feature count.

The project starts with market monitoring and paper trading. Do not implement or enable unattended live trading unless the user explicitly authorizes a separately scoped live-execution phase.

## Current project state

Phases 1 through 4 form a TypeScript npm-workspace monorepo on Node.js 22 with npm 11.18.0. The repository contains a Next.js paper-portfolio dashboard, Fastify health/read API, shared domain/market-data/signal/portfolio/configuration/observability packages, dedicated market-data/signal/portfolio workers, pinned PostgreSQL/TimescaleDB and Redis services, versioned migrations, and CI quality gates. Accepted choices and their consequences are recorded in `docs/adr/`.

Phase 2 implements the narrow market-data slice: provider-supplied one-minute bars for AAPL at `XNAS` and SPY at `ARCX`, Alpaca IEX real-time single-exchange/zero-delay scope, regular core sessions from the embedded 2026-2028 NYSE snapshot, exact normalization, bounded adapter recovery, Redis delivery, durable canonical persistence, portable replay, and terminal status. The integrated service/restart verifier and separately credential-gated AAPL/SPY provider smoke have passed; P2-01 through P2-11 are complete.

Phase 3 adds `@daily-trader/signals`, a dedicated signals worker, bounded exact-decimal feature and rule behavior, one versioned `breakout_plus_volume` observation, append-only evidence and run transitions, a durable PostgreSQL canonical-revision journal with writer-capability cutover checks, deterministic signal replay, and terminal signal status. Its technical matrix and Phase 2 provider dependency have passed; P3-01 through P3-09 are complete. Signal mode defaults to disabled and the only enabled mode is monitoring-only.

Phase 4 adds a separate GET-only Alpaca paper-broker adapter, `@daily-trader/portfolio`, append-only complete synchronization cycles, fenced worker ownership, exact broker-mark calculations, projection-integrity reconciliation, a local read-only API, and a paper-portfolio dashboard. Its credential-free CI, fixture, clean-and-seeded-upgrade migration, persistence, API/dashboard, interrupted-cycle restart, reconciliation, and cleanup matrix has passed; P4-01 through P4-10 are complete. P4-11 and the full Phase 4 exit remain open only for the separate credential-gated portfolio provider smoke. Portfolio mode defaults to disabled; the only enabled mode is `paper_read_only` against one explicitly expected account. Do not treat broker observations as locally originated orders, describe the open provider-created activity query as transaction-time completeness, or claim that fill activity reconstructs an independent accounting ledger.

No alert, portfolio-risk decision, order intent, approval, broker mutation, execution, AI research, additional asset support, currency conversion, extended-hours, or trade-to-bar behavior exists yet. Broker mode remains paper, execution remains disabled, and no later phase is authorized implicitly. The credential-gated portfolio provider smoke remains separate from normal CI and must never be inferred from fixtures.

## Repository structure and commands

- `apps/api/`: Fastify health and read-only portfolio API
- `apps/web/`: Next.js read-only paper-portfolio dashboard
- `workers/market-data/`: provider, recovery, Redis, persistence, replay, metrics, and terminal-status adapters
- `workers/signals/`: durable canonical-revision processing, signal persistence, replay targets, metrics, and terminal status
- `workers/portfolio/`: GET-only paper synchronization, persistence, reconciliation, metrics, status, and provider smoke
- `packages/domain/`: framework- and vendor-independent domain primitives
- `packages/market-data/`: provider-neutral event, calendar, freshness, ordering, and adapter contracts
- `packages/signals/`: provider- and persistence-independent exact features, signal rules, transitions, and replay contracts
- `packages/portfolio/`: provider-independent observations, exact projections, snapshot deltas, and reconciliation
- `packages/config/`: validated configuration and safe diagnostics
- `packages/observability/`: logging, metrics, tracing, and redaction
- `packages/test-utils/`: deterministic test helpers
- `infrastructure/postgres/migrations/`: versioned application-owned market-data, signal, and portfolio schema
- `infrastructure/`: pinned local services and operating notes
- `docs/adr/`: accepted architecture decisions
- `user-stories/notes/`: story validation and handoff notes

Use the root commands rather than bypassing workspace checks:

- `npm ci`: install the committed dependency graph
- `npm run format:check`, `npm run lint`, `npm run typecheck`: static quality gates
- `npm run format`, `npm run lint:fix`: apply formatter and safe automatic lint fixes
- `npm test`, `npm run test:coverage`: deterministic unit tests
- `npm run build:config-runtime`: build configuration and its transitive workspace runtime dependencies
- `npm run build`: build packages and all process shells
- `npm run ci`: run the complete local CI equivalent
- `npm run services:up`, `npm run services:check`, `npm run services:stop`: operate local dependencies
- `npm run db:migrate`: apply or verify non-destructive application migrations
- `npm run market-data:recording:verify`, `npm run market-data:replay`: verify and replay the synthetic portable session
- `npm run market-data:status`: render persisted AAPL/SPY bar-close and operational status
- `npm run market-data:provider-smoke`: run the explicit credential-gated Alpaca smoke; never claim it passed unless it ran
- `npm run signal:recording:verify`: verify the credential-free Phase 3 catalog, schedule, manifest, and expected output
- `npm run signal:replay`: persist the verified synthetic scenario into its isolated PostgreSQL replay target
- `npm run signal:replay:inspect -- <target-id>`: inspect one explicitly named replay target; never mix replay into default live status
- `npm run signal:status`: render the selected persisted live signal run and signal-worker health
- `npm run dev:signals`, `npm run start:signals`: run the dedicated worker; disabled mode is the safe default
- `npm run portfolio:fixture:verify`: exercise sanitized broker fixtures through the production adapter boundary
- `npm run portfolio:fixture:persist`: persist one sanitized complete cycle into an explicitly configured local verification database
- `npm run portfolio:status`: render the selected complete portfolio snapshot and separate health dimensions
- `npm run portfolio:provider-smoke`: run the separately credential-gated four-resource GET-only paper smoke
- `npm run dev:portfolio`, `npm run start:portfolio`: run the dedicated read-only worker; disabled mode is the safe default
- `npm run verify:foundation`: run CI, local-service checks, and process smoke checks
- `npm run verify:phase2`: run the credential-free Phase 2 fixture, service, replay, and status handoff
- `npm run verify:phase3`: run credential-free Phase 3 CI, migration, isolated replay, restart, status, and cleanup validation
- `npm run verify:phase4`: run credential-free Phase 4 fixture, clean-and-seeded-upgrade migration, persistence, reconciliation, API, dashboard, restart, and cleanup validation

`npm run services:reset` deletes local volumes and must only be run intentionally. When new tooling establishes or changes commands, update this file and `README.md` in the same change.

## Non-negotiable safety boundaries

1. Use paper or simulated trading by default.
2. Never place, simulate placing, or prepare to place a live order without explicit user authorization for that exact scope.
3. Never allow an LLM or other nondeterministic component to submit orders, approve order intents, change risk limits, or bypass controls.
4. Treat all external market, news, filing, account, and broker data as untrusted input.
5. Reject trade submission when required data is stale, incomplete, duplicated, inconsistent, or unavailable.
6. Never log API keys, access tokens, account identifiers, personally identifiable information, or complete broker payloads containing sensitive data.
7. Do not weaken, remove, or bypass risk controls to make a test pass or unblock a demo.
8. Preserve an auditable record of signals, decisions, approvals, order intents, broker responses, orders, and fills.
9. All order submission must be idempotent and protected against duplicate events and retries.
10. When broker state is uncertain, halt new submissions, reconcile, and surface an operational alert.

If a requested change conflicts with these boundaries, stop and explain the conflict before modifying code.

## Architectural boundaries

Keep the following concerns separate:

- **Provider adapters:** Translate market-data, filing, news, and brokerage APIs into application-owned types.
- **Ingestion:** Authenticate streams, maintain connections, validate envelopes, detect gaps, normalize timestamps, and publish internal events.
- **Feature computation:** Build bars and derived measurements from normalized events.
- **Signal evaluation:** Run deterministic, versioned rules and preserve their evidence.
- **Portfolio:** Own cash, positions, exposure, profit and loss, and broker reconciliation.
- **Risk:** Evaluate portfolio and order constraints independently of signal generation.
- **Decision workflow:** Create alerts and order intents, collect explicit approvals, and maintain the decision log.
- **Execution:** Translate an approved and revalidated order intent into a broker request and reconcile the result.
- **Research:** Analyze filings, earnings, and news asynchronously; never control the execution path.
- **Presentation:** Display application state and send notifications without becoming the system of record.

Domain code must depend on application-owned interfaces rather than vendor SDK types. A provider replacement should primarily affect its adapter and configuration.

## Fast-path rules

The market-event-to-alert path must remain deterministic and nonblocking:

```text
market event
  -> normalization
  -> feature update
  -> signal evaluation
  -> portfolio context
  -> risk evaluation
  -> alert or order intent
```

- Do not call an LLM from this path.
- Do not make synchronous news, filings, or research calls from this path.
- Use event timestamps and an injected clock; do not scatter direct wall-clock access through domain logic.
- Define ordering, deduplication, replay, and late-event behavior explicitly.
- Preserve the raw provider timestamp, normalized event timestamp, and processing timestamp where relevant.
- Make signal and risk-rule versions part of persisted results.
- Measure latency at each boundary before attempting performance optimization.

## Execution model

An `OrderIntent` and an `Order` are different domain objects.

An order intent must contain at least:

- Instrument and side
- Quantity or notional
- Proposed order type and time in force
- Signal or decision that created it
- Market-data timestamp and price context
- Risk-check results
- Creation and expiration timestamps
- Approval state and approver
- Idempotency key

Immediately before submission, execution must verify:

- The intent is approved, unexpired, and not already submitted.
- The kill switch is not active.
- Market data is fresh enough for the configured rule.
- Position, concentration, order-size, liquidity, spread, daily-loss, and open-order limits pass.
- Local account state has been reconciled recently enough.
- Market-session restrictions pass.

Persist the submission attempt and broker response. A timeout is an unknown outcome, not an automatic failure; reconcile before retrying.

## Domain and numeric conventions

- Never use JavaScript floating-point numbers for money, prices, quantities requiring exact decimal behavior, or financial totals. Use an agreed decimal representation and document rounding rules.
- Include currency and units in types instead of relying on naming conventions alone.
- Store timestamps in UTC and retain exchange timezone/calendar information for session calculations.
- Use exchange calendars rather than weekday-only market-hours logic.
- Treat corporate actions, symbol changes, splits, dividends, and delistings as first-class data concerns.
- Do not silently fill missing values with zero.
- Do not silently convert delayed data into real-time data or mix feeds with different entitlements.
- Keep signal observations separate from investment recommendations and position actions.

## Data and event requirements

- Prefer immutable normalized events and append-only decision records.
- Every externally sourced record should retain provider, source identifier, and as-of timestamp.
- Validate external payloads at the adapter boundary.
- Design consumers for at-least-once delivery unless the infrastructure guarantees otherwise.
- Make handlers idempotent.
- Detect duplicate, late, missing, and out-of-order events.
- Preserve fixtures for important provider edge cases with secrets and account details removed.
- Version event schemas and provide explicit migrations for persisted schema changes.
- Do not introduce Kafka or another distributed system without a measured requirement and an ADR.

## AI and research requirements

AI features may:

- Summarize filings, earnings calls, and news
- Explain why a deterministic signal fired
- Relate new evidence to a stored investment thesis
- Identify questions and conflicting evidence for the user to investigate

AI output must:

- Be labeled as generated analysis rather than market fact.
- Cite or link to the underlying source when available.
- Preserve source and as-of timestamps.
- Distinguish facts, calculations, assumptions, and interpretations.
- Be treated as untrusted input by downstream code.

AI output must not:

- Directly create an executable order
- Approve an order intent
- Alter risk limits or strategy configuration
- Override deterministic calculations
- Supply a price when authoritative market data is unavailable

## Testing expectations

Every behavioral change requires tests proportional to its risk.

### Required coverage

- Unit tests for calculations, signals, risk rules, session boundaries, and state transitions
- Contract tests for external adapters using sanitized recorded payloads
- Integration tests for persistence, event delivery, idempotency, and reconciliation
- Deterministic replay tests for market sessions and signal regressions
- Failure tests for disconnects, retries, timeouts, duplicates, late events, stale quotes, partial fills, and rejected orders
- Authorization and secret-handling tests for execution-related changes

For backtests:

- Prevent look-ahead and survivorship bias.
- Model spreads, fees, slippage, partial fills, and rejected orders.
- Separate training, calibration, and out-of-sample periods.
- Prefer walk-forward evaluation over a single optimized historical interval.
- Record strategy version, configuration, data version, and run timestamp.
- Never claim a strategy is successful from profit and loss alone.

When fixing a defect, add a regression test that fails without the fix whenever practical.

## Observability

Use structured logs, metrics, and traces. At minimum, make it possible to observe:

- Provider connection state, reconnect count, and message lag
- Last event timestamp and data freshness per subscription
- Event throughput, drops, duplicates, and sequence gaps
- Feature, signal, risk, and alert latency
- Signal counts by type and version
- Risk-rule failures
- Alert delivery status
- Order-intent state transitions
- Broker submissions, acknowledgements, rejections, fills, and reconciliation drift
- Kill-switch state

Use correlation identifiers across signal, alert, order intent, order, and fill records. Logs must never contain secrets.

## Security and configuration

- Load secrets from environment variables or an approved secret store.
- Commit an `.env.example` containing names and safe descriptions only.
- Never commit `.env` files, credentials, certificates, tokens, account exports, or raw production payloads.
- Use separate credentials and endpoints for paper and live environments.
- Make the current environment unmistakable in both configuration and UI.
- Default execution permissions to disabled.
- Keep dependency additions minimal and review their maintenance, license, and security posture.
- Validate redirect URLs, webhook signatures, and inbound event authenticity when applicable.

## Engineering conventions

- Use strict TypeScript settings.
- Prefer small modules with explicit inputs and outputs.
- Keep domain logic free of framework and provider dependencies.
- Avoid global mutable state.
- Prefer typed errors with actionable context over swallowed exceptions.
- Do not catch an exception unless the code can recover, translate, or add meaningful context.
- Make retry policies bounded and observable; use exponential backoff with jitter where appropriate.
- Document public APIs and non-obvious financial assumptions.
- Prefer configuration for thresholds, but validate configuration and persist the effective version with results.
- Add an ADR for consequential choices involving providers, data storage, event semantics, decimal representation, market calendars, or execution safety.

## Change workflow

Before changing code:

1. Read this file, the relevant subtree `AGENTS.md`, `README.md`, and existing ADRs.
2. Inspect the working tree and preserve unrelated user changes.
3. Identify whether the change affects the fast path, financial calculations, risk, credentials, or execution.
4. State important assumptions when requirements are incomplete.

While changing code:

1. Keep the patch focused on the requested behavior.
2. Maintain provider and architectural boundaries.
3. Add or update tests with the implementation.
4. Update schemas, fixtures, documentation, and observability when behavior changes.
5. Do not silently broaden permissions, supported assets, or execution scope.

Before handing off:

1. Run the narrowest relevant tests, then the repository-wide quality checks when available.
2. Report exactly what was run and any checks that could not run.
3. Review the diff for secrets, unsafe defaults, live endpoints, and accidental scope expansion.
4. Verify documentation reflects new commands and behavior.
5. Call out any unresolved data, financial, operational, or security risks.

## Initial implementation order

Unless the user reprioritizes the roadmap, build the first vertical slice in this order:

1. Maintain the established TypeScript monorepo, quality checks, configuration validation, PostgreSQL, and Redis foundation.
2. Stream AAPL and SPY from a paper-compatible provider into the terminal worker.
3. Normalize and persist one-minute bars with connection and freshness metrics.
4. Display latest prices, timestamps, and stream health.
5. Implement one versioned breakout-plus-volume signal.
6. Persist all evidence needed to explain and reproduce the signal.
7. Replay a recorded session and verify identical output.
8. Add paper-account synchronization and reconciliation.
9. Add portfolio-aware alerts.
10. Introduce order intents only after the preceding behavior is stable.

Phase 2 completes the market-data foundation in steps 1-4 and the reusable market-data replay substrate in step 7. Phase 3 completes steps 5-7 for only `breakout_plus_volume.v1`; its credential-free Docker/PostgreSQL acceptance path and the separate P2-11 provider observation have passed. Phase 4 implements step 8 as read-only paper-account monitoring only. It does not authorize portfolio-aware alerts, risk decisions, order intents, execution, additional asset classes, sentiment analysis, or complex strategy work without an explicitly scoped later phase.
