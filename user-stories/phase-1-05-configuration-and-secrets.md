# P1-05: Validate Configuration and Protect Secrets

## User Story

As an operator, I want configuration to fail safely so that the application cannot start in an ambiguous environment or expose sensitive values.

## Acceptance Criteria

- A shared configuration module parses environment variables into typed, application-owned settings at process startup.
- Missing, malformed, or contradictory required values produce actionable errors without echoing secret values.
- Environment is explicit and distinguishable, with paper mode and execution disabled as defaults.
- An `.env.example` lists names and safe descriptions only; real `.env` files, credentials, certificates, account exports, and tokens are ignored.
- Paper and any future live endpoints or credentials use separate configuration keys.
- Configuration exposes safe metadata for diagnostics while redacting secrets and account identifiers.
- Automated tests cover valid settings, missing values, invalid values, redaction, and safe defaults.

## Validation

- Start a minimal process with valid local settings.
- Verify invalid configuration exits before opening listeners or connecting to external services.
- Search tracked files and test output for credential-like values and live broker endpoints.

## Out of Scope

Do not add real provider credentials, production secret-store integration, live endpoints, account synchronization, or execution permissions.
