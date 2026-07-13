# P4-01: Define Portfolio Contracts and Decisions

## User Story

As a platform developer, I want exact, versioned portfolio and broker-observation contracts so that synchronization, reconciliation, calculation, storage, and presentation share one read-only meaning.

## Acceptance Criteria

- ADRs 0012-0014 are accepted before a paper broker connection, portfolio persistence, or calculation is added. They fix the read-only provider boundary, non-atomic snapshot meaning, append-only synchronization and reconciliation model, valuation authority, arithmetic limits, and percentage rounding.
- A provider-, framework-, and persistence-independent `@daily-trader/portfolio` package owns immutable application contracts for account observations, cash, positions, observed broker orders, observed fills, synchronization cycles, reconciliation, valuation evidence, and portfolio projections. It is included in root build, typecheck, and test ownership without making `@daily-trader/domain`, `@daily-trader/market-data`, or `@daily-trader/signals` depend on it.
- Contracts use application-owned instrument, UTC timestamp, currency, exact-decimal, money, price, and quantity primitives. No exact financial value crosses a boundary as JavaScript `number`, and missing data is never represented as zero.
- Every external observation retains schema version, provider, paper environment, stable source identifier, provider as-of time when supplied, local receipt time, and a nonsecret account fingerprint. Raw account identifiers, credentials, and complete provider payloads do not enter portfolio contracts.
- One cycle contract records pending, completed, or failed state; a bounded knowledge interval; complete resource membership; counts; and failure classification. It never claims that separately fetched broker resources are an atomic point-in-time snapshot.
- Position contracts preserve the full account. USD `us_equity` positions may be supported for complete projections; every other holding remains visible as explicitly unsupported rather than being filtered, coerced to AAPL/SPY, or assigned a synthetic value.
- Broker order and fill contracts are observations only. They are distinct from `OrderIntent`, executable `Order`, approval, and broker-request types and expose no mutation behavior.
- Reconciliation contracts mean provider-observation-versus-local-projection integrity under ADR 0013. They do not claim independent accounting reconstruction from fills.
- Portfolio projection contracts distinguish complete from suppressed results, bind the complete cycle, arithmetic-policy and valuation-policy versions, retain exact aggregate operands, and preserve unavailable reasons without silent partial sums.

## Validation

- Unit-test contract construction, immutability, canonical serialization, stable identities, source/as-of context, cycle states, complete membership, unsupported holdings, observed-order separation, reconciliation states, suppressed projections, and rejection of invalid exact values or raw provider shapes.
- Inspect package dependencies and public exports to prove no provider SDK, HTTP, PostgreSQL, web, alert, risk, order-submission, execution, or signal-rule behavior leaks into the package.

## Dependencies

- Completed P3-09 Phase 3 exit.

## Out of Scope

Do not add environment configuration, connect to a broker, persist a cycle, calculate a portfolio, expose an API or dashboard, create an alert or risk decision, or define an executable order.
