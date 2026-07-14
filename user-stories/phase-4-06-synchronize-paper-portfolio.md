# P4-06: Synchronize the Paper Portfolio Reliably

## User Story

As an operator, I want a bounded recoverable worker to synchronize the full paper account so that restarts and provider failures cannot promote a partial or ambiguous portfolio.

## Acceptance Criteria

- A dedicated `workers/portfolio` process owns orchestration behind the P4-03 adapter and P4-05 repository ports. Root build, typecheck, test, dev, start, smoke, status, and verification commands plus operating documentation are updated when the worker exists.
- Disabled mode opens no broker connection and creates no synchronization debt. Explicit `paper_read_only` mode acquires one fenced lease for the expected account fingerprint before starting a cycle.
- Each poll fetches account, the bounded complete position collection, all observed-order pages, and all fill-activity pages for one bounded open provider-created query interval. It validates the authenticated account before promotion and passes only complete normalized membership to persistence.
- Polling, page and response limits, request and database timeouts, retry attempts, exponential backoff with jitter, rate-limit handling, lease renewal, staleness threshold, and shutdown follow the P4-02 bounds. Retry never changes a deterministic observation identity or treats an incomplete page as success.
- Authentication, endpoint, expected-account, unsupported schema, response-capacity, cursor-loop, and exhausted retry failures stop or degrade with typed safe state. A transient transport, rate-limit, or database failure leaves the current complete snapshot intact and permits bounded later recovery.
- Restart abandons or closes any unpromoted cycle safely, reacquires a fence, and begins or resumes only behavior supported by durable state. Overlapping processes cannot both promote current state.
- Shutdown stops new polls, cancels or completes in-flight GET requests within the deadline, commits or rolls back persistence, releases the worker lease, closes PostgreSQL and telemetry, and never calls a broker mutation.
- Metrics cover fixed resource/outcome counts, cycle duration, knowledge-interval width, pages, retries and rate limits, last complete age, current staleness, reconciliation state, lease loss, and lifecycle without account, order, fill, position, or credential labels.
- Terminal status uses one database-clock observation to classify the lease as current, expired, not held, or invalid for a future-heartbeat anomaly. It exposes bounded heartbeat and expiry timestamps but no owner, fence, account, or internal synchronization identifier.

## Validation

- Test disabled startup, valid empty and populated cycles, complete pagination, retry/rate limit, auth and account mismatch, malformed resource, partial failure at each boundary, capacity, lease contention/loss, database-clock current/expired/not-held/future-heartbeat status, database outage/recovery, crash before/after promotion, restart, staleness, and bounded shutdown.
- Prove every provider request is GET, no failed cycle changes current state, and a clean restart converges on the same normalized current projection.

## Dependencies

- P4-02 safe operational configuration.
- P4-03 read-only adapter.
- P4-04 normalization.
- P4-05 append-only persistence.

## Out of Scope

Do not use Redis as portfolio authority, subscribe to a trading stream, send alerts, derive risk decisions, synchronize a live account, or create, replace, cancel, or close any broker object.
