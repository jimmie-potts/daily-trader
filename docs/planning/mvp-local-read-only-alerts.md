# MVP: Local Read-Only Portfolio Alerts

- Product status: Accepted scope
- Delivery status: Planned; implementation has not started
- Target phase: Phase 5
- Last updated: 2026-07-15

## Product Outcome

For one explicitly expected Alpaca paper account, Daily Trader runs locally during the regular US-equities core session, monitors the fixed AAPL/XNAS and SPY/ARCX one-minute market-data series, evaluates the existing `breakout_plus_volume.v1` observation, and displays persistent explainable alerts with truthful portfolio context.

The MVP lets one local user notice and review a deterministic market observation without creating a recommendation, portfolio-risk decision, order intent, approval, broker mutation, or execution path.

## Prerequisites

- Phases 1 through 3 remain complete.
- P4-01 through P4-10 provide the implemented portfolio synchronization, projection, API-read, and dashboard foundations.
- P4-11's separate Alpaca paper-account provider smoke must pass before any Phase 5 implementation begins. Planning may merge earlier, but it is not authorization to bypass that gate.
- Normal development, fixtures, replay, and technical verification remain credential-free. Live local operation uses the already separated market-data and paper-broker credentials.

The exact account, key, service, and non-requirement inventory is in [`mvp-setup-prerequisites.md`](./mvp-setup-prerequisites.md).

## Fixed MVP Scope

- One local, single-user installation.
- Loopback-only API and dashboard access with no login. The canonical defaults are `http://127.0.0.1:3000` for Next.js and `127.0.0.1:3001` for Fastify.
- One explicitly expected Alpaca paper account through the existing GET-only broker adapter.
- Fixed AAPL/XNAS and SPY/ARCX one-minute bars during the embedded regular core sessions.
- The existing `breakout_plus_volume.v1` definition only.
- Dashboard delivery only; no external notification channel.
- A newest-first bounded alert feed, alert detail and evidence, immutable creation-time portfolio context, and acknowledge or dismiss actions.
- Alerts for eligible AAPL or SPY observations whether the instrument is held or not held.
- Separate revision validity and user disposition:
  - revision validity: `active`, `superseded`, or `retracted`; the current lineage is active or retracted while superseded revisions remain in history;
  - user disposition: `new`, `acknowledged`, or `dismissed`.
- Append-only alert evidence and lifecycle history. Corrections never delete or silently rewrite an alert.

## MVP Flow

```text
committed canonical AAPL/SPY bar
  -> deterministic breakout_plus_volume.v1 evaluation
  -> eligible signal transition
  -> durable source receipt and immutable creation-time portfolio-context claim
  -> idempotent alert materialization
  -> local dashboard feed and detail
  -> local acknowledge or dismiss event
```

PostgreSQL remains the durable authority for signal, alert, context, and user-action state. Provider connections, Redis delivery, and the dashboard are not alert-history authorities.

## Alert Eligibility and Corrections

- Only an eligible on-time fired `breakout_plus_volume.v1` occurrence may open a new alert.
- Market data that is stale, gapped, invalid, or suppressed under the accepted Phase 3 policy prevents new alert creation.
- Alert enablement records a canonical source-position start watermark. Earlier source work, including upstream backlog processed later, is never backfilled as a fresh alert; captured work after the watermark remains durable debt through retry and restart.
- A later canonical correction may supersede an active revision, retract a lineage, or reactivate a retracted lineage. It always appends evidence, preserves disposition, and never masquerades as a fresh `new` alert.
- A fired correction for a pre-cutover, disabled-interval, replay-only, or retrospective lineage that never opened an alert records an audited no-alert outcome.
- User acknowledgement or dismissal never changes the signal fact, revision validity, or current lineage projection. A correction never resets the user's disposition.
- Global lineage identity is stable across compatible signal/alert runs and splits when the signal configuration hash changes. Global revisions remain source-derived, while each live or replay target has its own context-bearing alert instance and disposition history.

## Portfolio Context

- Portfolio state never determines whether an otherwise eligible market alert is created.
- At first durable source receipt, one database snapshot freezes the terminal completed, fully validated Phase 4 current cycle/projection or an explicit unavailable result. `contextSelectedAt` is the fixed freshness-evaluation boundary; the signal observation and `knowledgeAsOf` remain separate evidence. Every retry and correction reuses the claim.
- Context stores availability, freshness, selected reconciliation, latest-attempt lifecycle, latest-attempt reconciliation, calculation completeness, membership, and holding support separately. The selected completed cycle is reconciled `converged`; a latest failed Phase 4 attempt retains its safe failure classification and reconciliation `unavailable` because no reconciliation row exists for that run. Context reuses Phase 4 `complete|incomplete` and `supported|unsupported` vocabulary and adds explicit unavailable/unknown states plus `held|not_held|unknown` membership. A failed attempt never lends partial holdings to the selection.
- No trustworthy snapshot means membership `unknown`, never not-held. Missing quantities or values are never silently filled with zero, and there is no invented portfolio `suppressed` state.
- The alert retains its creation-time context for auditability. The dashboard may show a separately labeled current portfolio view, but it must not replace historical alert evidence.
- Context is explanatory only. It does not calculate suitability, risk approval, a recommended position change, or an executable action.

