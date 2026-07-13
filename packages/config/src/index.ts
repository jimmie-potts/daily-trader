import { z } from 'zod';

import {
  BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
  MAX_LOOKBACK_BARS,
  MIN_LOOKBACK_BARS,
  createSignalConfiguration,
  type SignalConfiguration,
} from '@daily-trader/signals';

export const LOCAL_DATABASE_URL =
  'postgresql://daily_trader:daily_trader_local@127.0.0.1:5432/daily_trader';
export const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';
export const ALPACA_IEX_WEBSOCKET_URL = 'wss://stream.data.alpaca.markets/v2/iex';
export const ALPACA_PAPER_TRADING_API_URL = 'https://paper-api.alpaca.markets/v2';
export const MARKET_DATA_SYMBOLS = Object.freeze(['AAPL', 'SPY'] as const);
export const SIGNAL_SYMBOLS = MARKET_DATA_SYMBOLS;
export const PORTFOLIO_READ_RESOURCES = Object.freeze([
  'account',
  'positions',
  'orders',
  'fills',
] as const);

const PORTFOLIO_ENVIRONMENT_SETTINGS = Object.freeze([
  'PORTFOLIO_MODE',
  'PORTFOLIO_SYNC_INTERVAL_MS',
  'PORTFOLIO_REQUEST_TIMEOUT_MS',
  'PORTFOLIO_STALE_AFTER_MS',
  'PORTFOLIO_MAX_RESPONSE_BYTES',
  'PORTFOLIO_MAX_PAGES',
  'PORTFOLIO_ORDER_PAGE_SIZE',
  'PORTFOLIO_FILL_PAGE_SIZE',
  'PORTFOLIO_MAX_POSITIONS',
  'PORTFOLIO_MAX_ORDERS',
  'PORTFOLIO_MAX_FILLS_PER_SYNC',
  'PORTFOLIO_RETRY_MAX_ATTEMPTS',
  'PORTFOLIO_RETRY_BASE_DELAY_MS',
  'PORTFOLIO_RETRY_MAX_DELAY_MS',
  'PORTFOLIO_RETRY_JITTER_PERCENT',
  'PORTFOLIO_STATEMENT_TIMEOUT_MS',
  'PORTFOLIO_CLAIM_LEASE_MS',
  'PORTFOLIO_CLAIM_RENEW_INTERVAL_MS',
  'PORTFOLIO_SHUTDOWN_TIMEOUT_MS',
] as const);
const PORTFOLIO_ENVIRONMENT_SETTING_SET = new Set<string>(PORTFOLIO_ENVIRONMENT_SETTINGS);

const PAPER_BROKER_ENVIRONMENT_SETTINGS = Object.freeze([
  'PAPER_BROKER_BASE_URL',
  'PAPER_BROKER_API_KEY',
  'PAPER_BROKER_API_SECRET',
  'PAPER_BROKER_ACCOUNT_ID',
] as const);
const PAPER_BROKER_ENVIRONMENT_SETTING_SET = new Set<string>(PAPER_BROKER_ENVIRONMENT_SETTINGS);

const LIVE_BROKER_ENVIRONMENT_SETTINGS = Object.freeze([
  'LIVE_BROKER_BASE_URL',
  'LIVE_BROKER_API_KEY',
  'LIVE_BROKER_API_SECRET',
  'LIVE_BROKER_ACCOUNT_ID',
] as const);
const LIVE_BROKER_ENVIRONMENT_SETTING_SET = new Set<string>(LIVE_BROKER_ENVIRONMENT_SETTINGS);

