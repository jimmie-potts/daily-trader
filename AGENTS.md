# AGENTS.md

This file defines repository-wide instructions for AI coding agents working on Daily Trader. More-specific `AGENTS.md` files may be added inside subdirectories; when present, the nearest file governs that subtree while these safety requirements remain in force.

## Mission

Build a trustworthy, real-time portfolio monitoring and market decision-support application. Optimize for correctness, explainability, deterministic behavior, safe failure, and auditability before speed or feature count.

The project starts with market monitoring and paper trading. Do not implement or enable unattended live trading unless the user explicitly authorizes a separately scoped live-execution phase.

## Current project state

Phases 1 and 2 form a TypeScript npm-workspace monorepo on Node.js 22 with npm 11.18.0. The repository contains Next.js and Fastify shells; shared domain, market-data, configuration, observability, and test packages; a long-running market-data worker boundary; pinned PostgreSQL/TimescaleDB and Redis services; versioned migrations; and CI quality gates. Accepted choices and their consequences are recorded in `docs/adr/`.

Phase 2 implements the narrow market-data slice: provider-supplied one-minute bars for AAPL at `XNAS` and SPY at `ARCX`, Alpaca IEX real-time single-exchange/zero-delay scope, regular core sessions from the embedded 2026-2028 NYSE snapshot, exact normalization, bounded adapter recovery, Redis delivery, durable canonical persistence, portable replay, and terminal status. Market data is disabled by default and the credential-gated provider smoke is separate from CI. P2-11 integrated service/restart verification has passed; do not report the phase exit as verified until the credential-gated `npm run market-data:provider-smoke` also observes normalized bars for both approved symbols.

No portfolio synchronization, signal, alert, order intent, broker execution, AI research, additional symbol, extended-hours, or trade-to-bar behavior exists yet. Broker mode remains paper, execution remains disabled, and no later phase is authorized implicitly.

## Repository structure and commands

- `apps/api/`: Fastify health API and smoke check
- `apps/web/`: Next.js foundation status page
- `workers/market-data/`: provider, recovery, Redis, persistence, replay, metrics, and terminal-status adapters
- `packages/domain/`: framework- and vendor-independent domain primitives
- `packages/market-data/`: provider-neutral event, calendar, freshness, ordering, and adapter contracts
- `packages/config/`: validated configuration and safe diagnostics
- `packages/observability/`: logging, metrics, tracing, and redaction
- `packages/test-utils/`: deterministic test helpers
- `infrastructure/postgres/migrations/`: versioned application-owned market-data schema
- `infrastructure/`: pinned local services and operating notes
- `docs/adr/`: accepted architecture decisions
- `user-stories/notes/`: story validation and handoff notes

Use the root commands rather than bypassing workspace checks:

- `npm ci`: install the committed dependency graph
- `npm run format:check`, `npm run lint`, `npm run typecheck`: static quality gates
- `npm run format`, `npm run lint:fix`: apply formatter and safe automatic lint fixes
- `npm test`, `npm run test:coverage`: deterministic unit tests
- `npm run build`: build packages and all process shells
- `npm run ci`: run the complete local CI equivalent
- `npm run services:up`, `npm run services:check`, `npm run services:stop`: operate local dependencies
- `npm run market-data:migrate`: apply or verify non-destructive market-data migrations
- `npm run market-data:recording:verify`, `npm run market-data:replay`: verify and replay the synthetic portable session
- `npm run market-data:status`: render persisted AAPL/SPY bar-close and operational status
- `npm run market-data:provider-smoke`: run the explicit credential-gated Alpaca smoke; never claim it passed unless it ran
- `npm run verify:foundation`: run CI, local-service checks, and process smoke checks
- `npm run verify:phase2`: run the credential-free Phase 2 fixture, service, replay, and status handoff

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

Phase 2 completes the market-data foundation in steps 1-4 and the reusable replay substrate in step 7; it does not implement the intervening signal work or authorize later behavior. Do not begin live execution, additional asset classes, sentiment analysis, or complex strategy work without an explicitly scoped later phase.
