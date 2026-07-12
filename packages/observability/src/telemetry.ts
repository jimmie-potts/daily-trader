import { context, metrics, propagation, trace, type Attributes } from '@opentelemetry/api';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';

export type TelemetryExporter = 'console' | 'none';
export type MetricAttributes = Readonly<Record<string, string | number | boolean>>;
export type TraceCarrier = Readonly<Record<string, string>>;

export interface ObservabilityOptions {
  readonly environment: string;
  readonly exporter?: TelemetryExporter;
  readonly metricExportIntervalMs?: number;
  readonly serviceName: string;
  readonly shutdownTimeoutMs?: number;
}

export interface ObservabilityRuntime {
  readonly enabled: boolean;
  readonly exporter: TelemetryExporter;
  shutdown(): Promise<void>;
}

export interface AppMeter {
  addCounter(
    name: string,
    value?: number,
    attributes?: MetricAttributes,
    description?: string,
  ): void;
  recordGauge(
    name: string,
    value: number,
    unit: string,
    attributes?: MetricAttributes,
    description?: string,
  ): void;
  recordHealth(state: 'healthy' | 'starting' | 'stopping' | 'unhealthy'): void;
  recordHistogram(
    name: string,
    value: number,
    unit: string,
    attributes?: MetricAttributes,
    description?: string,
  ): void;
}

const METRIC_NAME = /^[a-z][a-z0-9]*(?:[._][a-z][a-z0-9]*){1,7}$/u;
const ATTRIBUTE_KEY = /^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*){0,7}$/u;
const HIGH_CARDINALITY_OR_SENSITIVE_ATTRIBUTE =
  /(?:account|correlation|credential|instrument|order|position|secret|symbol|token|(?:^|_)id$)/u;
const UNIT = /^(?:1|By|ms|s)$/u;
const SERVICE_NAME = /^[a-z][a-z0-9-]{2,63}$/u;
const ENVIRONMENT = /^(?:local|test|staging|production)$/u;

function validateMetric(
  name: string,
  value: number,
  attributes: MetricAttributes,
  unit?: string,
): Attributes {
  if (!METRIC_NAME.test(name)) {
    throw new TypeError('metric name must use bounded lowercase dot or underscore segments');
  }
  if (!Number.isFinite(value)) {
    throw new TypeError('metric value must be finite');
  }
  if (unit !== undefined && !UNIT.test(unit)) {
    throw new TypeError('metric unit must be one of 1, By, ms, or s');
  }
  const entries = Object.entries(attributes);
  if (entries.length > 12) {
    throw new TypeError('metrics may have at most 12 attributes');
  }
  for (const [key, attributeValue] of entries) {
    if (!ATTRIBUTE_KEY.test(key)) {
      throw new TypeError(`invalid metric attribute key: ${key}`);
    }
    if (HIGH_CARDINALITY_OR_SENSITIVE_ATTRIBUTE.test(key)) {
      throw new TypeError(`metric attribute is high-cardinality or sensitive: ${key}`);
    }
    if (typeof attributeValue === 'string' && attributeValue.length > 64) {
      throw new TypeError(`metric attribute is too long: ${key}`);
    }
  }
  return attributes;
}

function boundedShutdown(operation: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Observability shutdown timed out'));
    }, timeoutMs);
    operation.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        reject(new Error('Observability shutdown failed'));
      },
    );
  });
}

function metricOptions(
  unit: string,
  description: string | undefined,
): { readonly description?: string; readonly unit: string } {
  return description === undefined ? { unit } : { description, unit };
}

