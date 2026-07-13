# P4-02: Add Safe Read-Only Portfolio Configuration

## User Story

As an operator, I want paper-portfolio synchronization disabled by default and tightly configured so that credentials can never enable a broker mutation or ambiguous account connection.

## Acceptance Criteria

- `@daily-trader/config` adds an explicit portfolio mode with only `disabled` and `paper_read_only`; the default is `disabled`. Paper broker credentials already present while disabled do not open a connection.
- Enabled mode fixes the provider to Alpaca paper Trading API base `https://paper-api.alpaca.markets/v2` and requires a complete separately named broker credential pair plus the expected paper account identifier. Market-data credentials are never silently reused or aliased.
- A changed scheme, origin, port, path, query, fragment, API version, redirect policy, provider, environment, or live-broker setting fails before any listener, database, or provider connection starts. `BROKER_MODE` remains paper and `EXECUTION_ENABLED` remains false under every accepted configuration.
- Poll interval, request timeout, maximum response bytes, page size and page count, retry attempts, exponential-backoff and jitter bounds, synchronization staleness threshold, database statement timeout, worker lease, and shutdown deadline are parsed once and validated together.
- Unknown `PORTFOLIO_` or paper-broker settings fail explicitly. Configuration has no order endpoint, mutation permission, alert channel, risk override, live-account mode, or execution switch.
- Safe diagnostics expose only environment, disabled/read-only mode, provider, exact approved resource names, bounded operational settings, and booleans for endpoint, complete credentials, and expected-account configuration. They expose no URL, key, secret, account identifier, or account fingerprint.
- Fixture, unit, migration, and verification paths remain credential-free. A separate provider smoke may require paper credentials but cannot run unless the read-only mode and exact boundary validate.

## Validation

- Test safe defaults, one valid enabled configuration, frozen values, every endpoint mutation, partial credentials, missing expected account, market-data credential non-aliasing, live settings, execution enablement, unknown setting, incompatible bound, and redaction case.
- Prove invalid configuration exits before HTTP or PostgreSQL startup and recognizable test credentials and account IDs do not appear in diagnostics, logs, errors, or snapshots.

## Dependencies

- P4-01 portfolio contracts and accepted decisions.

## Out of Scope

Do not connect to Alpaca, fetch an account, persist data, calculate a portfolio, add remote secret storage, or enable any broker write.
