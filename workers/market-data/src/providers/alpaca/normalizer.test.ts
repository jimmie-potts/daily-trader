import { FixedClock, createUtcTimestamp } from '@daily-trader/domain';
import { describe, expect, it } from 'vitest';

import { normalizeAlpacaBar } from './normalizer.js';
import { parseLosslessJson } from './lossless-json.js';
import { AlpacaFrameDecoder } from './frame-decoder.js';

describe('normalizeAlpacaBar', () => {
  it('preserves lexical values and provider timestamp precision', () => {
    const decoded = new AlpacaFrameDecoder().decode(
      '[{"T":"b","S":"AAPL","o":234.1000,"h":235.000000000000000001,"l":233.9,"c":234.5,"v":900719925474099312345,"t":"2026-07-06T13:30:00.000000000Z"}]',
    );
    const raw = decoded[0];
    expect(raw?.kind).toBe('bar');
    if (raw?.kind !== 'bar') {
      throw new Error('expected a decoded bar');
    }

    const event = normalizeAlpacaBar(
      { ...raw, receivedAt: '2026-07-06T13:31:00.100Z' },
      new FixedClock(createUtcTimestamp('2026-07-06T13:31:00.200Z')),
    );

    expect(event).toMatchObject({
      open: '234.1',
      high: '235.000000000000000001',
      volume: '900719925474099312345',
      providerTimestamp: '2026-07-06T13:30:00.000000000Z',
      barStart: '2026-07-06T13:30:00.000Z',
      receivedAt: '2026-07-06T13:31:00.100Z',
      processedAt: '2026-07-06T13:31:00.200Z',
    });
  });

  it('rejects invalid exact OHLC before constructing an event', () => {
    const decoded = new AlpacaFrameDecoder().decode(
      '[{"T":"b","S":"SPY","o":500,"h":499,"l":498,"c":498.5,"v":10,"t":"2026-07-06T13:30:00Z"}]',
    );
    const raw = decoded[0];
    if (raw?.kind !== 'bar') {
      throw new Error('expected a decoded bar');
    }

    expect(() =>
      normalizeAlpacaBar(
        { ...raw, receivedAt: '2026-07-06T13:31:00.100Z' },
        new FixedClock(createUtcTimestamp('2026-07-06T13:31:00.200Z')),
      ),
    ).toThrow('open: must be between low and high');
  });

  it('never needs native JSON numeric decoding', () => {
    const parsed = parseLosslessJson('[900719925474099312345]');
    expect(parsed).toEqual([{ kind: 'number', raw: '900719925474099312345' }]);
  });
});
