import {
  MARKET_DATA_QUALITY_POLICY_VERSION,
  NYSE_CORE_SESSION_CALENDAR,
  MarketEventOrderingTracker,
  isLateArrival,
  serializeOneMinuteBarEvent,
  type OneMinuteBarEvent,
} from '@daily-trader/market-data';
import type { VerifiedSignalReplayRecording } from '@daily-trader/signals';

import { ReplayPersistenceError } from './postgres-port.js';
import type { SqlClient, SqlPool, SqlRow } from '../persistence/sql.js';

function replaySessionId(inputChecksum: string): string {
  return `signal-replay-catalog-${inputChecksum}`;
}

async function transaction<T>(pool: SqlPool, work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (started) await client.query('ROLLBACK');
    if (error instanceof ReplayPersistenceError) throw error;
    throw new ReplayPersistenceError('persistence_failed', { cause: error });
  } finally {
    client.release();
  }
}

function timeliness(event: OneMinuteBarEvent, freshnessThresholdMs: number): string {
  const session = NYSE_CORE_SESSION_CALENDAR.classify(event.barStart);
  if (session.state === 'unknown') return 'unknown';
  if (session.state === 'outside_session') return 'outside_session';
  return isLateArrival(event, event.receivedAt, freshnessThresholdMs) ? 'late' : 'fresh';
}

/** Seeds only the immutable ledger and replay-session association, never the live canonical table. */
export async function seedVerifiedReplayCatalog(
  pool: SqlPool,
  recording: VerifiedSignalReplayRecording,
): Promise<{ readonly sessionId: string; readonly eventCount: number }> {
  const sessionId = replaySessionId(recording.inputChecksum);
  const configuration = recording.manifest.configuration;
  await transaction(pool, async (client) => {
    await client.query(
      `/* signal-replay:seed-session */
       INSERT INTO market_data_ingestion_sessions (
         session_id, mode, provider, feed, entitlement, configuration_version,
         freshness_threshold_ms, started_at
       ) VALUES ($1,'replay','alpaca','iex','real_time',$2,$3,$4)
       ON CONFLICT (session_id) DO NOTHING`,
      [
        sessionId,
        configuration.configurationVersion,
        configuration.freshnessThresholdMs,
        recording.manifest.sessionStart,
      ],
    );
    const session = await client.query<SqlRow>(
      `/* signal-replay:verify-session */
       SELECT mode, provider, feed, entitlement, configuration_version,
              freshness_threshold_ms
       FROM market_data_ingestion_sessions WHERE session_id = $1 FOR UPDATE`,
      [sessionId],
    );
    const row = session.rows[0];
    if (
      session.rows.length !== 1 ||
      row?.mode !== 'replay' ||
      row.provider !== 'alpaca' ||
      row.feed !== 'iex' ||
      row.entitlement !== 'real_time' ||
      row.configuration_version !== configuration.configurationVersion ||
      row.freshness_threshold_ms !== configuration.freshnessThresholdMs
    ) {
      throw new ReplayPersistenceError('stored_data_invalid');
    }

    const ordering = new MarketEventOrderingTracker({
      freshnessThresholdMs: configuration.freshnessThresholdMs,
      maximumTrackedEvents: recording.catalog.events.length,
    });
    for (const event of recording.catalog.events) {
      const classified = ordering.classify(event, event.receivedAt);
      if (classified.classification === 'duplicate') {
        throw new ReplayPersistenceError('stored_data_invalid');
      }
      const eventJson = serializeOneMinuteBarEvent(event);
      await client.query(
        `/* signal-replay:seed-event */
         INSERT INTO market_data_event_ledger (
           event_id, session_id, freshness_threshold_ms, data_quality_policy_version,
           schema_version, event_type, ordering_key, arrival_classification,
           timeliness, gap_state, instrument_symbol, instrument_venue, interval_iso,
           currency, price_unit, volume_unit, provider, feed, entitlement,
           delay_milliseconds, source_identifier, provider_timestamp, bar_start,
           bar_end, received_at, processed_at, open_price, high_price, low_price,
           close_price, volume, event_json
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
           $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
         ) ON CONFLICT (event_id) DO NOTHING`,
        [
          event.eventId,
          sessionId,
          configuration.freshnessThresholdMs,
          MARKET_DATA_QUALITY_POLICY_VERSION,
          event.schemaVersion,
          event.kind,
          event.orderingKey,
          classified.classification,
          timeliness(event, configuration.freshnessThresholdMs),
          classified.gap.state,
          event.instrument.symbol,
          event.instrument.venue,
          event.interval,
          event.currency,
          event.priceUnit,
          event.volumeUnit,
          event.source.provider,
          event.source.feed,
          event.source.entitlement,
          event.source.delayMilliseconds,
          event.source.identifier,
          event.providerTimestamp,
          event.barStart,
          event.barEnd,
          event.receivedAt,
          event.processedAt,
          event.open,
          event.high,
          event.low,
          event.close,
          event.volume,
          eventJson,
        ],
      );
      const stored = await client.query<{ readonly event_json: unknown }>(
        `/* signal-replay:verify-event */
         SELECT event_json FROM market_data_event_ledger WHERE event_id = $1`,
        [event.eventId],
      );
      if (stored.rows.length !== 1 || stored.rows[0]?.event_json !== eventJson) {
        throw new ReplayPersistenceError('stored_data_invalid');
      }
      await client.query(
        `/* signal-replay:link-event */
         INSERT INTO market_data_session_events (session_id, event_id)
         VALUES ($1,$2) ON CONFLICT (session_id,event_id) DO NOTHING`,
        [sessionId, event.eventId],
      );
    }
    await client.query(
      `/* signal-replay:close-session */
       UPDATE market_data_ingestion_sessions
       SET ended_at = COALESCE(ended_at, $2) WHERE session_id = $1`,
      [sessionId, recording.manifest.sessionEnd],
    );
  });
  return Object.freeze({ sessionId, eventCount: recording.catalog.events.length });
}
