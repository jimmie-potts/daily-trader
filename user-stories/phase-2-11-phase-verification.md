# P2-11: Verify and Hand Off Phase 2

## User Story

As a contributor, I want one reproducible Phase 2 verification path so that the market-data slice can be extended without hidden provider, persistence, or replay assumptions.

## Acceptance Criteria

- A credential-free verification command runs root quality gates, starts healthy local services, applies/checks migrations, ingests a sanitized session, exercises Redis delivery and TimescaleDB persistence, renders terminal status, replays twice, and cleans up bounded process resources.
- The failure matrix covers authentication/entitlement rejection, malformed numeric and timestamp tokens, wrong symbols, inactivity, disconnect/retry exhaustion, gaps, duplicates, late/out-of-order events, stale data, Redis/database outage, redelivery, and corrupt replay input.
- A separately documented credential-gated smoke test proves an actual AAPL/SPY subscription, actual feed/entitlement reporting, normalized one-minute bars, and graceful shutdown without recording sensitive frames.
- `README.md`, `AGENTS.md`, ADRs, migrations, fixtures, commands, diagrams where useful, and story implementation notes match actual behavior.
- The final review finds no credential, raw sensitive payload, live-broker endpoint, execution path, extra symbol, provider type in domain code, unsafe floating-point conversion, or unbounded retry/buffer.
- Root CI passes, dependency-security findings are reported, and any provider check that could not run is explicitly recorded rather than represented as passing.

## Validation

- Run the documented workflow from a clean or equivalent isolated checkout and record exact commands/results in the P2-11 implementation note.
- Restart services and rerun replay to prove durable, idempotent behavior.

## Dependencies

- P2-01 through P2-10.

## Exit Criterion

Phase 2 is complete only when AAPL/SPY provider bars, recovery, durable delivery, persistence, replay, and truthful terminal status are demonstrated. Signals, portfolios, alerts, orders, broker execution, AI research, additional assets, Kafka, and live brokerage remain excluded.
