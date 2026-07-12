import type {
  MarketStatusModel,
  MarketStatusRow,
  MissingMarketStatusRow,
  PresentMarketStatusRow,
} from './types.js';

function renderPresentRow(row: PresentMarketStatusRow): string {
  return [
    `${row.symbol}/${row.venue}`,
    'BAR CLOSE',
    `close=${row.close}`,
    `currency=${row.currency}`,
    `unit=${row.priceUnit}`,
    `bar_start=${row.barStart}`,
    `as_of=${row.asOf}`,
    `provider_timestamp=${row.providerTimestamp}`,
    `received_at=${row.receivedAt}`,
    `age_ms=${String(row.ageMilliseconds)}`,
    `freshness=${row.freshness}`,
    `arrival=${row.arrival}`,
    `provider=${row.source.provider}`,
    `feed=${row.source.feed}`,
    `entitlement=${row.source.entitlement}`,
    `delay_ms=${String(row.source.delayMilliseconds)}`,
  ].join(' | ');
}

function renderMissingRow(row: MissingMarketStatusRow): string {
  return [
    `${row.symbol}/${row.venue}`,
    'MISSING',
    'bar_close=missing',
    `freshness=${row.freshness}`,
  ].join(' | ');
}

export function renderMarketStatusRow(row: MarketStatusRow): string {
  switch (row.state) {
    case 'present':
      return renderPresentRow(row);
    case 'missing':
      return renderMissingRow(row);
  }
}

/** Stable plain-text rendering; it never serializes repository events or payloads. */
export function renderMarketStatus(model: MarketStatusModel): string {
  const overall = model.overall;
  return [
    `MARKET STATUS | observed_at=${model.observedAt}`,
    ...model.rows.map((row) => renderMarketStatusRow(row)),
    [
      'OVERALL',
      `connection=${overall.connection}`,
      `last_event=${overall.lastSuccessfulEvent ?? 'none'}`,
      `gap=${overall.gap}`,
      `redis_delivery=${overall.redisDelivery}`,
      `postgres_persistence=${overall.postgresPersistence}`,
    ].join(' | '),
  ].join('\n');
}
