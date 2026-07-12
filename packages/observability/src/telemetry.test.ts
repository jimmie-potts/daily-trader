import { describe, expect, it, vi } from 'vitest';

import {
  captureTraceContext,
  getMeter,
  initializeObservability,
  type ObservabilityOptions,
  withSpan,
  withTraceContext,
} from './telemetry.js';

describe('observability lifecycle', () => {
  it('stays locally useful with telemetry explicitly disabled', async () => {
    const runtime = initializeObservability({
      environment: 'test',
      exporter: 'none',
      serviceName: 'test-service',
    });

    expect(runtime).toMatchObject({ enabled: false, exporter: 'none' });
    const shutdown = runtime.shutdown();
    expect(runtime.shutdown()).toBe(shutdown);
    await expect(shutdown).resolves.toBeUndefined();
  });

  const invalidLifecycleCases: ReadonlyArray<readonly [ObservabilityOptions, string]> = [
    [{ environment: 'unknown', serviceName: 'test-service' }, 'environment'],
    [{ environment: 'test', serviceName: 'Invalid Service' }, 'serviceName'],
    [{ environment: 'test', serviceName: 'test-service', shutdownTimeoutMs: 0 }, 'shutdown'],
  ];

  it.each(invalidLifecycleCases)(
    'rejects unsafe lifecycle identity or bounds',
    (options, expected) => {
      expect(() => initializeObservability(options)).toThrowError(expected);
    },
  );

  it('rejects invalid console export intervals before starting an SDK', () => {
    expect(() =>
      initializeObservability({
        environment: 'test',
        exporter: 'console',
        metricExportIntervalMs: 0,
        serviceName: 'test-service',
      }),
    ).toThrowError(TypeError);
  });
});

describe('application-owned telemetry facades', () => {
  it('records bounded health and metric values against the no-op provider', () => {
    const meter = getMeter('test-service');
    meter.recordHealth('healthy');
    meter.addCounter('daily_trader.test.count', 1, { outcome: 'success' });
    meter.recordGauge('daily_trader.test.lag', 12, 'ms');
    meter.recordHistogram('daily_trader.test.duration', 15, 'ms');
  });

  it('rejects unbounded metric conventions', () => {
    const meter = getMeter('test-service');
    expect(() => meter.recordGauge('Invalid Metric', 1, 'ms')).toThrowError(TypeError);
    expect(() => meter.recordGauge('daily_trader.test.value', 1, 'widgets')).toThrowError(
      TypeError,
    );
    expect(() =>
      meter.addCounter('daily_trader.test.count', 1, { symbol: 'A'.repeat(65) }),
    ).toThrowError(TypeError);
  });

  it('keeps span and carrier types behind the package boundary', () => {
    expect(withSpan('test.operation', () => 'complete')).toBe('complete');
    const carrier = captureTraceContext();
    expect(withTraceContext(carrier, () => 'continued')).toBe('continued');
    expect(Object.isFrozen(carrier)).toBe(true);
  });

  it('keeps async spans open, propagates only trace headers, and shuts down once', async () => {
    const consoleOutput: unknown[] = [];
    const consoleSpy = vi.spyOn(console, 'dir').mockImplementation((item?: unknown) => {
      consoleOutput.push(item);
    });
    const runtime = initializeObservability({
      environment: 'test',
      exporter: 'console',
      metricExportIntervalMs: 300_000,
      serviceName: 'test-service',
      shutdownTimeoutMs: 2_000,
    });

    try {
      let carrier: Readonly<Record<string, string>> = {};
      getMeter('test-service').recordHealth('healthy');
      await withSpan('async.test.operation', async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        carrier = captureTraceContext();
      });

      expect(carrier.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/);
      const forwarded = withTraceContext(
        { ...carrier, baggage: 'account_id=sensitive-account' },
        () => captureTraceContext(),
      );
      expect(forwarded.traceparent).toBe(carrier.traceparent);
      expect(forwarded).not.toHaveProperty('baggage');

      const shutdown = runtime.shutdown();
      expect(runtime.shutdown()).toBe(shutdown);
      await shutdown;

      const spanOutput = consoleOutput.find(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'name' in value &&
          value.name === 'async.test.operation',
      ) as { duration: number; resource: { attributes: Record<string, unknown> } } | undefined;
      expect(spanOutput?.duration).toBeGreaterThanOrEqual(15_000);
      expect(spanOutput?.resource.attributes).toMatchObject({
        'deployment.environment.name': 'test',
        'service.name': 'test-service',
      });
      const serialized = JSON.stringify(consoleOutput);
      expect(serialized).not.toContain('sensitive-account');
      expect(serialized).not.toContain('process.owner');
      expect(serialized).not.toContain('host.name');
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