const SIGNAL_ENVIRONMENT_SETTINGS = Object.freeze([
  'SIGNAL_MODE',
  'SIGNAL_CONFIGURATION_VERSION',
  'SIGNAL_DEFINITION',
  'SIGNAL_SYMBOLS',
  'SIGNAL_LOOKBACK_WINDOW',
  'SIGNAL_VOLUME_MULTIPLIER',
  'SIGNAL_JOURNAL_POLL_INTERVAL_MS',
  'SIGNAL_CLAIM_BATCH_SIZE',
  'SIGNAL_QUEUE_CAPACITY',
  'SIGNAL_RETRY_MAX_ATTEMPTS',
  'SIGNAL_RETRY_BASE_DELAY_MS',
  'SIGNAL_RETRY_MAX_DELAY_MS',
  'SIGNAL_RETRY_JITTER_PERCENT',
  'SIGNAL_BACKLOG_LIMIT',
  'SIGNAL_STATEMENT_TIMEOUT_MS',
  'SIGNAL_CLAIM_LEASE_MS',
  'SIGNAL_CLAIM_RENEW_INTERVAL_MS',
  'SIGNAL_SHUTDOWN_TIMEOUT_MS',
] as const);
const SIGNAL_ENVIRONMENT_SETTING_SET = new Set<string>(SIGNAL_ENVIRONMENT_SETTINGS);

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

const marketDataMode = z.preprocess(
  emptyStringToUndefined,
  z.enum(['disabled', 'paper']).default('disabled'),
);

const alpacaProvider = z.preprocess(
  emptyStringToUndefined,
  z.literal('alpaca', { error: 'must be alpaca' }).default('alpaca'),
);

const iexFeed = z.preprocess(
  emptyStringToUndefined,
  z.literal('iex', { error: 'must be iex' }).default('iex'),
);

const alpacaIexWebsocketUrl = z.preprocess(
  emptyStringToUndefined,
  z
    .literal(ALPACA_IEX_WEBSOCKET_URL, {
      error: 'must use the approved secure Alpaca IEX websocket endpoint',
    })
    .default(ALPACA_IEX_WEBSOCKET_URL),
);

const phaseTwoMarketDataSymbols = z.preprocess(
  emptyStringToUndefined,
  z.literal('AAPL,SPY', { error: 'must be exactly AAPL,SPY' }).default('AAPL,SPY'),
);

const signalMode = z.preprocess(
  emptyStringToUndefined,
  z.enum(['disabled', 'monitor']).default('disabled'),
);

const portfolioMode = z.preprocess(
  emptyStringToUndefined,
  z.enum(['disabled', 'paper_read_only']).default('disabled'),
);

const alpacaPaperTradingApiUrl = z.preprocess(
  emptyStringToUndefined,
  z
    .literal(ALPACA_PAPER_TRADING_API_URL, {
      error: 'must use the approved HTTPS Alpaca paper Trading API endpoint',
    })
    .default(ALPACA_PAPER_TRADING_API_URL),
);

const signalDefinition = z.preprocess(
  emptyStringToUndefined,
  z
    .literal(BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION, {
      error: `must be ${BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION}`,
    })
    .default(BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION),
);

const signalSymbols = z.preprocess(
  emptyStringToUndefined,
  z.literal('AAPL,SPY', { error: 'must be exactly AAPL,SPY' }).default('AAPL,SPY'),
);

