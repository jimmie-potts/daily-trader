export type MarketDataRecordingErrorCode =
  | 'bounds_mismatch'
  | 'checksum_mismatch'
  | 'count_mismatch'
  | 'duplicate_event'
  | 'event_noncanonical'
  | 'event_schema_unsupported'
  | 'format_unsupported'
  | 'incomplete_scope'
  | 'manifest_invalid'
  | 'recording_malformed'
  | 'recording_noncanonical'
  | 'reader_failed'
  | 'scope_unsupported';

export class MarketDataRecordingError extends Error {
  public readonly code: MarketDataRecordingErrorCode;

  public constructor(code: MarketDataRecordingErrorCode) {
    super(`Market-data recording failed validation: ${code}`);
    this.name = 'MarketDataRecordingError';
    this.code = code;
  }
}

export type MarketDataReplayErrorCode =
  | 'invalid_pacing'
  | 'invalid_target_session'
  | 'sink_failed'
  | 'sleeper_failed'
  | 'unverified_recording';

export class MarketDataReplayError extends Error {
  public readonly code: MarketDataReplayErrorCode;

  public constructor(code: MarketDataReplayErrorCode) {
    super(`Market-data replay failed: ${code}`);
    this.name = 'MarketDataReplayError';
    this.code = code;
  }
}
