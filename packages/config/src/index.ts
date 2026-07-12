import { z } from 'zod';

export const LOCAL_DATABASE_URL =
  'postgresql://daily_trader:daily_trader_local@127.0.0.1:5432/daily_trader';
export const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const optionalString = z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional());

const optionalUrl = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().url('must be a valid URL').optional(),
);

const timeoutMilliseconds = z.preprocess(
  (value) => emptyStringToUndefined(value) ?? '5000',
  z
    .string()
    .regex(/^\d+$/, 'must be an integer number of milliseconds')
    .transform(Number)
    .pipe(z.number().int().min(100).max(60_000)),
);

const integerString = (defaultValue: string, minimum: number, maximum: number): z.ZodType<number> =>
  z.preprocess(
    (value) => emptyStringToUndefined(value) ?? defaultValue,
    z
      .string()
      .regex(/^\d+$/, 'must be an integer')
      .transform(Number)
      .pipe(z.number().int().min(minimum).max(maximum)),
  );

const booleanString = z
  .enum(['true', 'false'], {
    error: 'must be either true or false',
  })
  .transform((value) => value === 'true');

const hasScheme = (value: string, schemes: readonly string[]): boolean => {
  try {
    return schemes.includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const databaseUrl = z
  .string()
  .trim()
  .url('must be a valid URL')
  .refine(
    (value) => hasScheme(value, ['postgres:', 'postgresql:']),
    'must use the postgres or postgresql scheme',
  );

const redisUrl = z
  .string()
  .trim()
  .url('must be a valid URL')
  .refine(
    (value) => hasScheme(value, ['redis:', 'rediss:']),
    'must use the redis or rediss scheme',
  );

const environmentSchema = z
  .object({
    APP_ENV: z.preprocess(
      emptyStringToUndefined,
      z.enum(['local', 'test', 'staging', 'production']).default('local'),
    ),
    BROKER_MODE: z.preprocess(
      emptyStringToUndefined,
      z
        .literal('paper', {
          error: 'must be paper during Phase 1',
        })
        .default('paper'),
    ),
    EXECUTION_ENABLED: z.preprocess(
      (value) => emptyStringToUndefined(value) ?? 'false',
      booleanString,
    ),
    LOG_LEVEL: z.preprocess(
      emptyStringToUndefined,
      z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    ),
    TELEMETRY_EXPORTER: z.preprocess(
      emptyStringToUndefined,
      z.enum(['none', 'console']).default('none'),
    ),
    API_HOST: z.preprocess(
      emptyStringToUndefined,
      z.enum(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1'),
    ),
    API_PORT: integerString('3001', 1, 65_535),
    WORKER_HEARTBEAT_INTERVAL_MS: integerString('30000', 1_000, 300_000),
    DATABASE_URL: z.preprocess(
      (value) => emptyStringToUndefined(value) ?? LOCAL_DATABASE_URL,
      databaseUrl,
    ),
    DATABASE_CONNECTION_TIMEOUT_MS: timeoutMilliseconds,
    REDIS_URL: z.preprocess((value) => emptyStringToUndefined(value) ?? LOCAL_REDIS_URL, redisUrl),
    REDIS_CONNECTION_TIMEOUT_MS: timeoutMilliseconds,
    PAPER_BROKER_BASE_URL: optionalUrl,
    PAPER_BROKER_API_KEY: optionalString,
    PAPER_BROKER_API_SECRET: optionalString,
    PAPER_BROKER_ACCOUNT_ID: optionalString,
    LIVE_BROKER_BASE_URL: optionalUrl,
    LIVE_BROKER_API_KEY: optionalString,
    LIVE_BROKER_API_SECRET: optionalString,
    LIVE_BROKER_ACCOUNT_ID: optionalString,
  })
  .superRefine((environment, context) => {
    if (environment.EXECUTION_ENABLED) {
      context.addIssue({
        code: 'custom',
        message: 'must remain false during Phase 1',
        path: ['EXECUTION_ENABLED'],
      });
    }

    const paperKeyIsSet = environment.PAPER_BROKER_API_KEY !== undefined;
    const paperSecretIsSet = environment.PAPER_BROKER_API_SECRET !== undefined;

    if (paperKeyIsSet !== paperSecretIsSet) {
      context.addIssue({
        code: 'custom',
        message: 'API key and secret must be provided together',
        path: ['PAPER_BROKER_API_KEY'],
      });
    }

    const liveSettingNames = [
      'LIVE_BROKER_BASE_URL',
      'LIVE_BROKER_API_KEY',
      'LIVE_BROKER_API_SECRET',
      'LIVE_BROKER_ACCOUNT_ID',
    ] as const;

    for (const settingName of liveSettingNames) {
      if (environment[settingName] !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'is reserved for a future live-execution phase and must be unset',
          path: [settingName],
        });
      }
    }
  });

export type EnvironmentMap = Readonly<Record<string, string | undefined>>;
export type AppEnvironment = 'local' | 'test' | 'staging' | 'production';

export interface ProviderConfiguration {
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly apiSecret: string | undefined;
  readonly accountId: string | undefined;
}

export interface ApplicationConfig {
  readonly environment: AppEnvironment;
  readonly runtime: {
    readonly logLevel: 'debug' | 'error' | 'info' | 'warn';
    readonly telemetryExporter: 'console' | 'none';
  };
  readonly api: {
    readonly host: '127.0.0.1' | 'localhost' | '::1';
    readonly port: number;
  };
  readonly worker: {
    readonly heartbeatIntervalMs: number;
  };
  readonly trading: {
    readonly brokerMode: 'paper';
    readonly executionEnabled: false;
  };
  readonly services: {
    readonly database: {
      readonly url: string;
      readonly connectionTimeoutMs: number;
    };
    readonly redis: {
      readonly url: string;
      readonly connectionTimeoutMs: number;
    };
  };
  readonly providers: {
    readonly paperBroker: ProviderConfiguration;
    readonly liveBroker: ProviderConfiguration;
  };
}

export interface ConfigurationIssue {
  readonly setting: string;
  readonly message: string;
}

export class ConfigurationError extends Error {
  readonly issues: readonly ConfigurationIssue[];

  constructor(issues: readonly ConfigurationIssue[]) {
    super(
      `Invalid application configuration:\n${issues
        .map((issue) => `- ${issue.setting}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

/** Loads local overrides when present; an absent file keeps process environment defaults. */
export function loadOptionalEnvironmentFile(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw new ConfigurationError([
      { setting: 'environment file', message: `could not be loaded from ${path}` },
    ]);
  }
}

const freezeProvider = (provider: ProviderConfiguration): ProviderConfiguration =>
  Object.freeze(provider);

/**
 * Parses process configuration before an entry point opens listeners or connects
 * to external services. Errors mention setting names, never supplied values.
 */
export function loadConfig(environment: EnvironmentMap = process.env): ApplicationConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => ({
        setting: issue.path.join('.') || 'environment',
        message: issue.message,
      })),
    );
  }

  const parsed = result.data;
  const usesLocalDefaults = parsed.APP_ENV === 'local' || parsed.APP_ENV === 'test';

  if (!usesLocalDefaults) {
    const missingServiceSettings: ConfigurationIssue[] = [];

    if (emptyStringToUndefined(environment.DATABASE_URL) === undefined) {
      missingServiceSettings.push({
        setting: 'DATABASE_URL',
        message: 'must be set explicitly outside local and test environments',
      });
    }
    if (emptyStringToUndefined(environment.REDIS_URL) === undefined) {
      missingServiceSettings.push({
        setting: 'REDIS_URL',
        message: 'must be set explicitly outside local and test environments',
      });
    }

    if (missingServiceSettings.length > 0) {
      throw new ConfigurationError(missingServiceSettings);
    }
  }

  const config: ApplicationConfig = {
    environment: parsed.APP_ENV,
    runtime: Object.freeze({
      logLevel: parsed.LOG_LEVEL,
      telemetryExporter: parsed.TELEMETRY_EXPORTER,
    }),
    api: Object.freeze({
      host: parsed.API_HOST,
      port: parsed.API_PORT,
    }),
    worker: Object.freeze({
      heartbeatIntervalMs: parsed.WORKER_HEARTBEAT_INTERVAL_MS,
    }),
    trading: Object.freeze({
      brokerMode: parsed.BROKER_MODE,
      // The schema rejects true, so narrowing here records the Phase 1 invariant.
      executionEnabled: parsed.EXECUTION_ENABLED as false,
    }),
    services: Object.freeze({
      database: Object.freeze({
        url: parsed.DATABASE_URL,
        connectionTimeoutMs: parsed.DATABASE_CONNECTION_TIMEOUT_MS,
      }),
      redis: Object.freeze({
        url: parsed.REDIS_URL,
        connectionTimeoutMs: parsed.REDIS_CONNECTION_TIMEOUT_MS,
      }),
    }),
    providers: Object.freeze({
      paperBroker: freezeProvider({
        baseUrl: parsed.PAPER_BROKER_BASE_URL,
        apiKey: parsed.PAPER_BROKER_API_KEY,
        apiSecret: parsed.PAPER_BROKER_API_SECRET,
        accountId: parsed.PAPER_BROKER_ACCOUNT_ID,
      }),
      liveBroker: freezeProvider({
        baseUrl: undefined,
        apiKey: undefined,
        apiSecret: undefined,
        accountId: undefined,
      }),
    }),
  };

  return Object.freeze(config);
}

