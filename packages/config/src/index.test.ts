import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  LOCAL_DATABASE_URL,
  LOCAL_REDIS_URL,
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
      PAPER_BROKER_BASE_URL: 'https://paper.example.invalid',
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
    expect(config.providers.paperBroker.apiKey).toBe('paper-key-value');
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
    ['EXECUTION_ENABLED', 'true', 'must remain false during Phase 1'],
    ['BROKER_MODE', 'live', 'must be paper during Phase 1'],
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

  it('keeps live settings separate and rejects them during Phase 1', () => {
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
      'paper-key',
      'paper-secret',
      'account-98765',
    ];
    const config = loadConfig({
      DATABASE_URL: 'postgresql://daily_trader:database-password@db.local:5432/daily_trader',
      REDIS_URL: 'redis://default:redis-password@cache.local:6379',
      PAPER_BROKER_BASE_URL: 'https://paper.example.invalid/path?token=private',
      PAPER_BROKER_API_KEY: 'paper-key',
      PAPER_BROKER_API_SECRET: 'paper-secret',
      PAPER_BROKER_ACCOUNT_ID: 'account-98765',
    });

    const serializedDiagnostics = JSON.stringify(getSafeConfigDiagnostics(config));

    expect(serializedDiagnostics).toContain('"environment":"local"');
    expect(serializedDiagnostics).toContain('"host":"db.local"');
    expect(serializedDiagnostics).toContain('"credentialsConfigured":true');
    for (const sensitiveValue of sensitiveValues) {
      expect(serializedDiagnostics).not.toContain(sensitiveValue);
    }
  });

  it('redacts credential-like environment fields', () => {
    expect(
      redactEnvironment({
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://user:secret@localhost/database',
        PAPER_BROKER_ACCOUNT_ID: 'account-123',
        PUBLIC_LABEL: 'visible',
      }),
    ).toEqual({
      APP_ENV: 'local',
      DATABASE_URL: '[REDACTED]',
      PAPER_BROKER_ACCOUNT_ID: '[REDACTED]',
      PUBLIC_LABEL: 'visible',
    });
  });
});
