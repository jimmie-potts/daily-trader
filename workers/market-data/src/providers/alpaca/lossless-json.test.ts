import { describe, expect, it } from 'vitest';

import { isJsonNumberToken, LosslessJsonParseError, parseLosslessJson } from './lossless-json.js';
import type { LosslessJsonValue } from './types.js';

function requireObject(value: LosslessJsonValue): Readonly<Record<string, LosslessJsonValue>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    isJsonNumberToken(value)
  ) {
    throw new TypeError('expected object fixture');
  }
  return value as Readonly<Record<string, LosslessJsonValue>>;
}

function assertNoJavascriptNumbers(value: LosslessJsonValue): void {
  expect(typeof value).not.toBe('number');
  if (Array.isArray(value)) {
    value.forEach(assertNoJavascriptNumbers);
    return;
  }
  if (typeof value === 'object' && value !== null && !isJsonNumberToken(value)) {
    Object.values(value).forEach(assertNoJavascriptNumbers);
  }
}

describe('parseLosslessJson', () => {
  it('preserves every numeric token exactly without constructing JavaScript numbers', () => {
    const parsed = requireObject(
      parseLosslessJson(
        '{"trailing":189.5000,"large":90071992547409931234567890,"exponent":-1.25e+30,"values":[true,false,null,"1.0"]}',
      ),
    );

    expect(parsed.trailing).toEqual({ kind: 'number', raw: '189.5000' });
    expect(parsed.large).toEqual({ kind: 'number', raw: '90071992547409931234567890' });
    expect(parsed.exponent).toEqual({ kind: 'number', raw: '-1.25e+30' });
    expect(parsed.values).toEqual([true, false, null, '1.0']);
    assertNoJavascriptNumbers(parsed);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.trailing)).toBe(true);
  });

  it('decodes JSON strings and keeps number-looking strings distinct from number tokens', () => {
    const parsed = requireObject(
      parseLosslessJson('{"escaped":"line\\n\\u0041","quoted":"12.50"}'),
    );

    expect(parsed).toEqual({ escaped: 'line\nA', quoted: '12.50' });
  });

  it.each([
    '',
    '01',
    '-01',
    '1.',
    '.5',
    '[1,]',
    '{"a":1,}',
    '{"a" 1}',
    '{"a":"unterminated}',
    'true false',
    'NaN',
  ])('rejects malformed JSON without echoing input: %s', (input) => {
    try {
      parseLosslessJson(input);
      throw new Error('expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(LosslessJsonParseError);
      expect(String(error)).not.toContain(input.length > 4 ? input : 'never-match');
    }
  });

  it('rejects duplicate object keys', () => {
    expect(() => parseLosslessJson('{"a":1,"a":2}')).toThrowError(
      expect.objectContaining({ code: 'duplicate_key' }),
    );
  });

  it('enforces input, nesting, item, and token limits', () => {
    expect(() => parseLosslessJson('[1]', { maxInputLength: 2 })).toThrowError(
      expect.objectContaining({ code: 'input_too_large' }),
    );
    expect(() => parseLosslessJson('[[null]]', { maxDepth: 1 })).toThrowError(
      expect.objectContaining({ code: 'nesting_too_deep' }),
    );
    expect(() => parseLosslessJson('[1,2]', { maxItems: 2 })).toThrowError(
      expect.objectContaining({ code: 'item_limit_exceeded' }),
    );
    expect(() => parseLosslessJson('"abcdef"', { maxTokenLength: 4 })).toThrowError(
      expect.objectContaining({ code: 'token_too_large' }),
    );
    expect(() => parseLosslessJson('12345', { maxTokenLength: 4 })).toThrowError(
      expect.objectContaining({ code: 'token_too_large' }),
    );
  });

  it('validates configured parser bounds before reading input', () => {
    expect(() => parseLosslessJson('null', { maxDepth: 0 })).toThrowError(RangeError);
  });
});
