# MVP Setup Prerequisites

- Status: Accepted planning inventory
- Last updated: 2026-07-15

This inventory separates credential-free development from the external evidence required before Phase 5 implementation and MVP exit. It introduces no new account, provider, or permission.

## Required Accounts and Credentials

| Purpose                                                                   | Required account or service                                                                             | Local environment values                                                                                       | When required                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Normal development, CI, fixtures, migrations, replay, API/dashboard tests | No external financial account                                                                           | None                                                                                                           | Always credential-free                      |
| P4-11 GET-only provider smoke                                             | One Alpaca paper-trading account, a dedicated paper credential pair, and that account's expected raw ID | `PAPER_BROKER_API_KEY`, `PAPER_BROKER_API_SECRET`, `PAPER_BROKER_ACCOUNT_ID`; `PORTFOLIO_MODE=paper_read_only` | Before any Phase 5 implementation begins    |
| Three-session MVP market-data soak                                        | Alpaca Market Data credentials entitled to the fixed IEX AAPL/SPY feed                                  | `MARKET_DATA_API_KEY`, `MARKET_DATA_API_SECRET`; `MARKET_DATA_MODE=paper`                                      | At MVP operating verification               |
| Three-session MVP portfolio soak                                          | The same expected Alpaca paper account and dedicated paper credential pair used for P4-11               | The paper-broker values above; `PORTFOLIO_MODE=paper_read_only`                                                | At MVP operating verification               |
| Local PostgreSQL/TimescaleDB and Redis                                    | Local container runtime; no hosted account required                                                     | Safe Compose defaults, or optional `DATABASE_URL` and `REDIS_URL` loopback overrides                           | Service-backed development and verification |

Market-data and paper-broker credentials remain separate even if Alpaca issued them under one user account. Use only minimum paper/read permissions supported by the provider. The broker endpoint remains pinned to `https://paper-api.alpaca.markets/v2`, and the market-data feed remains pinned to `wss://stream.data.alpaca.markets/v2/iex`.

## Required Operating Modes

| Process      | Required enabled mode            | Delivery status                                              |
| ------------ | -------------------------------- | ------------------------------------------------------------ |
| Market data  | `MARKET_DATA_MODE=paper`         | Implemented                                                  |
| Signals      | `SIGNAL_MODE=monitor`            | Implemented                                                  |
| Portfolio    | `PORTFOLIO_MODE=paper_read_only` | Implemented                                                  |
| Local alerts | `ALERT_MODE=local_dashboard`     | Planned contract; P5-02 must implement and validate it first |

All four modes default to `disabled`; the planned alert value is documentation only until P5-02 delivers it. No mode enables risk decisions, order intents, broker mutation, or execution.

## Not Required for the MVP

- A live brokerage account, live endpoint, live credential, or broker-write permission.
- An OpenAI, news, filing, social-media, notification, email, SMS, or analytics API key.
- A hosted database, hosted Redis, cloud deployment, domain, TLS certificate, OAuth client, or user-authentication provider.
- A nonempty paper portfolio, existing order, or existing fill. The accepted GET-only provider smoke permits legitimately empty resources.

## Current External Blocker

P4-11 remains open until `npm run portfolio:provider-smoke` succeeds against the explicitly expected paper account and the safe result is recorded. Fixture success and the credential-free Phase 4 matrix do not substitute for this check. Planning documentation may merge now, but P5-01 implementation must not begin before P4-11 closes.

## Secret Handling

Copy [`.env.example`](../../.env.example) only to an ignored local `.env` or another ignored environment file. Never commit, print, paste into implementation notes, or expose credentials, raw account IDs, full provider payloads, or local connection strings. Keep all `LIVE_BROKER_*` values empty; current configuration rejects them.

The canonical setup commands and safe provider-smoke instructions remain in the root [`README.md`](../../README.md#local-services). This document is the product-planning inventory, not an alternate runtime configuration source.
