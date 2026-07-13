ALTER TABLE market_data_event_ledger
  ADD COLUMN freshness_threshold_ms integer,
  ADD COLUMN data_quality_policy_version text;

UPDATE market_data_event_ledger AS ledger
SET freshness_threshold_ms = session.freshness_threshold_ms,
    data_quality_policy_version = 'daily-trader.market-data.quality.v1'
FROM market_data_ingestion_sessions AS session
WHERE session.session_id = ledger.session_id;

ALTER TABLE market_data_event_ledger
  ALTER COLUMN freshness_threshold_ms SET NOT NULL,
  ALTER COLUMN data_quality_policy_version SET NOT NULL,
  ADD CONSTRAINT market_data_event_ledger_freshness_threshold_check
    CHECK (freshness_threshold_ms BETWEEN 60000 AND 300000),
  ADD CONSTRAINT market_data_event_ledger_quality_policy_check
    CHECK (data_quality_policy_version = 'daily-trader.market-data.quality.v1');

CREATE TABLE signal_runs (
  run_id text PRIMARY KEY,
  source_kind text NOT NULL CHECK (source_kind IN ('live_journal', 'replay_schedule')),
  state text NOT NULL CHECK (state IN ('pending', 'active', 'closing', 'completed', 'failed')),
  definition_version text NOT NULL CHECK (definition_version = 'breakout_plus_volume.v1'),
  configuration_version text NOT NULL,
  configuration_hash character(64) NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  configuration_payload text NOT NULL,
  operational_configuration_hash character(64) NOT NULL
    CHECK (operational_configuration_hash ~ '^[0-9a-f]{64}$'),
  operational_configuration_payload text NOT NULL,
  backlog_limit integer NOT NULL CHECK (backlog_limit BETWEEN 1 AND 100000),
  arithmetic_policy_version text NOT NULL
    CHECK (arithmetic_policy_version = 'daily-trader.signals.arithmetic.bigjs.v1'),
  calendar_version text NOT NULL CHECK (calendar_version = 'nyse-core-2026-2028.v1'),
  market_event_schema_version text NOT NULL
    CHECK (market_event_schema_version = 'daily-trader.market-data.one-minute-bar.v1'),
  data_quality_policy_version text NOT NULL
    CHECK (data_quality_policy_version = 'daily-trader.market-data.quality.v1'),
  revision_schema_version text NOT NULL
    CHECK (revision_schema_version = 'daily-trader.market-data.canonical-revision.v1'),
  feature_schema_version text NOT NULL
    CHECK (feature_schema_version = 'daily-trader.signals.feature-result.v1'),
  evaluation_schema_version text NOT NULL
    CHECK (evaluation_schema_version = 'daily-trader.signals.evaluation.v1'),
  freshness_threshold_ms integer NOT NULL
    CHECK (freshness_threshold_ms BETWEEN 60000 AND 300000),
  lookback_window integer NOT NULL CHECK (lookback_window BETWEEN 1 AND 390),
  volume_multiplier numeric NOT NULL CHECK (volume_multiplier >= 1 AND volume_multiplier <= 10),
  source_provenance text NOT NULL,
  source_cursor_namespace text NOT NULL,
  start_position bigint NOT NULL DEFAULT 0 CHECK (start_position >= 0),
  stop_position bigint CHECK (stop_position IS NULL OR stop_position >= start_position),
  cursor_position bigint NOT NULL DEFAULT 0 CHECK (cursor_position >= 0),
  capture_active boolean NOT NULL DEFAULT false,
  claim_fence bigint NOT NULL DEFAULT 0 CHECK (claim_fence >= 0),
  claim_owner_id text,
  claim_expires_at timestamptz,
  claim_lease_ms integer,
  claim_renew_interval_ms integer,
  expected_membership_count integer CHECK (expected_membership_count IS NULL OR expected_membership_count >= 0),
  replay_catalog_version text,
  replay_catalog_checksum character(64),
  replay_schedule_version text,
  replay_schedule_checksum character(64),
  replay_manifest_version text,
  replay_manifest_checksum character(64),
  expected_output_checksum character(64),
  replay_output_checksum character(64),
  replay_output_payload text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (run_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  CHECK (configuration_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  CHECK (source_cursor_namespace ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  CHECK (claim_owner_id IS NULL OR claim_owner_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  CHECK ((claim_owner_id IS NULL) = (claim_expires_at IS NULL)),
  CHECK (
    (source_kind = 'live_journal'
      AND claim_lease_ms BETWEEN 5000 AND 120000
      AND claim_renew_interval_ms BETWEEN 1000 AND 40000
      AND claim_renew_interval_ms * 3 <= claim_lease_ms)
    OR
    (source_kind = 'replay_schedule'
      AND claim_lease_ms IS NULL AND claim_renew_interval_ms IS NULL)
  ),
  CHECK (cursor_position >= start_position),
  CHECK (stop_position IS NULL OR cursor_position <= stop_position),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (
    (source_kind = 'live_journal' AND replay_catalog_version IS NULL
      AND replay_catalog_checksum IS NULL AND replay_schedule_version IS NULL
      AND replay_schedule_checksum IS NULL AND replay_manifest_version IS NULL
      AND replay_manifest_checksum IS NULL AND expected_output_checksum IS NULL
      AND replay_output_checksum IS NULL AND replay_output_payload IS NULL)
    OR
    (source_kind = 'replay_schedule' AND replay_catalog_version IS NOT NULL
      AND replay_catalog_checksum ~ '^[0-9a-f]{64}$' AND replay_schedule_version IS NOT NULL
      AND replay_schedule_checksum ~ '^[0-9a-f]{64}$' AND replay_manifest_version IS NOT NULL
      AND replay_manifest_checksum ~ '^[0-9a-f]{64}$'
      AND expected_membership_count IS NOT NULL
      AND expected_output_checksum ~ '^[0-9a-f]{64}$')
  ),
  CHECK (
    (replay_output_checksum IS NULL AND replay_output_payload IS NULL)
    OR (replay_output_checksum ~ '^[0-9a-f]{64}$' AND replay_output_payload IS NOT NULL)
  ),
  CHECK (
    source_kind <> 'replay_schedule' OR state <> 'completed'
    OR replay_output_checksum = expected_output_checksum
  )
);

CREATE UNIQUE INDEX signal_runs_one_capture_active_idx
  ON signal_runs (capture_active)
  WHERE capture_active;

CREATE INDEX signal_runs_status_idx
  ON signal_runs (source_kind, state, created_at DESC);

ALTER TABLE market_data_ingestion_sessions
  ADD CONSTRAINT market_data_ingestion_sessions_session_mode_unique
    UNIQUE (session_id, mode);

CREATE TABLE market_data_writer_capabilities (
  session_id text PRIMARY KEY,
  session_mode text NOT NULL DEFAULT 'paper' CHECK (session_mode = 'paper'),
  capability_state text NOT NULL CHECK (capability_state IN ('accepted', 'retired')),
  revision_contract_version text NOT NULL
    CHECK (revision_contract_version = 'daily-trader.market-data.canonical-revision.v1'),
  registered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  heartbeat_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  retired_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id, session_mode)
    REFERENCES market_data_ingestion_sessions(session_id, mode),
  CHECK (registered_at <= heartbeat_at),
  CHECK (
    expires_at >= heartbeat_at + interval '3 seconds'
    AND expires_at <= heartbeat_at + interval '15 minutes'
  ),
  CHECK (retired_at IS NULL OR retired_at >= heartbeat_at),
  CHECK (
    (capability_state = 'accepted' AND retired_at IS NULL)
    OR (capability_state = 'retired' AND retired_at IS NOT NULL)
  ),
  CHECK (updated_at >= registered_at)
);

CREATE INDEX market_data_writer_capabilities_freshness_idx
  ON market_data_writer_capabilities (capability_state, expires_at)
  WHERE capability_state = 'accepted';

CREATE TABLE market_data_canonical_revision_counter (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_position bigint NOT NULL CHECK (next_position >= 1)
);

INSERT INTO market_data_canonical_revision_counter (singleton, next_position)
VALUES (true, 1);

CREATE TABLE market_data_canonical_revisions (
  position bigint PRIMARY KEY CHECK (position >= 1),
  revision_id character(64) UNIQUE NOT NULL CHECK (revision_id ~ '^[0-9a-f]{64}$'),
  run_id text NOT NULL REFERENCES signal_runs(run_id),
  schema_version text NOT NULL
    CHECK (schema_version = 'daily-trader.market-data.canonical-revision.v1'),
  operation text NOT NULL CHECK (operation IN ('insert', 'replace')),
  ordering_key text NOT NULL,
  instrument_symbol text NOT NULL,
  instrument_venue character(4) NOT NULL,
  bar_start timestamptz NOT NULL,
  previous_event_id character(64) REFERENCES market_data_event_ledger(event_id),
  new_event_id character(64) NOT NULL REFERENCES market_data_event_ledger(event_id),
  arrival_classification text NOT NULL
    CHECK (arrival_classification IN ('accepted', 'correction', 'out_of_order')),
  gap_state text NOT NULL CHECK (gap_state IN ('complete', 'gapped', 'unknown')),
  historical boolean NOT NULL,
  filled_known_gap boolean NOT NULL,
  journaled_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (instrument_symbol = 'AAPL' AND instrument_venue = 'XNAS') OR
    (instrument_symbol = 'SPY' AND instrument_venue = 'ARCX')
  ),
  CHECK (
    (operation = 'insert' AND previous_event_id IS NULL) OR
    (operation = 'replace' AND previous_event_id IS NOT NULL)
  ),
  CHECK (previous_event_id IS NULL OR previous_event_id <> new_event_id)
);

CREATE INDEX market_data_canonical_revisions_run_position_idx
  ON market_data_canonical_revisions (run_id, position);
CREATE INDEX market_data_canonical_revisions_bar_idx
  ON market_data_canonical_revisions (instrument_symbol, bar_start, position);

CREATE TABLE signal_run_bootstrap_events (
  run_id text NOT NULL REFERENCES signal_runs(run_id),
  instrument_symbol text NOT NULL,
  instrument_venue character(4) NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  event_id character(64) NOT NULL REFERENCES market_data_event_ledger(event_id),
  bar_start timestamptz NOT NULL,
  evidence_only boolean NOT NULL DEFAULT true CHECK (evidence_only),
  PRIMARY KEY (run_id, instrument_symbol, ordinal),
  UNIQUE (run_id, event_id)
);

CREATE TABLE signal_run_boundaries (
  run_id text NOT NULL REFERENCES signal_runs(run_id),
  instrument_symbol text NOT NULL CHECK (instrument_symbol IN ('AAPL', 'SPY')),
  first_evaluation_bar_start timestamptz NOT NULL,
  PRIMARY KEY (run_id, instrument_symbol)
);

CREATE TABLE signal_run_cursors (
  run_id text PRIMARY KEY REFERENCES signal_runs(run_id),
  source_kind text NOT NULL CHECK (source_kind IN ('live_journal', 'replay_schedule')),
  cursor_value bigint NOT NULL CHECK (cursor_value >= 0),
  fence_token bigint NOT NULL CHECK (fence_token >= 0),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE signal_evaluations (
  evaluation_id character(64) PRIMARY KEY CHECK (evaluation_id ~ '^[0-9a-f]{64}$'),
  feature_result_id character(64) UNIQUE NOT NULL CHECK (feature_result_id ~ '^[0-9a-f]{64}$'),
  schema_version text NOT NULL
    CHECK (schema_version = 'daily-trader.signals.evaluation.v1'),
  definition_version text NOT NULL CHECK (definition_version = 'breakout_plus_volume.v1'),
  configuration_version text NOT NULL,
  configuration_hash character(64) NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  instrument_symbol text NOT NULL,
  instrument_venue character(4) NOT NULL,
  evaluation_event_id character(64) NOT NULL REFERENCES market_data_event_ledger(event_id),
  evaluation_bar_start timestamptz NOT NULL,
  observation_as_of timestamptz NOT NULL,
  knowledge_as_of timestamptz NOT NULL,
  evaluation_mode text NOT NULL CHECK (evaluation_mode IN ('on_time', 'retrospective')),
  outcome text NOT NULL CHECK (outcome IN ('fired', 'not_fired', 'suppressed')),
  reason text NOT NULL,
  direction text CHECK (direction IN ('upward', 'downward')),
  invalidation_condition text,
  close_price numeric,
  current_volume numeric,
  breakout_reference numeric,
  prior_high numeric,
  prior_low numeric,
  prior_volume_sum numeric,
  prior_count integer CHECK (prior_count IS NULL OR prior_count > 0),
  volume_multiplier numeric,
  window_start timestamptz,
  window_end timestamptz,
  source_provider text NOT NULL CHECK (source_provider = 'alpaca'),
  source_feed text NOT NULL CHECK (source_feed = 'iex'),
  source_entitlement text NOT NULL CHECK (source_entitlement = 'real_time'),
  canonical_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (instrument_symbol = 'AAPL' AND instrument_venue = 'XNAS') OR
    (instrument_symbol = 'SPY' AND instrument_venue = 'ARCX')
  ),
  CHECK (knowledge_as_of >= observation_as_of),
  CHECK (
    (outcome = 'fired' AND direction IS NOT NULL AND invalidation_condition IS NOT NULL
      AND close_price IS NOT NULL AND current_volume IS NOT NULL
      AND breakout_reference IS NOT NULL AND prior_volume_sum IS NOT NULL
      AND prior_count IS NOT NULL AND volume_multiplier IS NOT NULL)
    OR
    (outcome <> 'fired' AND direction IS NULL AND invalidation_condition IS NULL)
  )
);

CREATE INDEX signal_evaluations_bar_idx
  ON signal_evaluations (instrument_symbol, evaluation_bar_start, knowledge_as_of);

CREATE TABLE signal_evaluation_evidence (
  evaluation_id character(64) NOT NULL REFERENCES signal_evaluations(evaluation_id),
  role text NOT NULL CHECK (role IN ('evaluation_bar', 'reference_bar')),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  event_id character(64) NOT NULL REFERENCES market_data_event_ledger(event_id),
  PRIMARY KEY (evaluation_id, role, ordinal),
  UNIQUE (evaluation_id, event_id)
);

CREATE TABLE signal_occurrences (
  occurrence_id character(64) PRIMARY KEY CHECK (occurrence_id ~ '^[0-9a-f]{64}$'),
  evaluation_id character(64) UNIQUE NOT NULL REFERENCES signal_evaluations(evaluation_id),
  direction text NOT NULL CHECK (direction IN ('upward', 'downward')),
  canonical_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE signal_run_transitions (
  run_id text NOT NULL REFERENCES signal_runs(run_id),
  source_kind text NOT NULL CHECK (source_kind IN ('live_journal', 'replay_schedule')),
  source_ordinal bigint NOT NULL CHECK (source_ordinal >= 1),
  transition_ordinal integer NOT NULL CHECK (transition_ordinal >= 0),
  transition_id character(64) UNIQUE NOT NULL CHECK (transition_id ~ '^[0-9a-f]{64}$'),
  evaluation_id character(64) NOT NULL REFERENCES signal_evaluations(evaluation_id),
  occurrence_id character(64) REFERENCES signal_occurrences(occurrence_id),
  predecessor_evaluation_id character(64) REFERENCES signal_evaluations(evaluation_id),
  retracted_occurrence_id character(64) REFERENCES signal_occurrences(occurrence_id),
  triggering_revision_id character(64) NOT NULL CHECK (triggering_revision_id ~ '^[0-9a-f]{64}$'),
  transition_kind text NOT NULL
    CHECK (transition_kind IN ('initial', 'supersession', 'retraction')),
  latest_revision_state text NOT NULL
    CHECK (latest_revision_state IN ('current', 'superseded', 'retracted')),
  associated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, source_ordinal, transition_ordinal)
);

CREATE TABLE signal_run_latest_evaluations (
  run_id text NOT NULL REFERENCES signal_runs(run_id),
  definition_version text NOT NULL,
  configuration_hash character(64) NOT NULL,
  instrument_symbol text NOT NULL,
  evaluation_bar_start timestamptz NOT NULL,
  evaluation_id character(64) NOT NULL REFERENCES signal_evaluations(evaluation_id),
  occurrence_id character(64) REFERENCES signal_occurrences(occurrence_id),
  source_ordinal bigint NOT NULL CHECK (source_ordinal >= 1),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    run_id,
    definition_version,
    configuration_hash,
    instrument_symbol,
    evaluation_bar_start
  )
);

CREATE TABLE signal_run_expected_membership (
  run_id text NOT NULL REFERENCES signal_runs(run_id),
  ordinal bigint NOT NULL CHECK (ordinal >= 1),
  expected_evaluation_id character(64) CHECK (expected_evaluation_id ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (run_id, ordinal)
);

CREATE TABLE signal_worker_status (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  lifecycle text NOT NULL
    CHECK (lifecycle IN ('disabled', 'starting', 'running', 'stopping', 'stopped', 'failed')),
  active_run_id text REFERENCES signal_runs(run_id),
  heartbeat_at timestamptz,
  last_progress_position bigint CHECK (last_progress_position IS NULL OR last_progress_position >= 0),
  last_evaluated_bar_start timestamptz,
  revision_gap_detected boolean NOT NULL DEFAULT false,
  backlog_count bigint NOT NULL DEFAULT 0 CHECK (backlog_count >= 0),
  failure_code text,
  claim_owner_id text,
  claim_fence bigint NOT NULL DEFAULT 0 CHECK (claim_fence >= 0),
  claim_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (claim_owner_id IS NULL OR claim_owner_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  CHECK ((claim_owner_id IS NULL) = (claim_expires_at IS NULL)),
  CHECK (
    (lifecycle = 'failed' AND failure_code IS NOT NULL)
    OR (lifecycle <> 'failed' AND failure_code IS NULL)
  )
);

INSERT INTO signal_worker_status (singleton, lifecycle)
VALUES (true, 'disabled');

CREATE FUNCTION lock_paper_writer_capability_cutover()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mode = 'paper' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('XNAS:AAPL|1m', 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('ARCX:SPY|1m', 0));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER market_data_paper_writer_capability_cutover_lock
BEFORE INSERT OR UPDATE ON market_data_ingestion_sessions
FOR EACH ROW EXECUTE FUNCTION lock_paper_writer_capability_cutover();

CREATE FUNCTION enforce_open_paper_writer_capability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mode = 'paper' AND NEW.ended_at IS NULL
     AND EXISTS (SELECT 1 FROM signal_runs WHERE capture_active)
     AND NOT EXISTS (
       SELECT 1
       FROM market_data_writer_capabilities AS capability
       WHERE capability.session_id = NEW.session_id
         AND capability.session_mode = 'paper'
         AND capability.capability_state = 'accepted'
         AND capability.revision_contract_version =
           'daily-trader.market-data.canonical-revision.v1'
         AND capability.retired_at IS NULL
         AND capability.heartbeat_at <= CURRENT_TIMESTAMP
         AND capability.expires_at > CURRENT_TIMESTAMP
     ) THEN
    RAISE EXCEPTION 'active signal capture requires a fresh accepted paper writer capability';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER market_data_paper_writer_capability_guard
AFTER INSERT OR UPDATE ON market_data_ingestion_sessions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_open_paper_writer_capability();

CREATE FUNCTION enforce_signal_capture_writer_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM signal_runs WHERE capture_active) AND
     current_setting('daily_trader.canonical_revision_contract', true)
       IS DISTINCT FROM 'daily-trader.market-data.canonical-revision.v1' THEN
    RAISE EXCEPTION 'active signal capture requires the canonical revision writer contract';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER market_data_one_minute_bars_writer_contract_guard
BEFORE INSERT OR UPDATE ON market_data_one_minute_bars
FOR EACH ROW EXECUTE FUNCTION enforce_signal_capture_writer_contract();

CREATE FUNCTION enforce_canonical_revision_presence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_run text;
BEGIN
  SELECT run_id INTO active_run FROM signal_runs WHERE capture_active;
  IF active_run IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM market_data_canonical_revisions AS revision
    WHERE revision.run_id = active_run
      AND revision.new_event_id = NEW.event_id
      AND revision.instrument_symbol = NEW.instrument_symbol
      AND revision.instrument_venue = NEW.instrument_venue
      AND revision.bar_start = NEW.bar_start
  ) THEN
    RAISE EXCEPTION 'canonical update committed without its required revision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER market_data_one_minute_bars_revision_guard
AFTER INSERT OR UPDATE ON market_data_one_minute_bars
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_canonical_revision_presence();

CREATE FUNCTION reject_signal_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'signal audit records are append-only';
END;
$$;

CREATE TRIGGER canonical_revisions_append_only
BEFORE UPDATE OR DELETE ON market_data_canonical_revisions
FOR EACH ROW EXECUTE FUNCTION reject_signal_audit_mutation();
CREATE TRIGGER signal_bootstrap_events_append_only
BEFORE UPDATE OR DELETE ON signal_run_bootstrap_events
FOR EACH ROW EXECUTE FUNCTION reject_signal_audit_mutation();
CREATE TRIGGER signal_run_boundaries_append_only
BEFORE UPDATE OR DELETE ON signal_run_boundaries
FOR EACH ROW EXECUTE FUNCTION reject_signal_audit_mutation();
CREATE TRIGGER signal_evaluations_append_only
BEFORE UPDATE OR DELETE ON signal_evaluations
FOR EACH ROW EXECUTE FUNCTION reject_signal_audit_mutation();
CREATE TRIGGER signal_evidence_append_only
BEFORE UPDATE OR DELETE ON signal_evaluation_evidence
FOR EACH ROW EXECUTE FUNCTION reject_signal_audit_mutation();
CREATE TRIGGER signal_occurrences_append_only
BEFORE UPDATE OR DELETE ON signal_occurrences
FOR EACH ROW EXECUTE FUNCTION reject_signal_audit_mutation();
CREATE TRIGGER signal_transitions_append_only
BEFORE UPDATE OR DELETE ON signal_run_transitions
FOR EACH ROW EXECUTE FUNCTION reject_signal_audit_mutation();
CREATE TRIGGER signal_expected_membership_append_only
BEFORE UPDATE OR DELETE ON signal_run_expected_membership
FOR EACH ROW EXECUTE FUNCTION reject_signal_audit_mutation();