const signalExactDecimal = z.preprocess(
  (value) => emptyStringToUndefined(value) ?? '1.5',
  z
    .string()
    .regex(
      /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u,
      'must be canonical exact-decimal text without exponent notation or trailing zeroes',
    ),
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
          error: 'must be paper in the current paper-only phase',
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
    MARKET_DATA_MODE: marketDataMode,
    MARKET_DATA_PROVIDER: alpacaProvider,
    MARKET_DATA_FEED: iexFeed,
    MARKET_DATA_WS_URL: alpacaIexWebsocketUrl,
    MARKET_DATA_API_KEY: optionalString,
    MARKET_DATA_API_SECRET: optionalString,
    MARKET_DATA_SYMBOLS: phaseTwoMarketDataSymbols,
    MARKET_DATA_CONNECTION_TIMEOUT_MS: integerString('10000', 100, 60_000),
    MARKET_DATA_INACTIVITY_TIMEOUT_MS: integerString('90000', 1_000, 300_000),
    MARKET_DATA_FRESHNESS_THRESHOLD_MS: integerString('120000', 60_000, 300_000),
    MARKET_DATA_SHUTDOWN_TIMEOUT_MS: integerString('10000', 100, 30_000),
    MARKET_DATA_QUEUE_CAPACITY: integerString('256', 1, 10_000),
    MARKET_DATA_RECONNECT_MAX_ATTEMPTS: integerString('5', 1, 20),
    MARKET_DATA_RECONNECT_BASE_DELAY_MS: integerString('500', 100, 30_000),
    MARKET_DATA_RECONNECT_MAX_DELAY_MS: integerString('30000', 100, 120_000),
    MARKET_DATA_RECONNECT_JITTER_PERCENT: integerString('20', 0, 50),
    SIGNAL_MODE: signalMode,
    SIGNAL_CONFIGURATION_VERSION: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u, 'must be a bounded version identifier')
        .default('phase3-v1'),
    ),
    SIGNAL_DEFINITION: signalDefinition,
    SIGNAL_SYMBOLS: signalSymbols,
    SIGNAL_LOOKBACK_WINDOW: integerString('20', MIN_LOOKBACK_BARS, MAX_LOOKBACK_BARS),
    SIGNAL_VOLUME_MULTIPLIER: signalExactDecimal,
    SIGNAL_JOURNAL_POLL_INTERVAL_MS: integerString('250', 25, 5_000),
    SIGNAL_CLAIM_BATCH_SIZE: integerString('50', 1, 500),
    SIGNAL_QUEUE_CAPACITY: integerString('1000', 1, 10_000),
    SIGNAL_RETRY_MAX_ATTEMPTS: integerString('5', 1, 20),
    SIGNAL_RETRY_BASE_DELAY_MS: integerString('100', 25, 30_000),
    SIGNAL_RETRY_MAX_DELAY_MS: integerString('5000', 25, 120_000),
    SIGNAL_RETRY_JITTER_PERCENT: integerString('20', 0, 50),
    SIGNAL_BACKLOG_LIMIT: integerString('10000', 1, 100_000),
    SIGNAL_STATEMENT_TIMEOUT_MS: integerString('10000', 100, 60_000),
    SIGNAL_CLAIM_LEASE_MS: integerString('30000', 5_000, 120_000),
    SIGNAL_CLAIM_RENEW_INTERVAL_MS: integerString('10000', 1_000, 40_000),
    SIGNAL_SHUTDOWN_TIMEOUT_MS: integerString('10000', 100, 30_000),
    PORTFOLIO_MODE: portfolioMode,
    PORTFOLIO_SYNC_INTERVAL_MS: integerString('30000', 5_000, 300_000),
    PORTFOLIO_REQUEST_TIMEOUT_MS: integerString('10000', 100, 60_000),
    PORTFOLIO_STALE_AFTER_MS: integerString('90000', 10_000, 900_000),
    PORTFOLIO_MAX_RESPONSE_BYTES: integerString('4194304', 1_024, 16_777_216),
    PORTFOLIO_MAX_PAGES: integerString('20', 1, 100),
    PORTFOLIO_ORDER_PAGE_SIZE: integerString('500', 1, 500),
    PORTFOLIO_FILL_PAGE_SIZE: integerString('100', 1, 100),
    PORTFOLIO_MAX_POSITIONS: integerString('1000', 1, 10_000),
    PORTFOLIO_MAX_ORDERS: integerString('5000', 1, 50_000),
    PORTFOLIO_MAX_FILLS_PER_SYNC: integerString('5000', 1, 50_000),
    PORTFOLIO_RETRY_MAX_ATTEMPTS: integerString('3', 1, 5),
    PORTFOLIO_RETRY_BASE_DELAY_MS: integerString('250', 100, 30_000),
    PORTFOLIO_RETRY_MAX_DELAY_MS: integerString('5000', 100, 120_000),
    PORTFOLIO_RETRY_JITTER_PERCENT: integerString('20', 0, 50),
    PORTFOLIO_STATEMENT_TIMEOUT_MS: integerString('10000', 100, 60_000),
    PORTFOLIO_CLAIM_LEASE_MS: integerString('60000', 5_000, 300_000),
    PORTFOLIO_CLAIM_RENEW_INTERVAL_MS: integerString('20000', 1_000, 100_000),
    PORTFOLIO_SHUTDOWN_TIMEOUT_MS: integerString('10000', 100, 30_000),
    DATABASE_URL: z.preprocess(
      (value) => emptyStringToUndefined(value) ?? LOCAL_DATABASE_URL,
      databaseUrl,
    ),
    DATABASE_CONNECTION_TIMEOUT_MS: timeoutMilliseconds,
    REDIS_URL: z.preprocess((value) => emptyStringToUndefined(value) ?? LOCAL_REDIS_URL, redisUrl),
    REDIS_CONNECTION_TIMEOUT_MS: timeoutMilliseconds,
    PAPER_BROKER_BASE_URL: alpacaPaperTradingApiUrl,
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
        message: 'must remain false while execution is out of scope',
        path: ['EXECUTION_ENABLED'],
      });
    }

    const marketDataKeyIsSet = environment.MARKET_DATA_API_KEY !== undefined;
    const marketDataSecretIsSet = environment.MARKET_DATA_API_SECRET !== undefined;

    if (marketDataKeyIsSet !== marketDataSecretIsSet) {
      context.addIssue({
        code: 'custom',
        message: 'API key and secret must be provided together',
        path: ['MARKET_DATA_API_KEY'],
      });
    } else if (environment.MARKET_DATA_MODE === 'paper' && !marketDataKeyIsSet) {
      context.addIssue({
        code: 'custom',
        message: 'API key and secret are required in paper mode',
        path: ['MARKET_DATA_API_KEY'],
      });
    }

    if (
      environment.MARKET_DATA_CONNECTION_TIMEOUT_MS >= environment.MARKET_DATA_INACTIVITY_TIMEOUT_MS
    ) {
      context.addIssue({
        code: 'custom',
        message: 'must be less than MARKET_DATA_INACTIVITY_TIMEOUT_MS',
        path: ['MARKET_DATA_CONNECTION_TIMEOUT_MS'],
      });
    }

    if (
      environment.MARKET_DATA_RECONNECT_BASE_DELAY_MS >
      environment.MARKET_DATA_RECONNECT_MAX_DELAY_MS
    ) {
      context.addIssue({
        code: 'custom',
        message: 'must be less than or equal to MARKET_DATA_RECONNECT_MAX_DELAY_MS',
        path: ['MARKET_DATA_RECONNECT_BASE_DELAY_MS'],
      });
    }

    if (environment.SIGNAL_RETRY_BASE_DELAY_MS > environment.SIGNAL_RETRY_MAX_DELAY_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must be less than or equal to SIGNAL_RETRY_MAX_DELAY_MS',
        path: ['SIGNAL_RETRY_BASE_DELAY_MS'],
      });
    }

    if (environment.SIGNAL_CLAIM_BATCH_SIZE > environment.SIGNAL_QUEUE_CAPACITY) {
      context.addIssue({
        code: 'custom',
        message: 'must be less than or equal to SIGNAL_QUEUE_CAPACITY',
        path: ['SIGNAL_CLAIM_BATCH_SIZE'],
      });
    }

    if (environment.SIGNAL_QUEUE_CAPACITY > environment.SIGNAL_BACKLOG_LIMIT) {
      context.addIssue({
        code: 'custom',
        message: 'must be less than or equal to SIGNAL_BACKLOG_LIMIT',
        path: ['SIGNAL_QUEUE_CAPACITY'],
      });
    }

    if (environment.SIGNAL_CLAIM_RENEW_INTERVAL_MS * 3 > environment.SIGNAL_CLAIM_LEASE_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must be no more than one third of SIGNAL_CLAIM_LEASE_MS',
        path: ['SIGNAL_CLAIM_RENEW_INTERVAL_MS'],
      });
    }

    const maximumSignalAttemptMilliseconds =
      environment.SIGNAL_RETRY_MAX_DELAY_MS * (100 + environment.SIGNAL_RETRY_JITTER_PERCENT) +
      environment.SIGNAL_STATEMENT_TIMEOUT_MS * 100;
    if (maximumSignalAttemptMilliseconds > environment.SIGNAL_CLAIM_LEASE_MS * 100) {
      context.addIssue({
        code: 'custom',
        message:
          'statement timeout plus jittered retry delay must fit within SIGNAL_CLAIM_LEASE_MS',
        path: ['SIGNAL_CLAIM_LEASE_MS'],
      });
    }

    const maximumReconnectDelayWithJitter =
      environment.MARKET_DATA_RECONNECT_MAX_DELAY_MS *
      (100 + environment.MARKET_DATA_RECONNECT_JITTER_PERCENT);
    if (maximumReconnectDelayWithJitter > environment.MARKET_DATA_INACTIVITY_TIMEOUT_MS * 100) {
      context.addIssue({
        code: 'custom',
        message: 'including jitter must be less than or equal to MARKET_DATA_INACTIVITY_TIMEOUT_MS',
        path: ['MARKET_DATA_RECONNECT_MAX_DELAY_MS'],
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
    } else if (environment.PORTFOLIO_MODE === 'paper_read_only' && !paperKeyIsSet) {
      context.addIssue({
        code: 'custom',
        message: 'API key and secret are required in paper_read_only mode',
        path: ['PAPER_BROKER_API_KEY'],
      });
    }

    if (
      environment.PORTFOLIO_MODE === 'paper_read_only' &&
      environment.PAPER_BROKER_ACCOUNT_ID === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'expected account ID is required in paper_read_only mode',
        path: ['PAPER_BROKER_ACCOUNT_ID'],
      });
    }

    if (environment.PORTFOLIO_RETRY_BASE_DELAY_MS > environment.PORTFOLIO_RETRY_MAX_DELAY_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must be less than or equal to PORTFOLIO_RETRY_MAX_DELAY_MS',
        path: ['PORTFOLIO_RETRY_BASE_DELAY_MS'],
      });
    }

    if (environment.PORTFOLIO_STALE_AFTER_MS < environment.PORTFOLIO_SYNC_INTERVAL_MS * 2) {
      context.addIssue({
        code: 'custom',
        message: 'must be at least twice PORTFOLIO_SYNC_INTERVAL_MS',
        path: ['PORTFOLIO_STALE_AFTER_MS'],
      });
    }

    if (environment.PORTFOLIO_CLAIM_RENEW_INTERVAL_MS * 3 > environment.PORTFOLIO_CLAIM_LEASE_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must be no more than one third of PORTFOLIO_CLAIM_LEASE_MS',
        path: ['PORTFOLIO_CLAIM_RENEW_INTERVAL_MS'],
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
export type MarketDataMode = 'disabled' | 'paper';
export type MarketDataProvider = 'alpaca';
export type MarketDataFeed = 'iex';
export type MarketDataSymbol = (typeof MARKET_DATA_SYMBOLS)[number];
export type SignalMode = 'disabled' | 'monitor';
export type PortfolioMode = 'disabled' | 'paper_read_only';

export interface MarketDataConfiguration {
  readonly mode: MarketDataMode;
  readonly provider: MarketDataProvider;
  readonly feed: MarketDataFeed;
  readonly websocketUrl: typeof ALPACA_IEX_WEBSOCKET_URL;
  readonly apiKey: string | undefined;
  readonly apiSecret: string | undefined;
  readonly symbols: typeof MARKET_DATA_SYMBOLS;
  readonly connectionTimeoutMs: number;
  readonly inactivityTimeoutMs: number;
  readonly freshnessThresholdMs: number;
  readonly shutdownTimeoutMs: number;
  readonly queueCapacity: number;
  readonly reconnect: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitterPercent: number;
  };
}

