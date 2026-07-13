import { describe, expect, it } from 'vitest';

import {
  ALPACA_IEX_WEBSOCKET_URL,
  ALPACA_PAPER_TRADING_API_URL,
  ConfigurationError,
  LOCAL_DATABASE_URL,
  LOCAL_REDIS_URL,
  MARKET_DATA_SYMBOLS,
  PORTFOLIO_READ_RESOURCES,
  getSafeConfigDiagnostics,
  loadConfig,
  loadOptionalEnvironmentFile,
  redactEnvironment,
} from './index.js';

describe('loadConfig', () => {
  it('allows an optional local environment file to be absent', () => {
    expect(() => loadOptionalEnvironmentFile('.definitely-not-present.env')).not.toThrow();
  });

  it('uses safe, local, paper-only defaults', () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      environment: 'local',
      runtime: {
        logLevel: 'info',
        telemetryExporter: 'none',
      },
      api: {
        host: '127.0.0.1',
        port: 3001,
      },
      worker: {
        heartbeatIntervalMs: 30_000,
      },
      marketData: {
        mode: 'disabled',
        provider: 'alpaca',
        feed: 'iex',
        websocketUrl: ALPACA_IEX_WEBSOCKET_URL,
        apiKey: undefined,
        apiSecret: undefined,
        symbols: ['AAPL', 'SPY'],
        connectionTimeoutMs: 10_000,
        inactivityTimeoutMs: 90_000,
        freshnessThresholdMs: 120_000,
        shutdownTimeoutMs: 10_000,
        queueCapacity: 256,
        reconnect: {
          maxAttempts: 5,
          baseDelayMs: 500,
          maxDelayMs: 30_000,
          jitterPercent: 20,
        },
      },
      signal: {
        mode: 'disabled',
        configuration: {
          signalDefinitionVersion: 'breakout_plus_volume.v1',
          configurationVersion: 'phase3-v1',
          lookbackBars: 20,
          volumeMultiplier: '1.5',
          freshnessThresholdMs: 120_000,
        },
        operational: {
          journalPollIntervalMs: 250,
          claimBatchSize: 50,
          queueCapacity: 1_000,
          retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 5_000 },
          backlogLimit: 10_000,
          statementTimeoutMs: 10_000,
          shutdownTimeoutMs: 10_000,
        },
      },
      portfolio: {
        mode: 'disabled',
        provider: 'alpaca',
        readResources: ['account', 'positions', 'orders', 'fills'],
        baseUrl: ALPACA_PAPER_TRADING_API_URL,
        apiKey: undefined,
        apiSecret: undefined,
        expectedAccountId: undefined,
        operational: {
          syncIntervalMs: 30_000,
          requestTimeoutMs: 10_000,
          staleAfterMs: 90_000,
          maxResponseBytes: 4_194_304,
          maxPages: 20,
          orderPageSize: 500,
          fillPageSize: 100,
          maxPositions: 1_000,
          maxOrders: 5_000,
          maxFillsPerSync: 5_000,
          retry: {
            maxAttempts: 3,
            baseDelayMs: 250,
            maxDelayMs: 5_000,
            jitterPercent: 20,
          },
          statementTimeoutMs: 10_000,
          claimLeaseMs: 60_000,
          claimRenewIntervalMs: 20_000,
          shutdownTimeoutMs: 10_000,
        },
      },
      trading: {
        brokerMode: 'paper',
        executionEnabled: false,
      },
      services: {
        database: {
          url: LOCAL_DATABASE_URL,
          connectionTimeoutMs: 5_000,
        },
        redis: {
          url: LOCAL_REDIS_URL,
          connectionTimeoutMs: 5_000,
        },
      },
    });
  });

  it('parses valid explicit local settings', () => {
    const config = loadConfig({
      APP_ENV: 'test',
      BROKER_MODE: 'paper',
      EXECUTION_ENABLED: 'false',
      DATABASE_URL: 'postgresql://user:password@localhost:55432/test_database',
      DATABASE_CONNECTION_TIMEOUT_MS: '1200',
      REDIS_URL: 'rediss://user:password@localhost:56379',
      REDIS_CONNECTION_TIMEOUT_MS: '1300',
      LOG_LEVEL: 'debug',
      TELEMETRY_EXPORTER: 'console',
      API_PORT: '3101',
      WORKER_HEARTBEAT_INTERVAL_MS: '1500',
      MARKET_DATA_MODE: 'paper',
      MARKET_DATA_PROVIDER: 'alpaca',
      MARKET_DATA_FEED: 'iex',
      MARKET_DATA_WS_URL: ALPACA_IEX_WEBSOCKET_URL,
      MARKET_DATA_API_KEY: 'market-data-key',
      MARKET_DATA_API_SECRET: 'market-data-secret',
      MARKET_DATA_SYMBOLS: 'AAPL,SPY',
      MARKET_DATA_CONNECTION_TIMEOUT_MS: '2000',
      MARKET_DATA_INACTIVITY_TIMEOUT_MS: '60000',
      MARKET_DATA_FRESHNESS_THRESHOLD_MS: '180000',
      MARKET_DATA_SHUTDOWN_TIMEOUT_MS: '5000',
      MARKET_DATA_QUEUE_CAPACITY: '32',
      MARKET_DATA_RECONNECT_MAX_ATTEMPTS: '3',
      MARKET_DATA_RECONNECT_BASE_DELAY_MS: '250',
      MARKET_DATA_RECONNECT_MAX_DELAY_MS: '5000',
      MARKET_DATA_RECONNECT_JITTER_PERCENT: '10',
      SIGNAL_MODE: 'monitor',
      SIGNAL_CONFIGURATION_VERSION: 'phase3-test-v1',
      SIGNAL_DEFINITION: 'breakout_plus_volume.v1',
      SIGNAL_SYMBOLS: 'AAPL,SPY',
      SIGNAL_LOOKBACK_WINDOW: '5',
      SIGNAL_VOLUME_MULTIPLIER: '2.25',
      SIGNAL_JOURNAL_POLL_INTERVAL_MS: '100',
      SIGNAL_CLAIM_BATCH_SIZE: '10',
      SIGNAL_QUEUE_CAPACITY: '20',
      SIGNAL_RETRY_MAX_ATTEMPTS: '3',
      SIGNAL_RETRY_BASE_DELAY_MS: '50',
      SIGNAL_RETRY_MAX_DELAY_MS: '1000',
      SIGNAL_RETRY_JITTER_PERCENT: '10',
      SIGNAL_BACKLOG_LIMIT: '40',
      SIGNAL_STATEMENT_TIMEOUT_MS: '1000',
      SIGNAL_CLAIM_LEASE_MS: '5000',
      SIGNAL_CLAIM_RENEW_INTERVAL_MS: '1000',
      SIGNAL_SHUTDOWN_TIMEOUT_MS: '3000',
      PORTFOLIO_MODE: 'paper_read_only',
      PORTFOLIO_SYNC_INTERVAL_MS: '5000',
      PORTFOLIO_REQUEST_TIMEOUT_MS: '1500',
      PORTFOLIO_STALE_AFTER_MS: '10000',
      PORTFOLIO_MAX_RESPONSE_BYTES: '2048',
      PORTFOLIO_MAX_PAGES: '2',
      PORTFOLIO_ORDER_PAGE_SIZE: '250',
      PORTFOLIO_FILL_PAGE_SIZE: '50',
      PORTFOLIO_MAX_POSITIONS: '20',
      PORTFOLIO_MAX_ORDERS: '30',
      PORTFOLIO_MAX_FILLS_PER_SYNC: '40',
      PORTFOLIO_RETRY_MAX_ATTEMPTS: '2',
      PORTFOLIO_RETRY_BASE_DELAY_MS: '100',
      PORTFOLIO_RETRY_MAX_DELAY_MS: '500',
      PORTFOLIO_RETRY_JITTER_PERCENT: '10',
      PORTFOLIO_STATEMENT_TIMEOUT_MS: '1200',
      PORTFOLIO_CLAIM_LEASE_MS: '6000',
      PORTFOLIO_CLAIM_RENEW_INTERVAL_MS: '2000',
      PORTFOLIO_SHUTDOWN_TIMEOUT_MS: '3000',
      PAPER_BROKER_BASE_URL: ALPACA_PAPER_TRADING_API_URL,
      PAPER_BROKER_API_KEY: 'paper-key-value',
      PAPER_BROKER_API_SECRET: 'paper-secret-value',
      PAPER_BROKER_ACCOUNT_ID: 'paper-account-123',
    });

    expect(config.environment).toBe('test');
    expect(config.services.database.connectionTimeoutMs).toBe(1_200);
    expect(config.services.redis.connectionTimeoutMs).toBe(1_300);
    expect(config.runtime).toEqual({ logLevel: 'debug', telemetryExporter: 'console' });
    expect(config.api.port).toBe(3_101);
    expect(config.worker.heartbeatIntervalMs).toBe(1_500);
    expect(config.marketData).toEqual({
      mode: 'paper',
      provider: 'alpaca',
      feed: 'iex',
      websocketUrl: ALPACA_IEX_WEBSOCKET_URL,
      apiKey: 'market-data-key',
      apiSecret: 'market-data-secret',
      symbols: ['AAPL', 'SPY'],
      connectionTimeoutMs: 2_000,
      inactivityTimeoutMs: 60_000,
      freshnessThresholdMs: 180_000,
      shutdownTimeoutMs: 5_000,
      queueCapacity: 32,
      reconnect: {
        maxAttempts: 3,
        baseDelayMs: 250,
        maxDelayMs: 5_000,
        jitterPercent: 10,
      },
    });
    expect(config.providers.paperBroker.apiKey).toBe('paper-key-value');
    expect(config.portfolio).toMatchObject({
      mode: 'paper_read_only',
      provider: 'alpaca',
      readResources: ['account', 'positions', 'orders', 'fills'],
      baseUrl: ALPACA_PAPER_TRADING_API_URL,
      expectedAccountId: 'paper-account-123',
      operational: {
        syncIntervalMs: 5_000,
        requestTimeoutMs: 1_500,
        staleAfterMs: 10_000,
        maxPages: 2,
        orderPageSize: 250,
        fillPageSize: 50,
        maxPositions: 20,
        maxOrders: 30,
        maxFillsPerSync: 40,
        statementTimeoutMs: 1_200,
        claimLeaseMs: 6_000,
        claimRenewIntervalMs: 2_000,
      },
    });
    expect(config.signal).toMatchObject({
      mode: 'monitor',
      configuration: {
        configurationVersion: 'phase3-test-v1',
        lookbackBars: 5,
        volumeMultiplier: '2.25',
        freshnessThresholdMs: 180_000,
      },
      operational: {
        claimBatchSize: 10,
        queueCapacity: 20,
        backlogLimit: 40,
        claimLeaseMs: 5_000,
        claimRenewIntervalMs: 1_000,
      },
    });
  });

  it('freezes market-data configuration and the exact Phase 2 subscription scope', () => {
    const config = loadConfig({});

    expect(config.marketData.symbols).toBe(MARKET_DATA_SYMBOLS);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.marketData)).toBe(true);
    expect(Object.isFrozen(config.marketData.symbols)).toBe(true);
    expect(Object.isFrozen(config.marketData.reconnect)).toBe(true);
    expect(Object.isFrozen(config.signal)).toBe(true);
    expect(Object.isFrozen(config.signal.configuration)).toBe(true);
    expect(Object.isFrozen(config.signal.configuration.scope)).toBe(true);
    expect(Object.isFrozen(config.signal.operational)).toBe(true);
    expect(Object.isFrozen(config.signal.operational.retry)).toBe(true);
    expect(Object.isFrozen(config.portfolio)).toBe(true);
    expect(config.portfolio.readResources).toBe(PORTFOLIO_READ_RESOURCES);
    expect(Object.isFrozen(config.portfolio.readResources)).toBe(true);
    expect(Object.isFrozen(config.portfolio.operational)).toBe(true);
    expect(Object.isFrozen(config.portfolio.operational.retry)).toBe(true);
  });

  it('requires service locations outside local and test environments', () => {
    expect(() => loadConfig({ APP_ENV: 'staging' })).toThrowError(
      'DATABASE_URL: must be set explicitly outside local and test environments',
    );
    expect(() => loadConfig({ APP_ENV: 'production' })).toThrowError(
      'REDIS_URL: must be set explicitly outside local and test environments',
    );
  });

  it('reports missing paired values by name without echoing secrets', () => {
    const secret = 'must-never-appear-in-an-error';

    expect(() =>
      loadConfig({
        DATABASE_URL: ' ',
        PAPER_BROKER_API_KEY: secret,
      }),
    ).toThrowError(ConfigurationError);

    try {
      loadConfig({ DATABASE_URL: ' ', PAPER_BROKER_API_KEY: secret });
      throw new Error('expected loadConfig to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).toContain('PAPER_BROKER_API_KEY');
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each([
    ['EXECUTION_ENABLED', 'true', 'must remain false while execution is out of scope'],
    ['BROKER_MODE', 'live', 'must be paper in the current paper-only phase'],
    ['DATABASE_URL', 'https://database.example.invalid', 'postgres'],
    ['REDIS_URL', 'postgresql://localhost/redis', 'redis'],
    ['DATABASE_CONNECTION_TIMEOUT_MS', 'forever', 'milliseconds'],
    ['LOG_LEVEL', 'verbose', 'Invalid option'],
    ['TELEMETRY_EXPORTER', 'otlp', 'Invalid option'],
    ['API_HOST', '0.0.0.0', 'Invalid option'],
    ['API_PORT', '70000', '65535'],
    ['WORKER_HEARTBEAT_INTERVAL_MS', '10', '1000'],
  ])('rejects invalid %s', (setting, value, expectedMessage) => {
    expect(() => loadConfig({ [setting]: value })).toThrowError(expectedMessage);
  });

  it.each([
    ['MARKET_DATA_MODE', 'live'],
    ['MARKET_DATA_PROVIDER', 'polygon'],
    ['MARKET_DATA_FEED', 'sip'],
    ['MARKET_DATA_SYMBOLS', 'SPY,AAPL'],
    ['MARKET_DATA_SYMBOLS', 'AAPL,SPY,QQQ'],
    ['MARKET_DATA_WS_URL', 'ws://stream.data.alpaca.markets/v2/iex'],
    ['MARKET_DATA_WS_URL', 'wss://stream.data.sandbox.alpaca.markets/v2/iex'],
    ['MARKET_DATA_WS_URL', 'wss://stream.data.alpaca.markets/v2/sip'],
    ['MARKET_DATA_WS_URL', `${ALPACA_IEX_WEBSOCKET_URL}?fallback=sip`],
  ])('rejects unsupported market-data identity or scope in %s', (setting, value) => {
    expect(() => loadConfig({ [setting]: value })).toThrowError(ConfigurationError);
  });

  it('requires a complete credential pair only when paper mode is enabled', () => {
    expect(() => loadConfig({ MARKET_DATA_MODE: 'paper' })).toThrowError(
      'MARKET_DATA_API_KEY: API key and secret are required in paper mode',
    );

    const secret = 'market-data-secret-must-not-leak';
    try {
      loadConfig({ MARKET_DATA_MODE: 'paper', MARKET_DATA_API_SECRET: secret });
      throw new Error('expected loadConfig to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).toContain('MARKET_DATA_API_KEY');
      expect(String(error)).not.toContain(secret);
    }

    expect(() =>
      loadConfig({
        MARKET_DATA_MODE: 'paper',
        MARKET_DATA_API_KEY: 'paper-market-key',
        MARKET_DATA_API_SECRET: 'paper-market-secret',
      }),
    ).not.toThrow();
  });

  it('rejects a partial credential pair even while the feed is disabled', () => {
    expect(() => loadConfig({ MARKET_DATA_API_KEY: 'unused-key' })).toThrowError(
      'API key and secret must be provided together',
    );
  });

  it.each([
    ['MARKET_DATA_CONNECTION_TIMEOUT_MS', '99'],
    ['MARKET_DATA_INACTIVITY_TIMEOUT_MS', '999'],
    ['MARKET_DATA_FRESHNESS_THRESHOLD_MS', '59999'],
    ['MARKET_DATA_SHUTDOWN_TIMEOUT_MS', '99'],
    ['MARKET_DATA_QUEUE_CAPACITY', '0'],
    ['MARKET_DATA_QUEUE_CAPACITY', '10001'],
    ['MARKET_DATA_RECONNECT_MAX_ATTEMPTS', '0'],
    ['MARKET_DATA_RECONNECT_MAX_ATTEMPTS', '21'],
    ['MARKET_DATA_RECONNECT_BASE_DELAY_MS', '99'],
    ['MARKET_DATA_RECONNECT_MAX_DELAY_MS', '120001'],
    ['MARKET_DATA_RECONNECT_JITTER_PERCENT', '51'],
  ])('rejects out-of-bounds %s', (setting, value) => {
    expect(() => loadConfig({ [setting]: value })).toThrowError(ConfigurationError);
  });

  it.each([
    [
      {
        MARKET_DATA_CONNECTION_TIMEOUT_MS: '10000',
        MARKET_DATA_INACTIVITY_TIMEOUT_MS: '10000',
      },
      'MARKET_DATA_CONNECTION_TIMEOUT_MS',
    ],
    [
      {
        MARKET_DATA_RECONNECT_BASE_DELAY_MS: '30000',
        MARKET_DATA_RECONNECT_MAX_DELAY_MS: '20000',
      },
      'MARKET_DATA_RECONNECT_BASE_DELAY_MS',
    ],
    [
      {
        MARKET_DATA_INACTIVITY_TIMEOUT_MS: '90000',
        MARKET_DATA_RECONNECT_MAX_DELAY_MS: '100000',
      },
      'MARKET_DATA_RECONNECT_MAX_DELAY_MS',
    ],
    [
      {
        MARKET_DATA_INACTIVITY_TIMEOUT_MS: '90000',
        MARKET_DATA_RECONNECT_MAX_DELAY_MS: '80000',
        MARKET_DATA_RECONNECT_JITTER_PERCENT: '50',
      },
      'MARKET_DATA_RECONNECT_MAX_DELAY_MS',
    ],
  ])('rejects unsafe cross-field market-data bounds', (environment, expectedSetting) => {
    expect(() => loadConfig(environment)).toThrowError(expectedSetting);
  });

  it('fails invalid market-data configuration before a connector can be created', () => {
    let connectorCreated = false;
    const createConnector = (): void => {
      connectorCreated = true;
    };

    expect(() => {
      loadConfig({ MARKET_DATA_MODE: 'paper' });
      createConnector();
    }).toThrowError(ConfigurationError);
    expect(connectorCreated).toBe(false);
  });

  it.each([
    ['SIGNAL_MODE', 'execute'],
    ['SIGNAL_DEFINITION', 'another_signal.v1'],
    ['SIGNAL_SYMBOLS', 'SPY,AAPL'],
    ['SIGNAL_SYMBOLS', 'AAPL,SPY,QQQ'],
    ['SIGNAL_LOOKBACK_WINDOW', '0'],
    ['SIGNAL_LOOKBACK_WINDOW', '391'],
    ['SIGNAL_VOLUME_MULTIPLIER', '1.50'],
    ['SIGNAL_VOLUME_MULTIPLIER', '1e1'],
    ['SIGNAL_VOLUME_MULTIPLIER', '10.1'],
    ['SIGNAL_CLAIM_BATCH_SIZE', '0'],
    ['SIGNAL_BACKLOG_LIMIT', '100001'],
  ])('rejects unsupported signal configuration in %s', (setting, value) => {
    expect(() => loadConfig({ [setting]: value })).toThrowError(ConfigurationError);
  });

  it('rejects unknown signal settings and unsafe operational relationships', () => {
    expect(() => loadConfig({ SIGNAL_DYNAMIC_THRESHOLD: '2' })).toThrowError(
      'SIGNAL_DYNAMIC_THRESHOLD',
    );
    expect(() =>
      loadConfig({ SIGNAL_CLAIM_BATCH_SIZE: '11', SIGNAL_QUEUE_CAPACITY: '10' }),
    ).toThrowError('SIGNAL_CLAIM_BATCH_SIZE');
    expect(() =>
      loadConfig({ SIGNAL_QUEUE_CAPACITY: '101', SIGNAL_BACKLOG_LIMIT: '100' }),
    ).toThrowError('SIGNAL_QUEUE_CAPACITY');
    expect(() =>
      loadConfig({ SIGNAL_RETRY_BASE_DELAY_MS: '2000', SIGNAL_RETRY_MAX_DELAY_MS: '1000' }),
    ).toThrowError('SIGNAL_RETRY_BASE_DELAY_MS');
    expect(() =>
      loadConfig({ SIGNAL_CLAIM_LEASE_MS: '30000', SIGNAL_CLAIM_RENEW_INTERVAL_MS: '11000' }),
    ).toThrowError('SIGNAL_CLAIM_RENEW_INTERVAL_MS');
    expect(() =>
      loadConfig({
        SIGNAL_RETRY_MAX_DELAY_MS: '20000',
        SIGNAL_RETRY_JITTER_PERCENT: '50',
        SIGNAL_STATEMENT_TIMEOUT_MS: '10000',
        SIGNAL_CLAIM_LEASE_MS: '30000',
      }),
    ).toThrowError('SIGNAL_CLAIM_LEASE_MS');
  });

  it('fails invalid signal configuration before a database connection can be created', () => {
    let databaseConnected = false;
    expect(() => {
      loadConfig({ SIGNAL_MODE: 'monitor', SIGNAL_VOLUME_MULTIPLIER: '1000' });
      databaseConnected = true;
    }).toThrowError(ConfigurationError);
    expect(databaseConnected).toBe(false);
  });

  it('pins a separate read-only paper portfolio boundary and rejects unsafe settings', () => {
    expect(() => loadConfig({ PORTFOLIO_MODE: 'paper_read_only' })).toThrowError(
      'PAPER_BROKER_API_KEY: API key and secret are required in paper_read_only mode',
    );
    expect(() =>
      loadConfig({
        PORTFOLIO_MODE: 'paper_read_only',
        PAPER_BROKER_API_KEY: 'paper-key',
        PAPER_BROKER_API_SECRET: 'paper-secret',
      }),
    ).toThrowError(
      'PAPER_BROKER_ACCOUNT_ID: expected account ID is required in paper_read_only mode',
    );
    expect(() =>
      loadConfig({ PAPER_BROKER_BASE_URL: 'https://api.alpaca.markets/v2' }),
    ).toThrowError(ConfigurationError);
    expect(() =>
      loadConfig({ PAPER_BROKER_BASE_URL: `${ALPACA_PAPER_TRADING_API_URL}?live=true` }),
    ).toThrowError(ConfigurationError);
    expect(() => loadConfig({ PORTFOLIO_ORDER_SUBMISSION: 'true' })).toThrowError(
      'PORTFOLIO_ORDER_SUBMISSION',
    );
    expect(() => loadConfig({ PAPER_BROKER_ORDER_URL: '/orders' })).toThrowError(
      'PAPER_BROKER_ORDER_URL',
    );
    expect(() => loadConfig({ LIVE_BROKER_MUTATION_URL: '/orders' })).toThrowError(
      'LIVE_BROKER_MUTATION_URL',
    );
  });

  it.each([
    ['PORTFOLIO_SYNC_INTERVAL_MS', '4999'],
    ['PORTFOLIO_REQUEST_TIMEOUT_MS', '99'],
    ['PORTFOLIO_MAX_RESPONSE_BYTES', '1023'],
    ['PORTFOLIO_MAX_PAGES', '101'],
    ['PORTFOLIO_ORDER_PAGE_SIZE', '501'],
    ['PORTFOLIO_FILL_PAGE_SIZE', '101'],
    ['PORTFOLIO_MAX_POSITIONS', '0'],
    ['PORTFOLIO_MAX_ORDERS', '50001'],
    ['PORTFOLIO_MAX_FILLS_PER_SYNC', '50001'],
    ['PORTFOLIO_RETRY_MAX_ATTEMPTS', '6'],
    ['PORTFOLIO_STATEMENT_TIMEOUT_MS', '99'],
  ])('rejects out-of-bounds portfolio setting %s', (setting, value) => {
    expect(() => loadConfig({ [setting]: value })).toThrowError(ConfigurationError);
  });

  it('rejects unsafe portfolio timing relationships', () => {
    expect(() =>
      loadConfig({ PORTFOLIO_SYNC_INTERVAL_MS: '60000', PORTFOLIO_STALE_AFTER_MS: '90000' }),
    ).toThrowError('PORTFOLIO_STALE_AFTER_MS');
    expect(() =>
      loadConfig({
        PORTFOLIO_RETRY_BASE_DELAY_MS: '1000',
        PORTFOLIO_RETRY_MAX_DELAY_MS: '500',
      }),
    ).toThrowError('PORTFOLIO_RETRY_BASE_DELAY_MS');
    expect(() =>
      loadConfig({
        PORTFOLIO_CLAIM_LEASE_MS: '30000',
        PORTFOLIO_CLAIM_RENEW_INTERVAL_MS: '11000',
      }),
    ).toThrowError('PORTFOLIO_CLAIM_RENEW_INTERVAL_MS');
  });

  it('keeps live settings separate and rejects them in the current paper-only phase', () => {
    const liveSecret = 'live-secret-must-stay-private';

    try {
      loadConfig({
        PAPER_BROKER_API_KEY: 'paper-key',
        PAPER_BROKER_API_SECRET: 'paper-secret',
        LIVE_BROKER_API_SECRET: liveSecret,
      });
      throw new Error('expected loadConfig to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).toContain('LIVE_BROKER_API_SECRET');
      expect(String(error)).not.toContain(liveSecret);
    }
  });
});

describe('safe diagnostics', () => {
  it('does not expose passwords, provider secrets, or account identifiers', () => {
    const sensitiveValues = [
      'database-password',
      'redis-password',
      ALPACA_IEX_WEBSOCKET_URL,
      ALPACA_PAPER_TRADING_API_URL,
      'market-data-key',
      'market-data-secret',
      'paper-key',
      'paper-secret',
      'account-98765',
    ];
    const config = loadConfig({
      DATABASE_URL: 'postgresql://daily_trader:database-password@db.local:5432/daily_trader',
      REDIS_URL: 'redis://default:redis-password@cache.local:6379',
      MARKET_DATA_API_KEY: 'market-data-key',
      MARKET_DATA_API_SECRET: 'market-data-secret',
      PAPER_BROKER_BASE_URL: ALPACA_PAPER_TRADING_API_URL,
      PAPER_BROKER_API_KEY: 'paper-key',
      PAPER_BROKER_API_SECRET: 'paper-secret',
      PAPER_BROKER_ACCOUNT_ID: 'account-98765',
    });

    const serializedDiagnostics = JSON.stringify(getSafeConfigDiagnostics(config));

    expect(serializedDiagnostics).toContain('"environment":"local"');
    expect(serializedDiagnostics).toContain('"host":"db.local"');
    expect(serializedDiagnostics).toContain('"mode":"disabled"');
    expect(serializedDiagnostics).toContain('"provider":"alpaca"');
    expect(serializedDiagnostics).toContain('"feed":"iex"');
    expect(serializedDiagnostics).toContain('"symbols":["AAPL","SPY"]');
    expect(serializedDiagnostics).toContain('"credentialsConfigured":true');
    for (const sensitiveValue of sensitiveValues) {
      expect(serializedDiagnostics).not.toContain(sensitiveValue);
    }
  });

  it('reports frozen nonsecret market-data bounds without an endpoint', () => {
    const diagnostics = getSafeConfigDiagnostics(loadConfig({}));

    expect(diagnostics.marketData).toEqual({
      mode: 'disabled',
      provider: 'alpaca',
      feed: 'iex',
      symbols: ['AAPL', 'SPY'],
      credentialsConfigured: false,
      connectionTimeoutMs: 10_000,
      inactivityTimeoutMs: 90_000,
      freshnessThresholdMs: 120_000,
      shutdownTimeoutMs: 10_000,
      queueCapacity: 256,
      reconnect: {
        maxAttempts: 5,
        baseDelayMs: 500,
        maxDelayMs: 30_000,
        jitterPercent: 20,
      },
    });
    expect(Object.isFrozen(diagnostics.marketData)).toBe(true);
    expect(Object.isFrozen(diagnostics.marketData.reconnect)).toBe(true);
    expect(diagnostics.marketData).not.toHaveProperty('websocketUrl');
    expect(diagnostics.marketData).not.toHaveProperty('apiKey');
    expect(diagnostics.marketData).not.toHaveProperty('apiSecret');
    expect(diagnostics.signal).toMatchObject({
      mode: 'disabled',
      signalDefinitionVersion: 'breakout_plus_volume.v1',
      configurationVersion: 'phase3-v1',
      lookbackBars: 20,
      volumeMultiplier: '1.5',
    });
    expect(diagnostics.signal).not.toHaveProperty('apiKey');
    expect(diagnostics.signal).not.toHaveProperty('apiSecret');
    expect(diagnostics.portfolio).toEqual({
      mode: 'disabled',
      provider: 'alpaca',
      readResources: ['account', 'positions', 'orders', 'fills'],
      credentialsConfigured: false,
      expectedAccountConfigured: false,
      operational: {
        syncIntervalMs: 30_000,
        requestTimeoutMs: 10_000,
        staleAfterMs: 90_000,
        maxResponseBytes: 4_194_304,
        maxPages: 20,
        orderPageSize: 500,
        fillPageSize: 100,
        maxPositions: 1_000,
        maxOrders: 5_000,
        maxFillsPerSync: 5_000,
        retry: {
          maxAttempts: 3,
          baseDelayMs: 250,
          maxDelayMs: 5_000,
          jitterPercent: 20,
        },
        statementTimeoutMs: 10_000,
        claimLeaseMs: 60_000,
        claimRenewIntervalMs: 20_000,
        shutdownTimeoutMs: 10_000,
      },
    });
    expect(diagnostics.portfolio).not.toHaveProperty('baseUrl');
    expect(diagnostics.portfolio).not.toHaveProperty('apiKey');
    expect(diagnostics.portfolio).not.toHaveProperty('apiSecret');
    expect(Object.isFrozen(diagnostics.portfolio.readResources)).toBe(true);
  });

  it('redacts credential-like environment fields', () => {
    expect(
      redactEnvironment({
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://user:secret@localhost/database',
        MARKET_DATA_WS_URL: ALPACA_IEX_WEBSOCKET_URL,
        MARKET_DATA_API_KEY: 'market-key',
        MARKET_DATA_API_SECRET: 'market-secret',
        PAPER_BROKER_ACCOUNT_ID: 'account-123',
        PUBLIC_LABEL: 'visible',
      }),
    ).toEqual({
      APP_ENV: 'local',
      DATABASE_URL: '[REDACTED]',
      MARKET_DATA_WS_URL: '[REDACTED]',
      MARKET_DATA_API_KEY: '[REDACTED]',
      MARKET_DATA_API_SECRET: '[REDACTED]',
      PAPER_BROKER_ACCOUNT_ID: '[REDACTED]',
      PUBLIC_LABEL: 'visible',
    });
  });
});
