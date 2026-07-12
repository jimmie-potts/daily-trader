# ADR 0005: Test Strategy

- Status: Accepted
- Date: 2026-07-11

## Context

The foundation needs fast deterministic feedback and conventions that can expand to adapter, persistence, replay, and failure testing.

## Decision

Use Vitest with co-located `*.test.ts` files for unit tests. Root commands run all tests once, in watch mode, or with V8 coverage. Coverage is diagnostic; risk determines required cases, not a repository-wide percentage.

Use injected clocks and explicit immutable fixtures. Add contract tests with sanitized recordings at provider boundaries, integration tests for persistence and delivery, and replay/failure tests when those production interfaces exist.

## Consequences

Phase 1 tests use no network, broker credential, or live market data. Defect fixes should add regression tests whenever practical.
