import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { AlpacaFrameDecoder } from './frame-decoder.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/alpaca/${name}`, import.meta.url), 'utf8');
}

describe('AlpacaFrameDecoder', () => {
  const decoder = new AlpacaFrameDecoder();

  it('classifies the sanitized control items exactly once', () => {
    expect(decoder.decode(fixture('control-messages.json'))).toEqual([
      { kind: 'connected' },
      { kind: 'authenticated' },
      { bars: ['AAPL', 'SPY'], kind: 'subscription' },
    ]);
  });

  it('preserves all AAPL/SPY numeric lexemes and provider timestamp precision', () => {
    expect(decoder.decode(fixture('aapl-spy-bars.json.txt'))).toEqual([
      {
        close: '190.0000',
        high: '190.1250',
        kind: 'bar',
        low: '189.2500',
        open: '189.5000',
        providerTimestamp: '2026-07-10T14:31:00.123456789Z',
        symbol: 'AAPL',
        volume: '90071992547409931234567890',
      },
      {
        close: '611.2500',
        high: '611.4000',
        kind: 'bar',
        low: '610.9000',
        open: '611.1000',
        providerTimestamp: '2026-07-10T14:31:00Z',
        symbol: 'SPY',
        volume: '1234567',
      },
    ]);
  });

  it('never accepts wrong-symbol, updated, daily, trade, or quote messages as bars', () => {
    const decoded = decoder.decode(fixture('wrong-symbol-and-unsupported.json'));

    expect(decoded).toEqual([
      { eventType: 'b', kind: 'ignored', reason: 'unsupported_symbol' },
      { eventType: 'u', kind: 'ignored', reason: 'unsupported_event' },
      { eventType: 'd', kind: 'ignored', reason: 'unsupported_event' },
      { eventType: 't', kind: 'ignored', reason: 'unsupported_event' },
      { eventType: 'q', kind: 'ignored', reason: 'unsupported_event' },
    ]);
    expect(decoded.some((item) => item.kind === 'bar')).toBe(false);
  });

  it('classifies every structurally malformed array item once', () => {
    expect(decoder.decode(fixture('malformed-items.json'))).toEqual([
      { kind: 'malformed', reason: 'invalid_bar' },
      { kind: 'malformed', reason: 'invalid_subscription' },
      { kind: 'malformed', reason: 'invalid_error_message' },
      { kind: 'malformed', reason: 'invalid_control_message' },
    ]);
  });

  it('rejects a syntactically invalid provider timestamp before normalization', () => {
    expect(
      decoder.decode(
        '[{"T":"b","S":"AAPL","o":100,"h":101,"l":99,"c":100.5,"v":1000,"t":"not-a-time"}]',
      ),
    ).toEqual([{ kind: 'malformed', reason: 'invalid_bar' }]);
  });

  it('requires an exact AAPL/SPY bars-only subscription acknowledgement', () => {
    expect(
      decoder.decode('[{"T":"subscription","bars":["SPY","AAPL"],"trades":[],"quotes":[]}]'),
    ).toEqual([{ bars: ['AAPL', 'SPY'], kind: 'subscription' }]);

    expect(
      decoder.decode(
        '[{"T":"subscription","bars":["AAPL","SPY"],"trades":[],"quotes":[],"futureChannel":[]}]',
      ),
    ).toEqual([{ kind: 'malformed', reason: 'invalid_subscription' }]);
  });

  it('retains only a safe error code and discards the provider message', () => {
    const secret = 'secret-that-must-not-escape';
    const decoded = decoder.decode(
      `[{"T":"error","code":402,"msg":"authentication failed ${secret}"}]`,
    );

    expect(decoded).toEqual([{ code: '402', kind: 'error' }]);
    expect(JSON.stringify(decoded)).not.toContain(secret);
  });

  it('returns one safe malformed classification for a malformed or non-array frame', () => {
    expect(decoder.decode('{"T":"success"}')).toEqual([
      { kind: 'malformed', reason: 'invalid_frame' },
    ]);
    expect(decoder.decode('[{"T":"b"}')).toEqual([{ kind: 'malformed', reason: 'invalid_frame' }]);
  });

  it('applies bounded parser limits without exposing the rejected frame', () => {
    const boundedDecoder = new AlpacaFrameDecoder({ maxInputLength: 10 });
    expect(boundedDecoder.decode('[{"T":"success","msg":"connected"}]')).toEqual([
      { kind: 'malformed', reason: 'invalid_frame' },
    ]);
  });
});
