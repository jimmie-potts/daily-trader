# P1-07: Establish Observability Conventions

## User Story

As an operator, I want consistent logs, metrics, and traces so that failures and latency can be diagnosed before real-time features are added.

## Acceptance Criteria

- A shared observability module configures structured logging, metrics, and tracing for Node.js processes.
- Logs include service, environment, severity, timestamp, and correlation identifiers when present.
- A centralized redaction policy prevents secrets, tokens, account identifiers, and full sensitive provider payloads from being logged.
- Metrics follow documented naming, unit, label-cardinality, and timestamp conventions.
- Trace context can cross an in-process application boundary without coupling domain code to OpenTelemetry.
- Exporters are configurable; local startup remains useful when an external collector is unavailable.
- A minimal process emits a startup log, health metric, and trace, with tests for redaction and configuration failure.

## Validation

- Run the minimal process and inspect machine-readable log output.
- Confirm a known secret-like test value is redacted.
- Confirm exporter failure does not create an unbounded retry loop or expose sensitive configuration.

## Out of Scope

Do not define market-feed, signal, risk, alert, order, or broker metrics before those components exist. Do not add hosted observability accounts or production deployment configuration.
