# P4-03 Implementation Note

- Status: Complete
- Completed: 2026-07-13

## What Was Implemented

`workers/portfolio` defines an application-owned read port for account, positions, observed orders, and fill activities. The Alpaca adapter can issue only `GET /account`, `GET /positions`, `GET /orders`, and `GET /account/activities/FILL` beneath the exact paper origin. There is no generic request escape hatch or submit, replace, cancel, close, account-change, or other mutation method.

The injected HTTP boundary sends credentials only to the approved HTTPS origin, rejects redirects, bounds deadlines, response bytes, pages, and items, and supports cancellation and shutdown. Its exported constructor derives safe item defaults from reduced page budgets and rejects explicit order or fill limits that leave no request capacity for a short terminal page. The bounded position collection and order/fill pagination fail closed on loops, missing continuation, truncation, excess capacity, malformed responses, authentication/account mismatch, rate limit, timeout, or provider failure. Alpaca applies the fill query's `after` and `until` bounds exclusively to activity creation time, while returned fills expose only the separate execution timestamp. Each persisted interval is therefore open on both ends. The initial bounded query is explicitly a baseline rather than full account history; later queries move the lower bound before the prior cutover so a seam activity remains eligible, then rely on identity-based deduplication. Sanitized fixtures and a deterministic fake exercise the same port without credentials.

## Validation Evidence

- `npm test --workspace=@daily-trader/portfolio-worker`: **Pass** - 10 test files/67 tests; adapter, normalization, persistence, and HTTP tests verified exactly four GET operations, allowed paths and origin, pagination, strict page/item capacity, nested multi-leg parents and concrete child legs with omitted fields, exclusive created-at bounds and overlap, retries, response limits, redirects, cancellation, account mismatch, safe errors, and bounded shutdown.
- Fixture verification passed through the production adapter and normalization boundary without a network connection or broker credential.
- Production export review found no broker-write operation or generic HTTP capability.

## Handoff

The adapter is safe to use only for the four accepted paper-account reads. Fill completeness means complete pagination for one open provider-created query interval, not complete execution-time history or a gap-free ledger. The separately credential-gated `npm run portfolio:provider-smoke` has not run, so this implementation note proves the adapter contract and fixture behavior, not external account access or the Phase 4 exit.