## Local Access and Actions

- The dashboard and API remain bound to their exact configured loopback authorities.
- No login or remote multi-user access is part of the MVP.
- Alert feed and detail reads are bounded, versioned, deterministic, and safe for untrusted stored text.
- Acknowledge and dismiss are the only local write operations. The browser posts only to a same-origin Next.js route; exact Host/Origin, same-origin Fetch Metadata, JSON, a required non-simple action header, no CORS, and no `OPTIONS` form the browser authenticity boundary before a bounded server-to-server Fastify call.
- Commands carry a client command ID, expected disposition version, and desired state. Every response separates the immutable command outcome from the latest projection; exact retries return the original outcome plus current state, same-ID/different-input and stale versions conflict, the current desired state is a successful no-op, and there is no transition back to `new`.
- With no login, action history identifies a local installation command rather than a verified person. Native processes already running as the same operating-system user are outside this MVP's authentication boundary.
- There is no permissive CORS policy, public binding, alert-rule editor, snooze, escalation, approval, order, or broker-write route.

## Responsiveness and Reliability

- The MVP objective is p95 at or below five seconds from successful canonical-bar database commit to the first successful Next.js dashboard read containing the alert under documented healthy local conditions. A verifier-owned monotonic clock starts immediately after the persistence port receives PostgreSQL `COMMIT` acknowledgement and ends on the correlated dashboard response; provider, statement, journal, transition, and worker timestamps are not substitutes.
- The technical verifier measures at least 100 distinct eligible materializations across both instruments and accepted context combinations, includes every eligible sample, reports nearest-rank p95 at `ceil(0.95 * n)`, and requires every nominal sample to remain within five seconds.
- Lower latency is an explicit post-MVP improvement; it must not weaken durability, ordering, or evidence semantics.
- Restart, duplicate delivery, and retry converge within one target. Equivalent replay targets reproduce the same global lineage/revision content and normalized current output while retaining isolated target-local context, run, and disposition associations.

## MVP Exit Criteria

The MVP is complete only when all of the following are true:

1. P4-11's credential-gated paper-account smoke passes and Phase 4 exits truthfully.
2. P5-01 through P5-09 are implemented, validated, and have implementation notes.
3. The credential-free Phase 5 verifier covers contracts, configuration, persistence, correction handling, degraded data, API actions, dashboard rendering, replay, restart, and duplicate/retry behavior.
4. At least 100 distinct eligible fixture materializations satisfy the accepted timing method and cover held, not-held, stale, latest-attempt failure with reconciliation unavailable, incomplete, unsupported, and unavailable context dimensions without conflation.
5. The complete correction table covers supersession, retraction, reactivation, repeated corrections, no-alert correction lineages, duplicates, and preserved user disposition.
6. Three distinct complete regular core sessions run from the first through final expected minute with no unexplained AAPL/SPY bar gap, unresolved cursor gap, lost or duplicate required alert effect, failed worker, exhausted retry, or post-drain signal/alert backlog. Reconnects must be bounded and recovered; each session ends with a fresh terminal `completed` synchronization cycle with converged integrity and a clean bounded shutdown. An incomplete projection may pass only with its exact limitation visible.
7. Final review finds no public listener, external notification, rule editor, portfolio-risk decision, order intent, approval, broker mutation, live endpoint, AI call, unsafe log, or committed secret.
8. README, AGENTS, ADRs, stories, operating instructions, and implementation notes match the delivered behavior.

## Explicitly Out of Scope

- Configurable symbols, watchlists, additional venues, extended hours, or calendar coverage beyond the accepted snapshot.
- Additional signal definitions, alert-rule editing, portfolio-risk alerts, recommendations, or position actions.
- External notifications, snooze, escalation, custom filters, or alert charts.
- Hosted deployment, remote access, authentication, or multiple users.
- Historical strategy backtesting, profitability claims, or strategy optimization beyond deterministic scenario replay.
- Order intents, approvals, paper execution, live execution, or any broker mutation.
- AI research, news, filings, or generated trading analysis.

Post-MVP outcomes and their authorization boundaries are defined in [`post-mvp-roadmap.md`](./post-mvp-roadmap.md).
