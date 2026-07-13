# `@daily-trader/signals`

Pure, provider-independent Phase 3 feature and signal behavior.

The package accepts application-owned canonical one-minute AAPL/XNAS and SPY/ARCX bars, builds bounded contiguous same-session reference windows, and evaluates only `breakout_plus_volume.v1`. It consumes the provider-neutral canonical-revision contract from `@daily-trader/market-data`, never a provider payload, Redis envelope, mutable database row, or ambient wall clock.

Exact price and volume arithmetic is isolated behind a string-only `big.js` 7.0.1 wrapper. Inputs and results are bounded to 48 significant digits and 18 fractional digits. The wrapper exposes comparison, addition, multiplication, and multiplication by a bounded count only; it never accepts JavaScript numbers or silently rounds an overflow. The rule uses strict breakout price comparison and accepts exact equality at the volume threshold.

Every feature result is ready or explicitly suppressed. Every evaluation is fired, not fired, or suppressed, with immutable observation/knowledge-as-of context, on-time/retrospective mode, ordered evidence, and semantic identities. Run-scoped transitions preserve initial, superseding, and retracting history separately from global deterministic evaluation identity. An occurrence is an observation, not a recommendation, alert, portfolio action, order intent, or execution request.

The replay core verifies a separately versioned catalog, schedule, and manifest before deriving a session-local canonical revision stream through `@daily-trader/market-data`'s production transition decider. It exports deterministic target ordinals and canonical signal output while keeping live journal positions and database identifiers outside replay output. `SignalReplayPersistencePort` is the production integration seam for target lifecycle and complete feature/evaluation/transition persistence.

`fixtures/recordings/synthetic-phase3-signal-session-v1.json` is credential-free and fixed to lookback `3`, volume multiplier `1.5`, and freshness threshold `120000`. Regenerate it only after an intentional semantic or fixture review:

```bash
npm run build --workspace=@daily-trader/domain --workspace=@daily-trader/market-data --workspace=@daily-trader/signals
node packages/signals/fixtures/generate-synthetic.js
```

Run `npm run signal:recording:verify` from the repository root to verify the committed artifact and expected canonical output without PostgreSQL or credentials. PostgreSQL persistence and inspection belong to `workers/signals/` and the root `signal:replay` commands.

Pure package checks are implementation evidence only. Phase 3 completion still requires the P2-11 provider-bar prerequisite plus the Docker/PostgreSQL clean-target, existing-state, interrupted/restart replay, persistence, and status validation described by the user stories.
