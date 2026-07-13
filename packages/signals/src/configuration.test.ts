import { describe, expect, it } from 'vitest';

import {
  BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION,
  createSignalConfiguration,
  semanticVersions,
  serializeSignalConfiguration,
} from './configuration.js';
import { SignalError } from './errors.js';
import { testConfiguration } from './test-fixtures.js';

describe('signal configuration', () => {
  it('constructs one deeply immutable approved scope with a stable hash', () => {
    const left = testConfiguration();
    const right = testConfiguration();
    expect(left).toEqual(right);
    expect(left.configurationHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(left.signalDefinitionVersion).toBe(BREAKOUT_PLUS_VOLUME_DEFINITION_VERSION);
    expect(left.scope).toEqual([
      { symbol: 'AAPL', venue: 'XNAS', interval: '1m' },
      { symbol: 'SPY', venue: 'ARCX', interval: '1m' },
    ]);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.scope)).toBe(true);
    expect(Object.isFrozen(left.scope[0])).toBe(true);
    expect(serializeSignalConfiguration(left)).toBe(serializeSignalConfiguration(right));
  });

  it('binds all semantic versions and the effective freshness policy', () => {
    expect(semanticVersions(testConfiguration())).toMatchObject({
      marketEventSchemaVersion: 'daily-trader.market-data.one-minute-bar.v1',
      canonicalRevisionSchemaVersion: 'daily-trader.market-data.canonical-revision.v1',
      arithmeticPolicyVersion: 'daily-trader.signals.arithmetic.bigjs.v1',
      calendarSnapshotVersion: 'nyse-core-2026-2028.v1',
      dataQualityPolicyVersion: 'daily-trader.market-data.quality.v1',
      featureResultSchemaVersion: 'daily-trader.signals.feature-result.v1',
      evaluationSchemaVersion: 'daily-trader.signals.evaluation.v1',
      signalDefinitionVersion: 'breakout_plus_volume.v1',
    });
  });

  it.each([
    {
      configurationVersion: 'v1',
      lookbackBars: 0,
      volumeMultiplier: '1',
      freshnessThresholdMs: 120_000,
    },
    {
      configurationVersion: 'v1',
      lookbackBars: 391,
      volumeMultiplier: '1',
      freshnessThresholdMs: 120_000,
    },
    {
      configurationVersion: 'v1',
      lookbackBars: 3.5,
      volumeMultiplier: '1',
      freshnessThresholdMs: 120_000,
    },
    {
      configurationVersion: 'v1',
      lookbackBars: 3,
      volumeMultiplier: 1.5,
      freshnessThresholdMs: 120_000,
    },
    {
      configurationVersion: 'v1',
      lookbackBars: 3,
      volumeMultiplier: '0.9',
      freshnessThresholdMs: 120_000,
    },
    {
      configurationVersion: 'v1',
      lookbackBars: 3,
      volumeMultiplier: '10.1',
      freshnessThresholdMs: 120_000,
    },
    {
      configurationVersion: 'BAD',
      lookbackBars: 3,
      volumeMultiplier: '1',
      freshnessThresholdMs: 120_000,
    },
    {
      configurationVersion: 'v1',
      lookbackBars: 3,
      volumeMultiplier: '1',
      freshnessThresholdMs: 59_999,
    },
  ])('rejects invalid configuration %#', (input) => {
    expect(() => createSignalConfiguration(input)).toThrowError(
      new SignalError('configuration_invalid'),
    );
  });

  it('rejects unknown fields and detects post-construction tampering', () => {
    expect(() =>
      createSignalConfiguration({
        configurationVersion: 'v1',
        lookbackBars: 3,
        volumeMultiplier: '1.5',
        freshnessThresholdMs: 120_000,
        unknown: true,
      } as never),
    ).toThrowError(new SignalError('configuration_invalid'));
    const valid = testConfiguration();
    expect(() => serializeSignalConfiguration({ ...valid, lookbackBars: 4 })).toThrowError(
      new SignalError('configuration_invalid'),
    );
    expect(() =>
      serializeSignalConfiguration({
        ...valid,
        schemaVersion: 'daily-trader.signals.configuration.v2',
      } as unknown as typeof valid),
    ).toThrowError(new SignalError('configuration_invalid'));
  });
});