export interface ProviderConfiguration {
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly apiSecret: string | undefined;
  readonly accountId: string | undefined;
}

export interface SignalOperationalConfiguration {
  readonly journalPollIntervalMs: number;
  readonly claimBatchSize: number;
  readonly queueCapacity: number;
  readonly retry: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitterPercent: number;
  };
  readonly backlogLimit: number;
  readonly statementTimeoutMs: number;
  readonly claimLeaseMs: number;
  readonly claimRenewIntervalMs: number;
  readonly shutdownTimeoutMs: number;
}

export interface SignalRuntimeConfiguration {
  readonly mode: SignalMode;
  readonly configuration: SignalConfiguration;
  readonly operational: SignalOperationalConfiguration;
}

export interface PortfolioOperationalConfiguration {
  readonly syncIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly staleAfterMs: number;
  readonly maxResponseBytes: number;
  readonly maxPages: number;
  readonly orderPageSize: number;
  readonly fillPageSize: number;
  readonly maxPositions: number;
  readonly maxOrders: number;
  readonly maxFillsPerSync: number;
  readonly retry: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitterPercent: number;
  };
  readonly statementTimeoutMs: number;
  readonly claimLeaseMs: number;
  readonly claimRenewIntervalMs: number;
  readonly shutdownTimeoutMs: number;
}

