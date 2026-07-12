import pg from 'pg';
import { createClient } from 'redis';

import {
  ConfigurationError,
  getSafeConfigDiagnostics,
  loadConfig,
  loadOptionalEnvironmentFile,
} from '@daily-trader/config';

loadOptionalEnvironmentFile();

const { Client } = pg;

const writeEvent = (event) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const writeFailure = (event) => {
  process.stderr.write(`${JSON.stringify(event)}\n`);
};

const safeErrorCode = (error) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_-]{1,64}$/i.test(error.code)
  ) {
    return error.code;
  }

  return 'CONNECTION_CHECK_FAILED';
};

const withTimeout = async (operation, timeoutMs, service) => {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`${service} check exceeded its configured timeout`);
      error.code = 'CHECK_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    clearTimeout(timeout);
  }
};

const checkTimescale = async (configuration) => {
  const startedAt = performance.now();
  const client = new Client({
    application_name: 'daily-trader-service-check',
    connectionString: configuration.url,
    connectionTimeoutMillis: configuration.connectionTimeoutMs,
    query_timeout: configuration.connectionTimeoutMs,
    statement_timeout: configuration.connectionTimeoutMs,
  });

  try {
    const result = await withTimeout(
      async () => {
        await client.connect();
        return client.query("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'");
      },
      configuration.connectionTimeoutMs,
      'timescaledb',
    );
    const extensionVersion = result.rows[0]?.extversion;

    if (typeof extensionVersion !== 'string' || extensionVersion.length === 0) {
      const error = new Error('TimescaleDB extension is unavailable');
      error.code = 'TIMESCALE_EXTENSION_MISSING';
      throw error;
    }

    return {
      durationMs: Math.round(performance.now() - startedAt),
      extensionVersion: /^[0-9A-Za-z.+-]+$/.test(extensionVersion) ? extensionVersion : 'present',
      service: 'timescaledb',
      status: 'healthy',
    };
  } finally {
    await client.end().catch(() => undefined);
  }
};

const checkRedis = async (configuration) => {
  const startedAt = performance.now();
  const client = createClient({
    socket: {
      connectTimeout: configuration.connectionTimeoutMs,
      reconnectStrategy: false,
    },
    url: configuration.url,
  });

  // node-redis requires an error listener. Error details are deliberately not
  // forwarded because connection URLs can contain credentials.
  client.on('error', () => undefined);

  try {
    const response = await withTimeout(
      async () => {
        await client.connect();
        return client.ping();
      },
      configuration.connectionTimeoutMs,
      'redis',
    );

    if (response !== 'PONG') {
      const error = new Error('Redis returned an unexpected PING response');
      error.code = 'REDIS_PING_FAILED';
      throw error;
    }

    return {
      durationMs: Math.round(performance.now() - startedAt),
      response: 'PONG',
      service: 'redis',
      status: 'healthy',
    };
  } finally {
    if (client.isOpen) {
      client.destroy();
    }
  }
};

let config;

try {
  config = loadConfig();
  writeEvent({
    event: 'configuration.loaded',
    ...getSafeConfigDiagnostics(config),
  });
} catch (error) {
  if (error instanceof ConfigurationError) {
    writeFailure({
      event: 'configuration.invalid',
      issues: error.issues,
      status: 'failed',
    });
  } else {
    writeFailure({
      code: 'CONFIGURATION_LOAD_FAILED',
      event: 'configuration.invalid',
      status: 'failed',
    });
  }
  process.exitCode = 1;
}

if (config !== undefined) {
  const checks = [
    ['timescaledb', () => checkTimescale(config.services.database)],
    ['redis', () => checkRedis(config.services.redis)],
  ];
  const results = await Promise.allSettled(checks.map(([, check]) => check()));

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      writeEvent({ event: 'service.check', ...result.value });
      return;
    }

    writeFailure({
      code: safeErrorCode(result.reason),
      event: 'service.check',
      service: checks[index][0],
      status: 'failed',
    });
    process.exitCode = 1;
  });
}
