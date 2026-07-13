import { createOneMinuteBarEvent, type OneMinuteBarEvent } from '@daily-trader/market-data';

import { createSignalConfiguration, type SignalConfiguration } from './configuration.js';

export function testConfiguration(
  overrides: {
    readonly lookbackBars?: number;
    readonly volumeMultiplier?: string;
    readonly freshnessThresholdMs?: number;
    readonly configurationVersion?: string;
  } = {},
): SignalConfiguration {
  return createSignalConfiguration({
    configurationVersion: overrides.configurationVersion ?? 'phase3-test-v1',
    lookbackBars: overrides.lookbackBars ?? 3,
    volumeMultiplier: overrides.volumeMultiplier ?? '1.5',
    freshnessThresholdMs: overrides.freshnessThresholdMs ?? 120_000,
  });
}

export function testBar(input: {
  readonly minute: number;
  readonly date?: string;
  readonly symbol?: 'AAPL' | 'SPY';
  readonly open?: string;
  readonly high?: string;
  readonly low?: string;
  readonly close?: string;
  readonly volume?: string;
  readonly receivedOffsetMs?: number;
  readonly processedOffsetMs?: number;
}): OneMinuteBarEvent {
  const date = input.date ?? '2026-07-13';
  const symbol = input.symbol ?? 'AAPL';
  const venue = symbol === 'AAPL' ? 'XNAS' : 'ARCX';
  const start = Date.parse(`${date}T13:30:00.000Z`) + input.minute * 60_000;
  const received = start + (input.receivedOffsetMs ?? 70_000);
  const processed = received + (input.processedOffsetMs ?? 1_000);
  return createOneMinuteBarEvent({
    symbol,
    venue,
    providerTimestamp: new Date(start).toISOString(),
    receivedAt: new Date(received).toISOString(),
    processedAt: new Date(processed).toISOString(),
    open: input.open ?? '100',
    high: input.high ?? '105',
    low: input.low ?? '95',
    close: input.close ?? '100',
    volume: input.volume ?? '100',
  });
}

export function readyBars(
  input: {
    readonly evaluationClose?: string;
    readonly evaluationHigh?: string;
    readonly evaluationLow?: string;
    readonly evaluationVolume?: string;
    readonly symbol?: 'AAPL' | 'SPY';
  } = {},
): readonly OneMinuteBarEvent[] {
  const symbol = input.symbol ?? 'AAPL';
  return Object.freeze([
    testBar({ minute: 0, symbol, high: '101', low: '98', volume: '100' }),
    testBar({ minute: 1, symbol, high: '103', low: '97', volume: '200' }),
    testBar({ minute: 2, symbol, high: '102', low: '96', volume: '300' }),
    testBar({
      minute: 3,
      symbol,
      open: '100',
      high: input.evaluationHigh ?? '110',
      low: input.evaluationLow ?? '95',
      close: input.evaluationClose ?? '106',
      volume: input.evaluationVolume ?? '400',
    }),
  ]);
}
