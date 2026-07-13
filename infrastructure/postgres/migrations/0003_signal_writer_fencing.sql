ALTER TABLE market_data_writer_capabilities
  ADD COLUMN freshness_threshold_ms integer,
  ADD COLUMN data_quality_policy_version text;

UPDATE market_data_writer_capabilities AS capability
SET freshness_threshold_ms = session.freshness_threshold_ms,
    data_quality_policy_version = 'daily-trader.market-data.quality.v1'
FROM market_data_ingestion_sessions AS session
WHERE session.session_id = capability.session_id;

ALTER TABLE market_data_writer_capabilities
  ALTER COLUMN freshness_threshold_ms SET NOT NULL,
  ALTER COLUMN data_quality_policy_version SET NOT NULL,
  ADD CONSTRAINT market_data_writer_capabilities_freshness_threshold_check
    CHECK (freshness_threshold_ms BETWEEN 60000 AND 300000),
  ADD CONSTRAINT market_data_writer_capabilities_quality_policy_check
    CHECK (data_quality_policy_version = 'daily-trader.market-data.quality.v1');

CREATE OR REPLACE FUNCTION enforce_open_paper_writer_capability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mode = 'paper' AND NEW.ended_at IS NULL
     AND EXISTS (SELECT 1 FROM signal_runs WHERE capture_active)
     AND NOT EXISTS (
       SELECT 1
       FROM market_data_writer_capabilities AS capability
       JOIN signal_runs AS run ON run.capture_active
       WHERE capability.session_id = NEW.session_id
         AND capability.session_mode = 'paper'
         AND capability.capability_state = 'accepted'
         AND capability.revision_contract_version =
           'daily-trader.market-data.canonical-revision.v1'
         AND capability.freshness_threshold_ms = run.freshness_threshold_ms
         AND capability.data_quality_policy_version = run.data_quality_policy_version
         AND capability.retired_at IS NULL
         AND capability.heartbeat_at <= clock_timestamp()
         AND capability.expires_at > clock_timestamp()
     ) THEN
    RAISE EXCEPTION 'active signal capture requires a compatible fresh paper writer capability';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_capture_writer_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  writer_session_id text;
BEGIN
  IF EXISTS (SELECT 1 FROM signal_runs WHERE capture_active) THEN
    IF current_setting('daily_trader.canonical_revision_contract', true)
         IS DISTINCT FROM 'daily-trader.market-data.canonical-revision.v1' THEN
      RAISE EXCEPTION 'active signal capture requires the canonical revision writer contract';
    END IF;

    writer_session_id := current_setting(
      'daily_trader.market_data_writer_session_id',
      true
    );
    IF writer_session_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM signal_runs AS run
      JOIN market_data_ingestion_sessions AS session ON true
      JOIN market_data_writer_capabilities AS capability
        ON capability.session_id = session.session_id
       AND capability.session_mode = 'paper'
      WHERE session.session_id = writer_session_id
        AND run.capture_active
        AND session.mode = 'paper'
        AND session.ended_at IS NULL
        AND capability.capability_state = 'accepted'
        AND capability.revision_contract_version =
          'daily-trader.market-data.canonical-revision.v1'
        AND capability.freshness_threshold_ms = run.freshness_threshold_ms
        AND capability.data_quality_policy_version = run.data_quality_policy_version
        AND capability.retired_at IS NULL
        AND capability.heartbeat_at <= clock_timestamp()
        AND capability.expires_at > clock_timestamp()
    ) THEN
      RAISE EXCEPTION 'active signal capture requires a fresh fenced persistence writer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER market_data_one_minute_bars_writer_contract_commit_guard
AFTER INSERT OR UPDATE ON market_data_one_minute_bars
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_signal_capture_writer_contract();