export interface PortfolioRuntimeConfiguration {
  readonly mode: PortfolioMode;
  readonly provider: 'alpaca';
  readonly readResources: typeof PORTFOLIO_READ_RESOURCES;
  readonly baseUrl: typeof ALPACA_PAPER_TRADING_API_URL;
  readonly apiKey: string | undefined;
  readonly apiSecret: string | undefined;
  readonly expectedAccountId: string | undefined;
  readonly operational: PortfolioOperationalConfiguration;
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
  readonly marketData: MarketDataConfiguration;
  readonly signal: SignalRuntimeConfiguration;
  readonly portfolio: PortfolioRuntimeConfiguration;
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
  const unknownSignalSettings = Object.keys(environment)
    .filter((name) => name.startsWith('SIGNAL_') && !SIGNAL_ENVIRONMENT_SETTING_SET.has(name))
    .sort();
  if (unknownSignalSettings.length > 0) {
    throw new ConfigurationError(
      unknownSignalSettings.map((setting) => ({
        setting,
        message: 'is not an approved Phase 3 signal setting',
      })),
    );
  }

  const unknownPortfolioSettings = Object.keys(environment)
    .filter((name) => name.startsWith('PORTFOLIO_') && !PORTFOLIO_ENVIRONMENT_SETTING_SET.has(name))
    .sort();
  if (unknownPortfolioSettings.length > 0) {
    throw new ConfigurationError(
      unknownPortfolioSettings.map((setting) => ({
        setting,
        message: 'is not an approved Phase 4 portfolio setting',
      })),
    );
  }