interface SafeEndpointMetadata {
  readonly protocol: string;
  readonly host: string;
  readonly port: string;
}

const safeEndpointMetadata = (value: string): SafeEndpointMetadata => {
  const url = new URL(value);
  return Object.freeze({
    protocol: url.protocol.slice(0, -1),
    host: url.hostname,
    port: url.port,
  });
};

export interface SafeConfigDiagnostics {
  readonly environment: AppEnvironment;
  readonly logLevel: 'debug' | 'error' | 'info' | 'warn';
  readonly telemetryExporter: 'console' | 'none';
  readonly brokerMode: 'paper';
  readonly executionEnabled: false;
  readonly services: {
    readonly database: SafeEndpointMetadata;
    readonly redis: SafeEndpointMetadata;
  };
  readonly paperBroker: {
    readonly endpointConfigured: boolean;
    readonly credentialsConfigured: boolean;
    readonly accountConfigured: boolean;
  };
  readonly liveBrokerConfigured: false;
}

/** Returns operational metadata without credentials, URLs, or account IDs. */
export function getSafeConfigDiagnostics(config: ApplicationConfig): SafeConfigDiagnostics {
  return Object.freeze({
    environment: config.environment,
    logLevel: config.runtime.logLevel,
    telemetryExporter: config.runtime.telemetryExporter,
    brokerMode: config.trading.brokerMode,
    executionEnabled: config.trading.executionEnabled,
    services: Object.freeze({
      database: safeEndpointMetadata(config.services.database.url),
      redis: safeEndpointMetadata(config.services.redis.url),
    }),
    paperBroker: Object.freeze({
      endpointConfigured: config.providers.paperBroker.baseUrl !== undefined,
      credentialsConfigured:
        config.providers.paperBroker.apiKey !== undefined &&
        config.providers.paperBroker.apiSecret !== undefined,
      accountConfigured: config.providers.paperBroker.accountId !== undefined,
    }),
    liveBrokerConfigured: false,
  });
}

const sensitiveSettingName = /(ACCOUNT|CERT|CREDENTIAL|DSN|KEY|PASSWORD|SECRET|TOKEN|URI|URL)/i;

/** Redacts environment-like objects before they are included in diagnostics. */
export function redactEnvironment(
  environment: EnvironmentMap,
): Readonly<Record<string, string | undefined>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(environment).map(([name, value]) => [
        name,
        sensitiveSettingName.test(name) && value !== undefined ? '[REDACTED]' : value,
      ]),
    ),
  );
}
