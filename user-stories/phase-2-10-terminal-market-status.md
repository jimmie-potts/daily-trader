# P2-10: Display Latest Prices and Stream Health

## User Story

As an operator, I want concise terminal market status so that I can tell what data was received, how old it is, and whether the feed is usable.

## Acceptance Criteria

- The worker displays the latest persisted one-minute-bar close for AAPL and SPY, clearly labeled as a bar close rather than a quote.
- Each instrument shows bar/as-of time, receive time, calculated age, freshness classification, source/feed identity, and entitlement or delay status.
- Overall output shows connection lifecycle state, last successful event, detected gap state, and persistence/delivery health. Transport-connected and data-fresh remain independent states.
- Deterministic ordering and injected time make rendered status stable in tests; closed-market behavior follows P2-01 rather than declaring an expected quiet period stale.
- Missing, stale, delayed, late, or gapped data is explicit. The display never fills a price with zero, substitutes another instrument, or labels delayed data real time.
- Output uses normalized/persisted application data, contains no raw payload or secret, and does not become a separate source of truth.

## Validation

- Snapshot or assertion-test fresh, delayed, stale, disconnected, reconnecting, gap, no-data, late-bar, closed-market, and partial AAPL/SPY states with a fixed clock.
- Run the terminal against the sanitized replay and the credential-gated provider smoke session.

## Dependencies

- P2-06 stream lifecycle and recovery.
- P2-08 latest-bar persistence.
- P2-09 sanitized recorded-session replay.

## Out of Scope

No web dashboard, charting, signals, alerts, portfolio context, recommendations, or trading controls are added.
