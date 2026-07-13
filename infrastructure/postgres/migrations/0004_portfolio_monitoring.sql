CREATE TABLE portfolio_sync_runs (
  sync_run_id text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  source_provider text NOT NULL CHECK (source_provider = 'alpaca'),
  source_environment text NOT NULL CHECK (source_environment = 'paper'),
  snapshot_schema_version text NOT NULL CHECK (
    snapshot_schema_version = 'daily-trader.portfolio.sync-snapshot.v1'
  ),
  account_fingerprint character(64) CHECK (
    account_fingerprint IS NULL OR account_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  configuration_version text NOT NULL CHECK (
    configuration_version = 'daily-trader.portfolio.config.v1'
  ),
  configuration_hash character(64) NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  configuration_payload text NOT NULL,
  claim_owner_id text NOT NULL,
  claim_fence bigint NOT NULL CHECK (claim_fence > 0),
  capture_started_at timestamptz NOT NULL,
  knowledge_start_at timestamptz,
  knowledge_end_at timestamptz,
  capture_completed_at timestamptz,
  activity_window_started_at timestamptz,
  activity_cutover_at timestamptz,
  activity_baseline_only boolean,
  final_capture_attempt integer CHECK (
    final_capture_attempt IS NULL OR final_capture_attempt BETWEEN 1 AND 1000
  ),
  position_count integer CHECK (position_count IS NULL OR position_count >= 0),
  order_count integer CHECK (order_count IS NULL OR order_count >= 0),
  fill_count integer CHECK (fill_count IS NULL OR fill_count >= 0),
  unsupported_position_count integer CHECK (
    unsupported_position_count IS NULL OR unsupported_position_count >= 0
  ),
  snapshot_hash character(64) CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  snapshot_payload text,
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (sync_run_id ~ '^portfolio-sync-[a-z0-9-]{1,96}$'),
  CHECK (claim_owner_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  CHECK (knowledge_end_at IS NULL OR knowledge_start_at IS NOT NULL),
  CHECK (knowledge_end_at IS NULL OR knowledge_end_at >= knowledge_start_at),
  CHECK (capture_completed_at IS NULL OR capture_completed_at >= capture_started_at),
  CHECK (
    (activity_window_started_at IS NULL AND activity_cutover_at IS NULL
      AND activity_baseline_only IS NULL)
    OR
    (activity_window_started_at IS NOT NULL AND activity_cutover_at IS NOT NULL
      AND activity_baseline_only IS NOT NULL
      AND activity_window_started_at <= activity_cutover_at)
  ),
  CHECK (
    (state = 'pending' AND capture_completed_at IS NULL AND final_capture_attempt IS NULL
      AND failure_code IS NULL
      AND activity_window_started_at IS NULL AND activity_cutover_at IS NULL
      AND activity_baseline_only IS NULL AND snapshot_hash IS NULL)
    OR
    (state = 'completed' AND capture_completed_at IS NOT NULL
      AND final_capture_attempt IS NOT NULL AND failure_code IS NULL
      AND account_fingerprint IS NOT NULL AND knowledge_start_at IS NOT NULL
      AND knowledge_end_at IS NOT NULL AND position_count IS NOT NULL
      AND activity_window_started_at IS NOT NULL AND activity_cutover_at IS NOT NULL
      AND activity_baseline_only IS NOT NULL
      AND activity_cutover_at >= knowledge_start_at
      AND activity_cutover_at <= knowledge_end_at
      AND order_count IS NOT NULL AND fill_count IS NOT NULL
      AND unsupported_position_count IS NOT NULL AND snapshot_hash IS NOT NULL
      AND snapshot_payload IS NOT NULL)
    OR
    (state = 'failed' AND capture_completed_at IS NOT NULL
      AND final_capture_attempt IS NULL AND failure_code IS NOT NULL
      AND activity_window_started_at IS NULL AND activity_cutover_at IS NULL
      AND activity_baseline_only IS NULL
      AND snapshot_hash IS NULL AND snapshot_payload IS NULL)
  )
);

CREATE INDEX portfolio_sync_runs_state_completed_idx
  ON portfolio_sync_runs (state, capture_completed_at DESC, sync_run_id DESC);

CREATE TABLE portfolio_sync_requests (
  sync_run_id text NOT NULL REFERENCES portfolio_sync_runs(sync_run_id),
  schema_version text NOT NULL CHECK (
    schema_version = 'daily-trader.portfolio.request-receipt.v1'
  ),
  capture_attempt integer NOT NULL CHECK (capture_attempt BETWEEN 1 AND 1000),
  resource text NOT NULL CHECK (resource IN ('account', 'positions', 'orders', 'fills')),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  provider_request_fingerprint character(64) NOT NULL CHECK (
    provider_request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  observed_at timestamptz NOT NULL,
  response_status integer NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  PRIMARY KEY (sync_run_id, capture_attempt, resource, ordinal),
  UNIQUE (sync_run_id, provider_request_fingerprint)
);

CREATE TABLE portfolio_account_observations (
  sync_run_id text PRIMARY KEY REFERENCES portfolio_sync_runs(sync_run_id),
  schema_version text NOT NULL CHECK (
    schema_version = 'daily-trader.portfolio.account-observation.v1'
  ),
  account_fingerprint character(64) NOT NULL CHECK (account_fingerprint ~ '^[0-9a-f]{64}$'),
  source_request_fingerprint character(64) NOT NULL CHECK (
    source_request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  provider_created_at_original text NOT NULL,
  provider_created_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  status text NOT NULL,
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  cash numeric NOT NULL,
  equity numeric NOT NULL,
  last_equity numeric NOT NULL,
  portfolio_value numeric NOT NULL,
  buying_power numeric,
  non_marginable_buying_power numeric,
  regt_buying_power numeric,
  long_market_value numeric NOT NULL,
  short_market_value numeric NOT NULL,
  initial_margin numeric,
  maintenance_margin numeric,
  last_maintenance_margin numeric,
  accrued_fees numeric,
  pending_transfer_in numeric,
  pending_transfer_out numeric,
  multiplier numeric,
  account_blocked boolean NOT NULL,
  trading_blocked boolean NOT NULL,
  transfers_blocked boolean NOT NULL,
  trade_suspended_by_user boolean NOT NULL,
  shorting_enabled boolean NOT NULL,
  canonical_hash character(64) NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload text NOT NULL,
  FOREIGN KEY (sync_run_id, source_request_fingerprint)
    REFERENCES portfolio_sync_requests(sync_run_id, provider_request_fingerprint)
);

CREATE TABLE portfolio_position_observations (
  sync_run_id text NOT NULL REFERENCES portfolio_sync_runs(sync_run_id),
  schema_version text NOT NULL CHECK (
    schema_version = 'daily-trader.portfolio.position-observation.v1'
  ),
  provider_asset_id text NOT NULL,
  symbol text NOT NULL,
  instrument_id text CHECK (
    instrument_id IS NULL OR instrument_id ~ '^[A-Z0-9]{4}:[A-Z0-9]+([.-][A-Z0-9]+)*$'
  ),
  provider_exchange text NOT NULL,
  asset_class text NOT NULL,
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source_request_fingerprint character(64) NOT NULL CHECK (
    source_request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  supported_for_projection boolean NOT NULL,
  unsupported_reason text,
  asset_marginable boolean NOT NULL,
  side text NOT NULL CHECK (side IN ('long', 'short')),
  quantity numeric NOT NULL,
  quantity_available numeric,
  average_entry_price numeric,
  cost_basis numeric,
  market_value numeric,
  current_price numeric,
  last_day_price numeric,
  change_today numeric,
  unrealized_profit_loss numeric,
  unrealized_profit_loss_percent numeric,
  unrealized_intraday_profit_loss numeric,
  unrealized_intraday_profit_loss_percent numeric,
  observed_at timestamptz NOT NULL,
  canonical_hash character(64) NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload text NOT NULL,
  PRIMARY KEY (sync_run_id, provider_asset_id),
  UNIQUE (sync_run_id, symbol),
  FOREIGN KEY (sync_run_id, source_request_fingerprint)
    REFERENCES portfolio_sync_requests(sync_run_id, provider_request_fingerprint),
  CHECK (
    (supported_for_projection AND unsupported_reason IS NULL)
    OR (NOT supported_for_projection AND unsupported_reason IS NOT NULL)
  )
);

CREATE INDEX portfolio_position_observations_symbol_idx
  ON portfolio_position_observations (symbol, sync_run_id);

CREATE TABLE portfolio_order_observations (
  sync_run_id text NOT NULL REFERENCES portfolio_sync_runs(sync_run_id),
  schema_version text NOT NULL CHECK (
    schema_version = 'daily-trader.portfolio.order-observation.v1'
  ),
  provider_order_id text NOT NULL,
  client_order_id text NOT NULL,
  provider_asset_id text,
  symbol text NOT NULL,
  instrument_id text CHECK (
    instrument_id IS NULL OR instrument_id ~ '^[A-Z0-9]{4}:[A-Z0-9]+([.-][A-Z0-9]+)*$'
  ),
  asset_class text NOT NULL,
  supported_for_monitoring boolean NOT NULL,
  unsupported_reason text,
  source_request_fingerprint character(64) NOT NULL CHECK (
    source_request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  side text NOT NULL,
  position_intent text,
  order_type text NOT NULL,
  time_in_force text NOT NULL,
  order_class text,
  status text NOT NULL,
  quantity numeric,
  notional numeric,
  filled_quantity numeric NOT NULL,
  filled_average_price numeric,
  limit_price numeric,
  stop_price numeric,
  trail_price numeric,
  trail_percent numeric,
  high_water_mark numeric,
  commission numeric,
  extended_hours boolean NOT NULL,
  replaces_order_id text,
  replaced_by_order_id text,
  provider_created_at_original text NOT NULL,
  provider_created_at timestamptz NOT NULL,
  provider_updated_at_original text,
  provider_updated_at timestamptz,
  provider_submitted_at_original text,
  provider_submitted_at timestamptz,
  provider_filled_at timestamptz,
  provider_canceled_at timestamptz,
  provider_failed_at timestamptz,
  provider_replaced_at timestamptz,
  provider_expired_at timestamptz,
  observed_at timestamptz NOT NULL,
  canonical_hash character(64) NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload text NOT NULL,
  PRIMARY KEY (sync_run_id, provider_order_id),
  UNIQUE (sync_run_id, client_order_id),
  FOREIGN KEY (sync_run_id, source_request_fingerprint)
    REFERENCES portfolio_sync_requests(sync_run_id, provider_request_fingerprint),
  CHECK (quantity IS NOT NULL OR notional IS NOT NULL),
  CHECK (
    (supported_for_monitoring AND unsupported_reason IS NULL)
    OR (NOT supported_for_monitoring AND unsupported_reason IS NOT NULL)
  )
);

CREATE INDEX portfolio_order_observations_status_idx
  ON portfolio_order_observations (status, provider_submitted_at DESC);

CREATE TABLE portfolio_fill_observations (
  fill_observation_id character(64) PRIMARY KEY CHECK (
    fill_observation_id ~ '^[0-9a-f]{64}$'
  ),
  schema_version text NOT NULL CHECK (
    schema_version = 'daily-trader.portfolio.fill-observation.v1'
  ),
  account_fingerprint character(64) NOT NULL CHECK (account_fingerprint ~ '^[0-9a-f]{64}$'),
  source_request_fingerprint character(64) NOT NULL CHECK (
    source_request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  provider_activity_id character(64) NOT NULL CHECK (
    provider_activity_id ~ '^[0-9a-f]{64}$'
  ),
  provider_order_id text NOT NULL,
  provider_asset_id text,
  symbol text NOT NULL,
  instrument_id text CHECK (
    instrument_id IS NULL OR instrument_id ~ '^[A-Z0-9]{4}:[A-Z0-9]+([.-][A-Z0-9]+)*$'
  ),
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  activity_type text NOT NULL CHECK (activity_type = 'FILL'),
  fill_type text NOT NULL CHECK (fill_type IN ('fill', 'partial_fill')),
  quantity numeric NOT NULL,
  price numeric NOT NULL,
  cumulative_quantity numeric NOT NULL,
  leaves_quantity numeric NOT NULL,
  provider_transaction_at_original text NOT NULL,
  provider_transaction_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  first_observed_at timestamptz NOT NULL,
  first_seen_run_id text NOT NULL REFERENCES portfolio_sync_runs(sync_run_id),
  canonical_hash character(64) NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload text NOT NULL,
  UNIQUE (account_fingerprint, provider_activity_id, canonical_hash),
  FOREIGN KEY (first_seen_run_id, source_request_fingerprint)
    REFERENCES portfolio_sync_requests(sync_run_id, provider_request_fingerprint)
);

CREATE INDEX portfolio_fill_observations_order_idx
  ON portfolio_fill_observations (
    account_fingerprint, provider_order_id, provider_transaction_at
  );

CREATE TABLE portfolio_sync_fill_memberships (
  sync_run_id text NOT NULL REFERENCES portfolio_sync_runs(sync_run_id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  fill_observation_id character(64) NOT NULL REFERENCES portfolio_fill_observations(fill_observation_id),
  PRIMARY KEY (sync_run_id, ordinal),
  UNIQUE (sync_run_id, fill_observation_id)
);

CREATE TABLE portfolio_reconciliations (
  sync_run_id text PRIMARY KEY REFERENCES portfolio_sync_runs(sync_run_id),
  compared_sync_run_id text REFERENCES portfolio_sync_runs(sync_run_id),
  reconciliation_id character(64) NOT NULL CHECK (reconciliation_id ~ '^[0-9a-f]{64}$'),
  projection_basis_reconciliation_id character(64) NOT NULL CHECK (
    projection_basis_reconciliation_id ~ '^[0-9a-f]{64}$'
  ),
  prepared_projection_id character(64) NOT NULL CHECK (
    prepared_projection_id ~ '^[0-9a-f]{64}$'
  ),
  expected_portfolio_result_id character(64) NOT NULL CHECK (
    expected_portfolio_result_id ~ '^[0-9a-f]{64}$'
  ),
  snapshot_delta_id character(64) NOT NULL CHECK (snapshot_delta_id ~ '^[0-9a-f]{64}$'),
  integrity_state text NOT NULL CHECK (
    integrity_state IN ('converged', 'drift', 'unavailable')
  ),
  change_state text NOT NULL CHECK (change_state IN ('baseline', 'unchanged', 'changed')),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  account_changed boolean NOT NULL,
  positions_added integer NOT NULL CHECK (positions_added >= 0),
  positions_changed integer NOT NULL CHECK (positions_changed >= 0),
  positions_removed integer NOT NULL CHECK (positions_removed >= 0),
  orders_added integer NOT NULL CHECK (orders_added >= 0),
  orders_changed integer NOT NULL CHECK (orders_changed >= 0),
  orders_removed integer NOT NULL CHECK (orders_removed >= 0),
  fills_added integer NOT NULL CHECK (fills_added >= 0),
  reconciled_at timestamptz NOT NULL,
  prepared_projection_payload text NOT NULL,
  projection_basis_reconciliation_payload text NOT NULL,
  reconciliation_payload text NOT NULL,
  snapshot_delta_payload text NOT NULL,
  CHECK (
    (change_state = 'baseline' AND compared_sync_run_id IS NULL)
    OR (change_state <> 'baseline' AND compared_sync_run_id IS NOT NULL)
  ),
  CHECK (
    (integrity_state = 'converged' AND failure_code IS NULL)
    OR (integrity_state <> 'converged' AND failure_code IS NOT NULL)
  )
);

CREATE TABLE portfolio_projections (
  sync_run_id text PRIMARY KEY REFERENCES portfolio_sync_runs(sync_run_id),
  schema_version text NOT NULL CHECK (
    schema_version = 'daily-trader.portfolio.projection.v1'
  ),
  state text NOT NULL CHECK (state IN ('complete', 'incomplete')),
  incomplete_reason text,
  arithmetic_policy_version text NOT NULL CHECK (
    arithmetic_policy_version = 'daily-trader.portfolio.arithmetic.bigjs.v1'
  ),
  valuation_policy_version text NOT NULL CHECK (
    valuation_policy_version = 'daily-trader.portfolio.valuation.alpaca-paper-broker-mark.v1'
  ),
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  cash numeric NOT NULL,
  equity numeric NOT NULL,
  day_profit_loss numeric,
  unrealized_profit_loss numeric,
  gross_exposure numeric,
  net_exposure numeric,
  gross_exposure_percent numeric,
  net_exposure_percent numeric,
  concentration_percent numeric,
  knowledge_start_at timestamptz NOT NULL,
  knowledge_end_at timestamptz NOT NULL,
  canonical_hash character(64) NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload text NOT NULL,
  CHECK (
    (state = 'complete' AND incomplete_reason IS NULL AND day_profit_loss IS NOT NULL
      AND unrealized_profit_loss IS NOT NULL AND gross_exposure IS NOT NULL
      AND net_exposure IS NOT NULL
      AND (concentration_percent IS NOT NULL OR gross_exposure = 0))
    OR
    (state = 'incomplete' AND incomplete_reason IS NOT NULL
      AND day_profit_loss IS NULL AND unrealized_profit_loss IS NULL AND gross_exposure IS NULL
      AND net_exposure IS NULL AND gross_exposure_percent IS NULL
      AND net_exposure_percent IS NULL AND concentration_percent IS NULL)
  )
);

CREATE TABLE portfolio_position_projections (
  sync_run_id text NOT NULL REFERENCES portfolio_projections(sync_run_id),
  provider_asset_id text NOT NULL,
  allocation_percent numeric,
  projection_state text NOT NULL CHECK (projection_state IN ('complete', 'incomplete')),
  incomplete_reason text,
  PRIMARY KEY (sync_run_id, provider_asset_id),
  FOREIGN KEY (sync_run_id, provider_asset_id)
    REFERENCES portfolio_position_observations(sync_run_id, provider_asset_id),
  CHECK (
    (projection_state = 'complete' AND incomplete_reason IS NULL)
    OR (projection_state = 'incomplete' AND allocation_percent IS NULL
      AND incomplete_reason IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION enforce_pending_portfolio_cycle_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_run_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'portfolio cycle evidence is append-only';
  END IF;
  candidate_run_id := NEW.sync_run_id;
  IF NOT EXISTS (
    SELECT 1 FROM portfolio_sync_runs
    WHERE sync_run_id = candidate_run_id AND state = 'pending'
  ) THEN
    RAISE EXCEPTION 'portfolio cycle evidence requires a pending sync run';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER portfolio_sync_requests_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_sync_requests
FOR EACH ROW EXECUTE FUNCTION enforce_pending_portfolio_cycle_child();

CREATE TRIGGER portfolio_account_observations_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_account_observations
FOR EACH ROW EXECUTE FUNCTION enforce_pending_portfolio_cycle_child();

CREATE TRIGGER portfolio_position_observations_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_position_observations
FOR EACH ROW EXECUTE FUNCTION enforce_pending_portfolio_cycle_child();

CREATE TRIGGER portfolio_order_observations_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_order_observations
FOR EACH ROW EXECUTE FUNCTION enforce_pending_portfolio_cycle_child();

CREATE TRIGGER portfolio_sync_fill_memberships_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_sync_fill_memberships
FOR EACH ROW EXECUTE FUNCTION enforce_pending_portfolio_cycle_child();

CREATE TRIGGER portfolio_reconciliations_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_reconciliations
FOR EACH ROW EXECUTE FUNCTION enforce_pending_portfolio_cycle_child();

CREATE TRIGGER portfolio_projections_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_projections
FOR EACH ROW EXECUTE FUNCTION enforce_pending_portfolio_cycle_child();

CREATE TRIGGER portfolio_position_projections_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_position_projections
FOR EACH ROW EXECUTE FUNCTION enforce_pending_portfolio_cycle_child();

CREATE OR REPLACE FUNCTION enforce_append_only_portfolio_fill()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'portfolio fill observations are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM portfolio_sync_runs
    WHERE sync_run_id = NEW.first_seen_run_id AND state = 'pending'
  ) THEN
    RAISE EXCEPTION 'portfolio fill observation requires a pending first-seen run';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER portfolio_fill_observations_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON portfolio_fill_observations
FOR EACH ROW EXECUTE FUNCTION enforce_append_only_portfolio_fill();

CREATE TABLE portfolio_current_snapshot (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  sync_run_id text NOT NULL UNIQUE REFERENCES portfolio_sync_runs(sync_run_id),
  promoted_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION enforce_completed_portfolio_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM portfolio_sync_runs AS run
      JOIN portfolio_reconciliations AS reconciliation USING (sync_run_id)
      JOIN portfolio_projections AS projection USING (sync_run_id)
      JOIN portfolio_worker_status AS worker ON worker.singleton
     WHERE run.sync_run_id = NEW.sync_run_id
       AND run.state = 'completed'
       AND reconciliation.integrity_state = 'converged'
       AND reconciliation.expected_portfolio_result_id = projection.canonical_hash
       AND run.position_count = (
         SELECT count(*) FROM portfolio_position_observations AS position
          WHERE position.sync_run_id = run.sync_run_id
       )
       AND run.position_count = (
         SELECT count(*) FROM portfolio_position_projections AS position_projection
          WHERE position_projection.sync_run_id = run.sync_run_id
       )
       AND run.order_count = (
         SELECT count(*) FROM portfolio_order_observations AS observed_order
          WHERE observed_order.sync_run_id = run.sync_run_id
       )
       AND run.fill_count = (
         SELECT count(*) FROM portfolio_sync_fill_memberships AS fill_membership
          WHERE fill_membership.sync_run_id = run.sync_run_id
       )
       AND 1 = (
         SELECT count(*) FROM portfolio_account_observations AS account
          WHERE account.sync_run_id = run.sync_run_id
            AND account.account_fingerprint = run.account_fingerprint
       )
       AND worker.owner_id = run.claim_owner_id
       AND worker.fence_token = run.claim_fence
       AND worker.account_fingerprint = run.account_fingerprint
       AND worker.lease_expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'current portfolio snapshot must reference one complete reconciled projection';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER portfolio_current_snapshot_completed_guard
AFTER INSERT OR UPDATE ON portfolio_current_snapshot
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_completed_portfolio_snapshot();

CREATE OR REPLACE FUNCTION prevent_terminal_portfolio_sync_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'portfolio sync runs are append-only';
  END IF;
  IF OLD.state IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'terminal portfolio sync runs are immutable';
  END IF;
  IF NEW.state = 'completed' AND NOT EXISTS (
    SELECT 1
      FROM portfolio_sync_requests
     WHERE sync_run_id = NEW.sync_run_id
       AND capture_attempt = NEW.final_capture_attempt
     GROUP BY capture_attempt
    HAVING count(*) FILTER (WHERE resource = 'account') = 1
       AND bool_and(response_status = 200)
       AND min(ordinal) FILTER (WHERE resource = 'account') = 0
       AND count(*) FILTER (WHERE resource = 'positions') = 1
       AND min(ordinal) FILTER (WHERE resource = 'positions') = 0
       AND count(*) FILTER (WHERE resource = 'orders') > 0
       AND min(ordinal) FILTER (WHERE resource = 'orders') = 0
       AND max(ordinal) FILTER (WHERE resource = 'orders') + 1 =
           count(*) FILTER (WHERE resource = 'orders')
       AND count(*) FILTER (WHERE resource = 'fills') > 0
       AND min(ordinal) FILTER (WHERE resource = 'fills') = 0
       AND max(ordinal) FILTER (WHERE resource = 'fills') + 1 =
           count(*) FILTER (WHERE resource = 'fills')
  ) THEN
    RAISE EXCEPTION 'completed portfolio sync requires one complete request attempt';
  END IF;
  IF NEW.state = 'completed' AND (
    (SELECT count(*) FROM portfolio_account_observations
      WHERE sync_run_id = NEW.sync_run_id
        AND account_fingerprint = NEW.account_fingerprint) <> 1
    OR (SELECT count(*) FROM portfolio_position_observations
         WHERE sync_run_id = NEW.sync_run_id) <> NEW.position_count
    OR (SELECT count(*) FROM portfolio_position_observations
         WHERE sync_run_id = NEW.sync_run_id
           AND NOT supported_for_projection) <> NEW.unsupported_position_count
    OR (SELECT count(*) FROM portfolio_order_observations
         WHERE sync_run_id = NEW.sync_run_id) <> NEW.order_count
    OR (SELECT count(*) FROM portfolio_sync_fill_memberships
         WHERE sync_run_id = NEW.sync_run_id) <> NEW.fill_count
    OR (SELECT count(*) FROM portfolio_position_projections
         WHERE sync_run_id = NEW.sync_run_id) <> NEW.position_count
    OR NOT EXISTS (
      SELECT 1
        FROM portfolio_reconciliations AS reconciliation
        JOIN portfolio_projections AS projection USING (sync_run_id)
       WHERE reconciliation.sync_run_id = NEW.sync_run_id
         AND reconciliation.integrity_state = 'converged'
         AND reconciliation.expected_portfolio_result_id = projection.canonical_hash
    )
  ) THEN
    RAISE EXCEPTION 'completed portfolio sync requires complete reconciled persistence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER portfolio_sync_runs_terminal_guard
BEFORE UPDATE OR DELETE ON portfolio_sync_runs
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_portfolio_sync_mutation();

CREATE TABLE portfolio_worker_status (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_id text,
  fence_token bigint NOT NULL DEFAULT 0 CHECK (fence_token >= 0),
  account_fingerprint character(64) CHECK (
    account_fingerprint IS NULL OR account_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  lifecycle text NOT NULL CHECK (
    lifecycle IN ('disabled', 'starting', 'running', 'degraded', 'stopping', 'stopped', 'failed')
  ),
  heartbeat_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  updated_at timestamptz NOT NULL,
  CHECK ((owner_id IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((owner_id IS NULL) = (account_fingerprint IS NULL)),
  CHECK (lease_expires_at IS NULL OR lease_expires_at > heartbeat_at),
  CHECK (
    (lifecycle IN ('failed', 'degraded') AND failure_code IS NOT NULL)
    OR (lifecycle NOT IN ('failed', 'degraded') AND failure_code IS NULL)
  )
);

INSERT INTO portfolio_worker_status (
  singleton, owner_id, fence_token, account_fingerprint, lifecycle, heartbeat_at, lease_expires_at,
  last_sync_started_at, last_sync_completed_at, failure_code, updated_at
)
VALUES (
  true, NULL, 0, NULL, 'disabled', CURRENT_TIMESTAMP, NULL,
  NULL, NULL, NULL, CURRENT_TIMESTAMP
);

CREATE VIEW portfolio_current_account AS
SELECT account.*
FROM portfolio_current_snapshot AS current
JOIN portfolio_account_observations AS account ON account.sync_run_id = current.sync_run_id;

CREATE VIEW portfolio_current_positions AS
SELECT position.*
FROM portfolio_current_snapshot AS current
JOIN portfolio_position_observations AS position ON position.sync_run_id = current.sync_run_id;

CREATE VIEW portfolio_current_orders AS
SELECT observed_order.*
FROM portfolio_current_snapshot AS current
JOIN portfolio_order_observations AS observed_order
  ON observed_order.sync_run_id = current.sync_run_id;

CREATE VIEW portfolio_current_projection AS
SELECT projection.*
FROM portfolio_current_snapshot AS current
JOIN portfolio_projections AS projection ON projection.sync_run_id = current.sync_run_id;

CREATE VIEW portfolio_current_reconciliation AS
SELECT reconciliation.*
FROM portfolio_current_snapshot AS current
JOIN portfolio_reconciliations AS reconciliation
  ON reconciliation.sync_run_id = current.sync_run_id;
