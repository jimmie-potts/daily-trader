-- New writes use snapshot/order schema v2, which adds explicit provider mleg
-- structures. V1 remains accepted so existing canonical rows keep their identity.
ALTER TABLE portfolio_sync_runs
  DROP CONSTRAINT portfolio_sync_runs_snapshot_schema_version_check,
  ADD CONSTRAINT portfolio_sync_runs_snapshot_schema_version_check CHECK (
    snapshot_schema_version IN (
      'daily-trader.portfolio.sync-snapshot.v1',
      'daily-trader.portfolio.sync-snapshot.v2'
    )
  );

ALTER TABLE portfolio_order_observations
  DROP CONSTRAINT portfolio_order_observations_schema_version_check,
  ADD CONSTRAINT portfolio_order_observations_schema_version_check CHECK (
    schema_version IN (
      'daily-trader.portfolio.order-observation.v1',
      'daily-trader.portfolio.order-observation.v2'
    )
  ),
  ALTER COLUMN symbol DROP NOT NULL,
  ALTER COLUMN asset_class DROP NOT NULL,
  ALTER COLUMN side DROP NOT NULL,
  ALTER COLUMN order_type DROP NOT NULL;

ALTER TABLE portfolio_order_observations
  ADD CONSTRAINT portfolio_order_observations_nullable_identity_check CHECK (
    (
      symbol IS NOT NULL
      AND asset_class IS NOT NULL
      AND side IS NOT NULL
    )
    OR (
      schema_version IS NOT DISTINCT FROM 'daily-trader.portfolio.order-observation.v2'
      AND order_class IS NOT DISTINCT FROM 'mleg'
      AND instrument_id IS NULL
      AND NOT supported_for_monitoring
      AND unsupported_reason IS NOT DISTINCT FROM 'unsupported_order_structure'
    )
  ),
  ADD CONSTRAINT portfolio_order_observations_nullable_type_check CHECK (
    order_type IS NOT NULL
    OR (
      schema_version IS NOT DISTINCT FROM 'daily-trader.portfolio.order-observation.v2'
      AND order_class IS NOT DISTINCT FROM 'mleg'
      AND NOT supported_for_monitoring
      AND unsupported_reason IS NOT DISTINCT FROM 'unsupported_order_structure'
    )
  ),
  ADD CONSTRAINT portfolio_order_observations_nullable_text_check CHECK (
    (symbol IS NULL OR symbol <> '')
    AND (asset_class IS NULL OR asset_class <> '')
    AND (side IS NULL OR side <> '')
    AND (order_type IS NULL OR order_type <> '')
  ),
  ADD CONSTRAINT portfolio_order_observations_structure_reason_check CHECK (
    (
      schema_version IS NOT DISTINCT FROM 'daily-trader.portfolio.order-observation.v2'
      AND order_class IS NOT DISTINCT FROM 'mleg'
      AND NOT supported_for_monitoring
      AND unsupported_reason IS NOT DISTINCT FROM 'unsupported_order_structure'
    )
    OR (
      NOT (
        schema_version IS NOT DISTINCT FROM 'daily-trader.portfolio.order-observation.v2'
        AND order_class IS NOT DISTINCT FROM 'mleg'
      )
      AND unsupported_reason IS DISTINCT FROM 'unsupported_order_structure'
    )
  );