  const unknownPaperBrokerSettings = Object.keys(environment)
    .filter(
      (name) => name.startsWith('PAPER_BROKER_') && !PAPER_BROKER_ENVIRONMENT_SETTING_SET.has(name),
    )
    .sort();
  if (unknownPaperBrokerSettings.length > 0) {
    throw new ConfigurationError(
      unknownPaperBrokerSettings.map((setting) => ({
        setting,
        message: 'is not an approved Phase 4 paper-broker setting',
      })),
    );
  }

  const unknownLiveBrokerSettings = Object.keys(environment)
    .filter(
      (name) => name.startsWith('LIVE_BROKER_') && !LIVE_BROKER_ENVIRONMENT_SETTING_SET.has(name),
    )
    .sort();
  if (unknownLiveBrokerSettings.length > 0) {
    throw new ConfigurationError(
      unknownLiveBrokerSettings.map((setting) => ({
        setting,
        message: 'is not an approved setting in the current paper-only phase',
      })),
    );
  }

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

  let signalConfiguration: SignalConfiguration;
  try {
    signalConfiguration = createSignalConfiguration({
      configurationVersion: parsed.SIGNAL_CONFIGURATION_VERSION,
      lookbackBars: parsed.SIGNAL_LOOKBACK_WINDOW,
      volumeMultiplier: parsed.SIGNAL_VOLUME_MULTIPLIER,
      freshnessThresholdMs: parsed.MARKET_DATA_FRESHNESS_THRESHOLD_MS,
    });
  } catch {
    throw new ConfigurationError([
      {
        setting: 'SIGNAL_VOLUME_MULTIPLIER',
        message: 'must satisfy the approved exact-decimal signal arithmetic policy',
      },
    ]);
  }

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
    marketData: Object.freeze({
      mode: parsed.MARKET_DATA_MODE,
      provider: parsed.MARKET_DATA_PROVIDER,
      feed: parsed.MARKET_DATA_FEED,
      websocketUrl: parsed.MARKET_DATA_WS_URL,
      apiKey: parsed.MARKET_DATA_API_KEY,
      apiSecret: parsed.MARKET_DATA_API_SECRET,
      symbols: MARKET_DATA_SYMBOLS,
      connectionTimeoutMs: parsed.MARKET_DATA_CONNECTION_TIMEOUT_MS,
      inactivityTimeoutMs: parsed.MARKET_DATA_INACTIVITY_TIMEOUT_MS,
      freshnessThresholdMs: parsed.MARKET_DATA_FRESHNESS_THRESHOLD_MS,
      shutdownTimeoutMs: parsed.MARKET_DATA_SHUTDOWN_TIMEOUT_MS,
      queueCapacity: parsed.MARKET_DATA_QUEUE_CAPACITY,
      reconnect: Object.freeze({
        maxAttempts: parsed.MARKET_DATA_RECONNECT_MAX_ATTEMPTS,
        baseDelayMs: parsed.MARKET_DATA_RECONNECT_BASE_DELAY_MS,
        maxDelayMs: parsed.MARKET_DATA_RECONNECT_MAX_DELAY_MS,
        jitterPercent: parsed.MARKET_DATA_RECONNECT_JITTER_PERCENT,
      }),
    }),
    signal: Object.freeze({
      mode: parsed.SIGNAL_MODE,
      configuration: signalConfiguration,
      operational: Object.freeze({
        journalPollIntervalMs: parsed.SIGNAL_JOURNAL_POLL_INTERVAL_MS,
        claimBatchSize: parsed.SIGNAL_CLAIM_BATCH_SIZE,
        queueCapacity: parsed.SIGNAL_QUEUE_CAPACITY,
        retry: Object.freeze({
          maxAttempts: parsed.SIGNAL_RETRY_MAX_ATTEMPTS,
          baseDelayMs: parsed.SIGNAL_RETRY_BASE_DELAY_MS,
          maxDelayMs: parsed.SIGNAL_RETRY_MAX_DELAY_MS,
          jitterPercent: parsed.SIGNAL_RETRY_JITTER_PERCENT,
        }),
        backlogLimit: parsed.SIGNAL_BACKLOG_LIMIT,
        statementTimeoutMs: parsed.SIGNAL_STATEMENT_TIMEOUT_MS,
        claimLeaseMs: parsed.SIGNAL_CLAIM_LEASE_MS,
        claimRenewIntervalMs: parsed.SIGNAL_CLAIM_RENEW_INTERVAL_MS,
        shutdownTimeoutMs: parsed.SIGNAL_SHUTDOWN_TIMEOUT_MS,
      }),
    }),
    portfolio: Object.freeze({
      mode: parsed.PORTFOLIO_MODE,
      provider: 'alpaca' as const,
      readResources: PORTFOLIO_READ_RESOURCES,
      baseUrl: parsed.PAPER_BROKER_BASE_URL,
      apiKey: parsed.PAPER_BROKER_API_KEY,
      apiSecret: parsed.PAPER_BROKER_API_SECRET,
      expectedAccountId: parsed.PAPER_BROKER_ACCOUNT_ID,
      operational: Object.freeze({
        syncIntervalMs: parsed.PORTFOLIO_SYNC_INTERVAL_MS,
        requestTimeoutMs: parsed.PORTFOLIO_REQUEST_TIMEOUT_MS,
        staleAfterMs: parsed.PORTFOLIO_STALE_AFTER_MS,
        maxResponseBytes: parsed.PORTFOLIO_MAX_RESPONSE_BYTES,
        maxPages: parsed.PORTFOLIO_MAX_PAGES,
        orderPageSize: parsed.PORTFOLIO_ORDER_PAGE_SIZE,
        fillPageSize: parsed.PORTFOLIO_FILL_PAGE_SIZE,
        maxPositions: parsed.PORTFOLIO_MAX_POSITIONS,
        maxOrders: parsed.PORTFOLIO_MAX_ORDERS,
        maxFillsPerSync: parsed.PORTFOLIO_MAX_FILLS_PER_SYNC,
        retry: Object.freeze({
          maxAttempts: parsed.PORTFOLIO_RETRY_MAX_ATTEMPTS,
          baseDelayMs: parsed.PORTFOLIO_RETRY_BASE_DELAY_MS,
          maxDelayMs: parsed.PORTFOLIO_RETRY_MAX_DELAY_MS,
          jitterPercent: parsed.PORTFOLIO_RETRY_JITTER_PERCENT,
        }),
        statementTimeoutMs: parsed.PORTFOLIO_STATEMENT_TIMEOUT_MS,
        claimLeaseMs: parsed.PORTFOLIO_CLAIM_LEASE_MS,
        claimRenewIntervalMs: parsed.PORTFOLIO_CLAIM_RENEW_INTERVAL_MS,
        shutdownTimeoutMs: parsed.PORTFOLIO_SHUTDOWN_TIMEOUT_MS,
      }),
    }),
    trading: Object.freeze({
      brokerMode: parsed.BROKER_MODE,
      // The schema rejects true, so narrowing here records the paper-only invariant.
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
  readonly marketData: {
    readonly mode: MarketDataMode;
    readonly provider: MarketDataProvider;
    readonly feed: MarketDataFeed;
    readonly symbols: typeof MARKET_DATA_SYMBOLS;
    readonly credentialsConfigured: boolean;
    readonly connectionTimeoutMs: number;
    readonly inactivityTimeoutMs: number;
    readonly freshnessThresholdMs: number;
    readonly shutdownTimeoutMs: number;
    readonly queueCapacity: number;
    readonly reconnect: {
      readonly maxAttempts: number;
      readonly baseDelayMs: number;
      readonly maxDelayMs: number;
      readonly jitterPercent: number;
    };
  };
  readonly signal: {
    readonly mode: SignalMode;
    readonly signalDefinitionVersion: string;
    readonly configurationVersion: string;
    readonly configurationHash: string;
    readonly scope: SignalConfiguration['scope'];
    readonly lookbackBars: number;
    readonly volumeMultiplier: string;
    readonly operational: SignalOperationalConfiguration;
  };
  readonly portfolio: {
    readonly mode: PortfolioMode;
    readonly provider: 'alpaca';
    readonly readResources: typeof PORTFOLIO_READ_RESOURCES;
    readonly credentialsConfigured: boolean;
    readonly expectedAccountConfigured: boolean;
    readonly operational: PortfolioOperationalConfiguration;
  };
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
    marketData: Object.freeze({
      mode: config.marketData.mode,
      provider: config.marketData.provider,
      feed: config.marketData.feed,
      symbols: config.marketData.symbols,
      credentialsConfigured:
        config.marketData.apiKey !== undefined && config.marketData.apiSecret !== undefined,
      connectionTimeoutMs: config.marketData.connectionTimeoutMs,
      inactivityTimeoutMs: config.marketData.inactivityTimeoutMs,
      freshnessThresholdMs: config.marketData.freshnessThresholdMs,
      shutdownTimeoutMs: config.marketData.shutdownTimeoutMs,
      queueCapacity: config.marketData.queueCapacity,
      reconnect: Object.freeze({ ...config.marketData.reconnect }),
    }),
    signal: Object.freeze({
      mode: config.signal.mode,
      signalDefinitionVersion: config.signal.configuration.signalDefinitionVersion,
      configurationVersion: config.signal.configuration.configurationVersion,
      configurationHash: config.signal.configuration.configurationHash,
      scope: config.signal.configuration.scope,
      lookbackBars: config.signal.configuration.lookbackBars,
      volumeMultiplier: config.signal.configuration.volumeMultiplier,
      operational: Object.freeze({
        ...config.signal.operational,
        retry: Object.freeze({ ...config.signal.operational.retry }),
      }),
    }),
    portfolio: Object.freeze({
      mode: config.portfolio.mode,
      provider: config.portfolio.provider,
      readResources: config.portfolio.readResources,
      credentialsConfigured:
        config.portfolio.apiKey !== undefined && config.portfolio.apiSecret !== undefined,
      expectedAccountConfigured: config.portfolio.expectedAccountId !== undefined,
      operational: Object.freeze({
        ...config.portfolio.operational,
        retry: Object.freeze({ ...config.portfolio.operational.retry }),
      }),
    }),
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