/** Starts only local diagnostic telemetry; no network exporter is configured in Phase 1. */
export function initializeObservability(options: ObservabilityOptions): ObservabilityRuntime {
  if (!SERVICE_NAME.test(options.serviceName)) {
    throw new TypeError('serviceName must be a lowercase, hyphenated application identifier');
  }
  if (!ENVIRONMENT.test(options.environment)) {
    throw new TypeError('environment must be local, test, staging, or production');
  }
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  if (
    !Number.isInteger(shutdownTimeoutMs) ||
    shutdownTimeoutMs < 100 ||
    shutdownTimeoutMs > 30_000
  ) {
    throw new TypeError('shutdownTimeoutMs must be between 100 and 30000');
  }
  const exporter = options.exporter ?? 'none';
  if (exporter === 'none') {
    const completed = Promise.resolve();
    return Object.freeze({
      enabled: false,
      exporter,
      shutdown: (): Promise<void> => completed,
    });
  }

  const interval = options.metricExportIntervalMs ?? 60_000;
  if (!Number.isInteger(interval) || interval < 1_000 || interval > 300_000) {
    throw new TypeError('metricExportIntervalMs must be between 1000 and 300000');
  }

  const sdk = new NodeSDK({
    autoDetectResources: false,
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new ConsoleMetricExporter(),
        exportIntervalMillis: interval,
        exportTimeoutMillis: Math.min(interval, 30_000),
      }),
    ],
    resource: resourceFromAttributes({
      'deployment.environment.name': options.environment,
      'service.name': options.serviceName,
    }),
    traceExporter: new ConsoleSpanExporter(),
  });
  try {
    sdk.start();
  } catch {
    void sdk.shutdown().catch(() => undefined);
    throw new Error('Observability initialization failed');
  }

  let shutdownPromise: Promise<void> | undefined;

  return Object.freeze({
    enabled: true,
    exporter,
    shutdown: (): Promise<void> => {
      shutdownPromise ??= boundedShutdown(sdk.shutdown(), shutdownTimeoutMs);
      return shutdownPromise;
    },
  });
}

/** Returns an application-owned metrics facade rather than OpenTelemetry types. */
export function getMeter(serviceName: string): AppMeter {
  const meter = metrics.getMeter(serviceName);
  const counters = new Map<string, ReturnType<typeof meter.createCounter>>();
  const gauges = new Map<string, ReturnType<typeof meter.createGauge>>();
  const histograms = new Map<string, ReturnType<typeof meter.createHistogram>>();

  return Object.freeze({
    addCounter: (
      name: string,
      value = 1,
      attributes: MetricAttributes = {},
      description?: string,
    ): void => {
      const validated = validateMetric(name, value, attributes, '1');
      const counter =
        counters.get(name) ?? meter.createCounter(name, metricOptions('1', description));
      counters.set(name, counter);
      counter.add(value, validated);
    },
    recordGauge: (
      name: string,
      value: number,
      unit: string,
      attributes: MetricAttributes = {},
      description?: string,
    ): void => {
      const validated = validateMetric(name, value, attributes, unit);
      const gauge = gauges.get(name) ?? meter.createGauge(name, metricOptions(unit, description));
      gauges.set(name, gauge);
      gauge.record(value, validated);
    },
    recordHealth: (state: 'healthy' | 'starting' | 'stopping' | 'unhealthy'): void => {
      const name = 'daily_trader.process.health';
      const gauge =
        gauges.get(name) ??
        meter.createGauge(name, {
          description: 'Current process health state encoded as one.',
          unit: '1',
        });
      gauges.set(name, gauge);
      gauge.record(1, { state });
    },
    recordHistogram: (
      name: string,
      value: number,
      unit: string,
      attributes: MetricAttributes = {},
      description?: string,
    ): void => {
      const validated = validateMetric(name, value, attributes, unit);
      const histogram =
        histograms.get(name) ?? meter.createHistogram(name, metricOptions(unit, description));
      histograms.set(name, histogram);
      histogram.record(value, validated);
    },
  });
}

function recordSpanError(error: unknown, record: (exception: Error) => void): void {
  record(error instanceof Error ? error : new Error('Unknown operation failure'));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

export function withSpan<T>(name: string, operation: () => Promise<T>): Promise<T>;
export function withSpan<T>(name: string, operation: () => T): T;
export function withSpan(name: string, operation: () => unknown): unknown {
  return trace.getTracer('daily-trader').startActiveSpan(name, (span) => {
    try {
      const result = operation();
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(
          (value) => {
            span.end();
            return value;
          },
          (error: unknown) => {
            recordSpanError(error, (exception) => span.recordException(exception));
            span.end();
            throw error;
          },
        );
      }
      span.end();
      return result;
    } catch (error) {
      recordSpanError(error, (exception) => span.recordException(exception));
      span.end();
      throw error;
    }
  });
}

function allowedTraceCarrier(carrier: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(carrier).filter(
      ([key, value]) =>
        (key.toLowerCase() === 'traceparent' || key.toLowerCase() === 'tracestate') &&
        value.length <= 512,
    ),
  );
}

export function captureTraceContext(): TraceCarrier {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return Object.freeze(allowedTraceCarrier(carrier));
}

export function withTraceContext<T>(carrier: TraceCarrier, operation: () => T): T {
  const extracted = propagation.extract(context.active(), allowedTraceCarrier(carrier));
  return context.with(extracted, operation);
}
