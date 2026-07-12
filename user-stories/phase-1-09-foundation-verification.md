# P1-09: Verify and Hand Off the Foundation

## User Story

As a new contributor, I want a documented end-to-end setup path so that I can verify the Phase 1 foundation without hidden knowledge or financial credentials.

## Acceptance Criteria

- The root `README.md` provides prerequisites, installation, local-service startup, quality-check, test, build, run, stop, and intentional reset instructions using commands that actually exist.
- `AGENTS.md` reflects the implemented repository structure and commands while retaining every safety and architecture boundary.
- A clean-checkout verification starts local dependencies, validates configuration, runs all quality gates, and exercises the minimal observable process.
- Health output makes the local environment and disabled execution state unmistakable.
- The verification requires no broker account, API key, live endpoint, or market data.
- Known limitations and the Phase 2 handoff are documented: connect a paper-compatible feed for AAPL and SPY behind a replaceable adapter.
- No unresolved secret, unsafe default, live-execution, or dependency-security issue remains unreported.

## Validation

- Follow the documented setup from a clean checkout or equivalent isolated environment.
- Record the exact commands and results in the pull request.
- Review the final diff for generated files, credentials, sensitive payloads, live endpoints, and phase-scope creep.

## Exit Criterion

Phase 1 is complete when a contributor can reproduce the full foundation workflow and CI passes with paper-only, execution-disabled defaults. Streaming, persistence of market bars, signals, and replay remain Phase 2 or later work.
