# P5-02: Add Safe Local Alert Configuration

## User Story

As a local operator, I want alert processing disabled by default and fixed to the accepted MVP boundary so that enabling the dashboard alert path cannot silently broaden symbols, delivery, access, or trading authority.

## Acceptance Criteria

- Configuration adds `ALERT_MODE=disabled` as the safe default and `ALERT_MODE=local_dashboard` as the only enabled value. Disabled mode opens no alert database consumer, delivery channel, or action listener beyond the existing disabled-safe application shells.
- Enabled mode fixes the definition to `breakout_plus_volume.v1`, the scope to AAPL/XNAS and SPY/ARCX one-minute regular-session observations, and delivery to the loopback dashboard. It accepts no configurable symbol list, provider, signal type, rule threshold, external channel, hosted origin, public bind address, or multi-user mode.
- Enablement requires one compatible active `live_journal` signal capture and atomically records a canonical `start_after_source_position`; pre-watermark signal backlog is never fresh alert work. Same-configuration restart resumes the durable alert run, while disable, re-enable, and signal/configuration handoff follow ADR 0015's finite stop/start-watermark rules.
- `BROKER_MODE` remains paper and `EXECUTION_ENABLED` remains false. Alert configuration exposes no recommendation, portfolio-risk override, approval, order intent, broker endpoint, broker method, or execution permission.
- Market-data and paper-broker credentials remain separately named and are never copied into alert configuration. Credential-free contract, fixture, replay, API, dashboard, and technical verification paths remain possible.
- Bounded poll or delivery cadence, processing batch, retry, queue/backlog, statement timeout, claim lease, shutdown, dashboard refresh, and user-action request limits are parsed once and validated together. Accepted bounds make the five-second objective possible without weakening backpressure or durability.
- The canonical web/API loopback authorities, exact browser origin/host, required action header, and fixed server-to-server target are validated together. Unknown alert-prefixed settings fail before a database, provider, or listener connection starts. Invalid local origin, forwarded/public host, mode, scope, definition, bound, or execution setting fails closed.
- Safe diagnostics expose only fixed scope, mode, versions, low-cardinality operational bounds, and booleans. They never expose URLs, credentials, account identifiers, alert evidence, portfolio values, internal identities, or raw configuration.

## Validation

- Test safe defaults, one valid local enabled configuration, activation with upstream backlog, same-config resume, disable/drain/re-enable, compatible and incompatible signal handoff, fixed values, unknown settings, public or changed hosts, external channels, changed symbols or definition, incompatible bounds, live/execution settings, partial credentials, and redacted diagnostics.
- Prove invalid configuration exits before alert persistence, processing, API actions, dashboard delivery, or provider access begins.

## Dependencies

- P5-01 alert contracts and accepted decisions.

## Out of Scope

Do not process a signal, persist an alert, add a dashboard, choose a hosted deployment, add authentication, or create a broker capability.
