import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import {
  createPhase2MarketDataSubscription,
  MarketDataAdapterError,
} from '@daily-trader/market-data';
import { initializeObservability } from '@daily-trader/observability';

import { AlpacaMarketDataAdapter } from './providers/alpaca/adapter.js';
import { createNodeWebSocketFactory } from './providers/alpaca/node-websocket-factory.js';
import { SystemClock } from './system-clock.js';

function write(event: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function smoke(): Promise<void> {
  loadOptionalEnvironmentFile();
  const config = loadConfig();
  if (
    config.marketData.mode !== 'paper' ||
    config.marketData.apiKey === undefined ||
    config.marketData.apiSecret === undefined
  ) {
    throw new MarketDataAdapterError(
      'authentication',
      'MARKET_DATA_PAPER_MODE_REQUIRED',
      'Provider smoke requires explicit paper market-data mode and credentials',
    );
  }

  const telemetry = initializeObservability({
    environment: config.environment,
    exporter: config.runtime.telemetryExporter,
    serviceName: 'daily-trader-market-data-smoke',
    shutdownTimeoutMs: config.marketData.shutdownTimeoutMs,
  });
  const controller = new AbortController();
  const overallTimeoutMs = Math.min(
    180_000,
    config.marketData.connectionTimeoutMs * 3 + config.marketData.inactivityTimeoutMs,
  );
  const timeout = setTimeout(() => controller.abort(), overallTimeoutMs);
  const seen = new Set<string>();

  try {
    const adapter = new AlpacaMarketDataAdapter(
      {
        apiKey: config.marketData.apiKey,
        apiSecret: config.marketData.apiSecret,
        connectionTimeoutMs: config.marketData.connectionTimeoutMs,
        inactivityTimeoutMs: config.marketData.inactivityTimeoutMs,
        queueCapacity: config.marketData.queueCapacity,
        shutdownTimeoutMs: config.marketData.shutdownTimeoutMs,
        url: config.marketData.websocketUrl,
      },
      { clock: new SystemClock(), webSocketFactory: createNodeWebSocketFactory() },
    );
    const connection = await adapter.connect({
      subscription: createPhase2MarketDataSubscription(),
      signal: controller.signal,
      handlers: {
        onEvent: (event): void => {
          seen.add(event.instrument.symbol);
          write({
            event: 'market_data.provider_smoke.bar',
            symbol: event.instrument.symbol,
            venue: event.instrument.venue,
            schemaVersion: event.schemaVersion,
            eventId: event.eventId,
            providerTimestamp: event.providerTimestamp,
            barStart: event.barStart,
            provider: event.source.provider,
            feed: event.source.feed,
            entitlement: event.source.entitlement,
            delayMilliseconds: event.source.delayMilliseconds,
          });
          if (seen.has('AAPL') && seen.has('SPY')) {
            controller.abort();
          }
        },
        onInactivity: (occurredAt): void => {
          write({ event: 'market_data.provider_smoke.inactive', occurredAt });
        },
        onStatus: (status): void => {
          write({
            event: 'market_data.provider_smoke.connection',
            state: status.state,
            occurredAt: status.occurredAt,
            provider: config.marketData.provider,
            feed: config.marketData.feed,
            entitlement: 'real_time',
            delayMilliseconds: 0,
          });
        },
      },
    });
    await connection.done;

    if (!seen.has('AAPL') || !seen.has('SPY')) {
      throw new MarketDataAdapterError(
        'retryable_transport',
        'PROVIDER_SMOKE_INCOMPLETE',
        'Provider smoke ended before both approved symbols produced a bar',
      );
    }
    write({
      event: 'market_data.provider_smoke.complete',
      status: 'passed',
      symbols: ['AAPL', 'SPY'],
    });
  } finally {
    clearTimeout(timeout);
    await telemetry.shutdown();
  }
}

void smoke().catch((error: unknown) => {
  const event =
    error instanceof ConfigurationError
      ? { event: 'market_data.provider_smoke.configuration.invalid', issues: error.issues }
      : error instanceof MarketDataAdapterError
        ? {
            event: 'market_data.provider_smoke.failed',
            code: error.code,
            classification: error.classification,
          }
        : { event: 'market_data.provider_smoke.failed', code: 'PROVIDER_SMOKE_FAILED' };
  process.stderr.write(`${JSON.stringify(event)}\n`);
  process.exitCode = 1;
});
