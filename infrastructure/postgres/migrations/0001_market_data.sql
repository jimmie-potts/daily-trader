CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE market_data_ingestion_sessions (
  session_id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('fixture', 'paper', 'replay')),
  provider text NOT NULL CHECK (provider = 'alpaca'),
  feed text NOT NULL CHECK (feed = 'iex'),
  entitlement text NOT NULL CHECK (entitlement = 'real_time'),
  configuration_version text NOT NULL,
  freshness_threshold_ms integer NOT NULL
    CHECK (freshness_threshold_ms BETWEEN 60000 AND 300000),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (session_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE market_data_event_ledger (
  ledger_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  event_id character(64) PRIMARY KEY,
  session_id text NOT NULL REFERENCES market_data_ingestion_sessions(session_id),
  schema_version text NOT NULL
    CHECK (schema_version = 'daily-trader.market-data.one-minute-bar.v1'),
  event_type text NOT NULL CHECK (event_type = 'one_minute_bar'),
  ordering_key text NOT NULL,
  arrival_classification text NOT NULL
    CHECK (arrival_classification IN ('accepted', 'correction', 'out_of_order')),
  timeliness text NOT NULL CHECK (timeliness IN ('fresh', 'late', 'outside_session', 'unknown')),
  gap_state text NOT NULL CHECK (gap_state IN ('complete', 'gapped', 'unknown')),
  instrument_symbol text NOT NULL,
  instrument_venue character(4) NOT NULL,
  interval_iso text NOT NULL CHECK (interval_iso = '1m'),
  currency character(3) NOT NULL CHECK (currency = 'USD'),
  price_unit text NOT NULL CHECK (price_unit = 'USD/share'),
  volume_unit text NOT NULL CHECK (volume_unit = 'share'),
  provider text NOT NULL CHECK (provider = 'alpaca'),
  feed text NOT NULL CHECK (feed = 'iex'),
  entitlement text NOT NULL CHECK (entitlement = 'real_time'),
  delay_milliseconds integer NOT NULL CHECK (delay_milliseconds = 0),
  source_identifier text NOT NULL,
  provider_timestamp text NOT NULL,
  bar_start timestamptz NOT NULL,
  bar_end timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL,
  open_price numeric NOT NULL CHECK (open_price > 0),
  high_price numeric NOT NULL CHECK (high_price > 0),
  low_price numeric NOT NULL CHECK (low_price > 0),
  close_price numeric NOT NULL CHECK (close_price > 0),
  volume numeric NOT NULL CHECK (volume >= 0),
  event_json text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (event_id ~ '^[0-9a-f]{64}$'),
  CHECK (
    (instrument_symbol = 'AAPL' AND instrument_venue = 'XNAS') OR
    (instrument_symbol = 'SPY' AND instrument_venue = 'ARCX')
  ),
  CHECK (bar_end = bar_start + interval '1 minute'),
  CHECK (low_price <= open_price AND open_price <= high_price),
  CHECK (low_price <= close_price AND close_price <= high_price)
);

CREATE INDEX market_data_event_ledger_session_order_idx
  ON market_data_event_ledger (session_id, ledger_sequence);
CREATE INDEX market_data_event_ledger_ordering_idx
  ON market_data_event_ledger (ordering_key, received_at DESC, event_id DESC);

CREATE TABLE market_data_session_events (
  session_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  session_id text NOT NULL REFERENCES market_data_ingestion_sessions(session_id),
  event_id character(64) NOT NULL REFERENCES market_data_event_ledger(event_id),
  linked_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, event_id)
);

CREATE INDEX market_data_session_events_order_idx
  ON market_data_session_events (session_id, session_sequence);

CREATE TABLE market_data_one_minute_bars (
  instrument_symbol text NOT NULL,
  instrument_venue character(4) NOT NULL,
  bar_start timestamptz NOT NULL,
  bar_end timestamptz NOT NULL,
  event_id character(64) NOT NULL,
  schema_version text NOT NULL
    CHECK (schema_version = 'daily-trader.market-data.one-minute-bar.v1'),
  currency character(3) NOT NULL CHECK (currency = 'USD'),
  price_unit text NOT NULL CHECK (price_unit = 'USD/share'),
  volume_unit text NOT NULL CHECK (volume_unit = 'share'),
  open_price numeric NOT NULL CHECK (open_price > 0),
  high_price numeric NOT NULL CHECK (high_price > 0),
  low_price numeric NOT NULL CHECK (low_price > 0),
  close_price numeric NOT NULL CHECK (close_price > 0),
  volume numeric NOT NULL CHECK (volume >= 0),
  provider text NOT NULL CHECK (provider = 'alpaca'),
  feed text NOT NULL CHECK (feed = 'iex'),
  entitlement text NOT NULL CHECK (entitlement = 'real_time'),
  delay_milliseconds integer NOT NULL CHECK (delay_milliseconds = 0),
  source_identifier text NOT NULL,
  provider_timestamp text NOT NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (instrument_symbol, instrument_venue, bar_start),
  CHECK (
    (instrument_symbol = 'AAPL' AND instrument_venue = 'XNAS') OR
    (instrument_symbol = 'SPY' AND instrument_venue = 'ARCX')
  ),
  CHECK (bar_end = bar_start + interval '1 minute'),
  CHECK (low_price <= open_price AND open_price <= high_price),
  CHECK (low_price <= close_price AND close_price <= high_price)
);

SELECT create_hypertable(
  'market_data_one_minute_bars',
  by_range('bar_start'),
  if_not_exists => TRUE,
  migrate_data => TRUE
);

CREATE INDEX market_data_one_minute_bars_latest_idx
  ON market_data_one_minute_bars (instrument_symbol, bar_start DESC);

CREATE TABLE market_data_gaps (
  instrument_symbol text NOT NULL,
  instrument_venue character(4) NOT NULL,
  expected_bar_start timestamptz NOT NULL,
  first_detected_at timestamptz NOT NULL,
  source_event_id character(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('detected', 'observed_later')),
  PRIMARY KEY (instrument_symbol, instrument_venue, expected_bar_start),
  CHECK (
    (instrument_symbol = 'AAPL' AND instrument_venue = 'XNAS') OR
    (instrument_symbol = 'SPY' AND instrument_venue = 'ARCX')
  )
);
