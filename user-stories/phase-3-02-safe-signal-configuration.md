# P3-02: Add Safe Versioned Signal Configuration

## User Story

As an operator, I want immutable validated signal configuration so that a run cannot silently change its rule, scope, thresholds, or evidence requirements.

## Acceptance Criteria

- `@daily-trader/config` defaults signal evaluation to disabled and requires an explicit monitoring-only mode to enable the approved `breakout_plus_volume` definition.
- Configuration is fixed to AAPL/XNAS and SPY/ARCX one-minute canonical bars, known NYSE core sessions, and the one accepted definition version. Extra symbols, event kinds, sessions, definitions, or unknown fields fail before a worker or service connection starts.
- One shared lookback-window length is a bounded integer. The volume multiplier is a canonical exact-decimal string validated without JavaScript `number` conversion; accepted ADRs define its safe range. Breakout references are derived from evidence, not configured thresholds.
- The effective definition version, configuration version, and canonical configuration hash are frozen for the full signal run and persisted with every evaluation. Runtime mutation or partial reload is rejected rather than changing a running rule.
- Journal polling, claim batch, in-memory queue, retry/backoff, unprocessed-backlog limit, statement timeout, and shutdown bounds are parsed once, validated together, and attached to the run configuration. Reaching a capacity bound fails safely instead of dropping a canonical revision.
- Replay receives its effective configuration from the verified run manifest and rejects a mismatch instead of substituting ambient environment values.
- Safe diagnostics expose only the monitoring mode, approved scope, definition version, bounded counts, and canonical nonsecret multiplier. Signal configuration adds no credential, broker endpoint, alert channel, execution flag, or live-trading capability.
- Fixture and replay modes remain credential-free, and execution remains disabled under every accepted configuration.

## Validation

- Test disabled defaults, one valid monitoring configuration, immutability, stable configuration hashing, replay mismatch, and every rejected symbol, definition, version, multiplier, window, unknown-field, and runtime-mutation case.
- Prove invalid configuration fails before PostgreSQL or worker startup and that diagnostics contain no existing market-data credential.

## Dependencies

- P3-01 signal decisions and contracts.

## Out of Scope

Do not evaluate a signal, fetch dynamic strategy settings, add a web editor, connect to a provider or broker, send an alert, or enable execution.
