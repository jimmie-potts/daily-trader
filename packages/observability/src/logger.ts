import pino, { type DestinationStream } from 'pino';

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';
export type LogFields = Readonly<Record<string, unknown>>;

export interface LogSink {
  write(chunk: string): void;
}

export interface AppLogger {
  debug(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  readonly environment: string;
  readonly level?: LogLevel;
  readonly serviceName: string;
  readonly sink?: LogSink;
}

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(?:account|api.?key|authorization|broker.*(?:body|payload|response)|certificate|cookie|credential|password|payload|private.?key|provider.*(?:body|payload|response)|raw.?payload|secret|session|token)/iu;

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 12) {
    return '[TRUNCATED]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, depth + 1));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }

  seen.add(value);
  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : sanitizeValue(nestedValue, seen, depth + 1);
  }
  seen.delete(value);
  return sanitized;
}

/** Recursively removes sensitive values before they reach a logger backend. */
export function sanitizeLogFields(fields: LogFields): LogFields {
  return Object.freeze(sanitizeValue(fields, new WeakSet<object>(), 0) as LogFields);
}

/** Creates a JSON logger with stable operational fields and centralized redaction. */
export function createLogger(options: LoggerOptions): AppLogger {
  if (options.serviceName.trim().length === 0 || options.environment.trim().length === 0) {
    throw new TypeError('serviceName and environment must be non-empty');
  }

  const backend = pino(
    {
      base: {
        environment: options.environment,
        service: options.serviceName,
      },
      formatters: {
        level: (label) => ({ severity: label }),
      },
      level: options.level ?? 'info',
      messageKey: 'message',
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
    options.sink as DestinationStream | undefined,
  );

  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    if (event.trim().length === 0) {
      throw new TypeError('event must be non-empty');
    }
    backend[level]({ ...sanitizeLogFields(fields), event });
  };

  return Object.freeze({
    debug: (event: string, fields?: LogFields): void => write('debug', event, fields),
    error: (event: string, fields?: LogFields): void => write('error', event, fields),
    info: (event: string, fields?: LogFields): void => write('info', event, fields),
    warn: (event: string, fields?: LogFields): void => write('warn', event, fields),
  });
}
