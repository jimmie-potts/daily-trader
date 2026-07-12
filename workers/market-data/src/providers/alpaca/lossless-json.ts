import {
  type JsonNumberLexeme,
  type JsonNumberToken,
  type LosslessJsonValue,
  jsonNumberTokenBrand,
} from './types.js';

export type LosslessJsonErrorCode =
  | 'duplicate_key'
  | 'input_too_large'
  | 'invalid_json'
  | 'item_limit_exceeded'
  | 'nesting_too_deep'
  | 'token_too_large';

export class LosslessJsonParseError extends Error {
  public readonly code: LosslessJsonErrorCode;
  public readonly offset: number;

  public constructor(code: LosslessJsonErrorCode, offset: number) {
    super(`Lossless JSON parsing failed (${code}) at offset ${String(offset)}`);
    this.name = 'LosslessJsonParseError';
    this.code = code;
    this.offset = offset;
  }
}

export interface LosslessJsonLimits {
  readonly maxDepth?: number;
  readonly maxInputLength?: number;
  readonly maxItems?: number;
  readonly maxTokenLength?: number;
}

interface ResolvedLimits {
  readonly maxDepth: number;
  readonly maxInputLength: number;
  readonly maxItems: number;
  readonly maxTokenLength: number;
}

const DEFAULT_LIMITS: ResolvedLimits = Object.freeze({
  maxDepth: 32,
  maxInputLength: 1_000_000,
  maxItems: 20_000,
  maxTokenLength: 16_384,
});

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;

function requireBound(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function resolveLimits(limits: LosslessJsonLimits): ResolvedLimits {
  return Object.freeze({
    maxDepth: requireBound('maxDepth', limits.maxDepth ?? DEFAULT_LIMITS.maxDepth),
    maxInputLength: requireBound(
      'maxInputLength',
      limits.maxInputLength ?? DEFAULT_LIMITS.maxInputLength,
    ),
    maxItems: requireBound('maxItems', limits.maxItems ?? DEFAULT_LIMITS.maxItems),
    maxTokenLength: requireBound(
      'maxTokenLength',
      limits.maxTokenLength ?? DEFAULT_LIMITS.maxTokenLength,
    ),
  });
}

/** Parses JSON without ever constructing a JavaScript number from input. */
export function parseLosslessJson(
  input: string,
  limits: LosslessJsonLimits = {},
): LosslessJsonValue {
  const parser = new Parser(input, resolveLimits(limits));
  return parser.parse();
}

export function isJsonNumberToken(value: LosslessJsonValue | undefined): value is JsonNumberToken {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === 'number' &&
    'raw' in value &&
    typeof value.raw === 'string' &&
    jsonNumberTokenBrand in value
  );
}

class Parser {
  readonly #input: string;
  readonly #limits: ResolvedLimits;
  #offset = 0;
  #items = 0;

  public constructor(input: string, limits: ResolvedLimits) {
    if (typeof input !== 'string') {
      throw new TypeError('Lossless JSON input must be a string');
    }
    if (input.length > limits.maxInputLength) {
      throw new LosslessJsonParseError('input_too_large', 0);
    }
    this.#input = input;
    this.#limits = limits;
  }

  public parse(): LosslessJsonValue {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.#offset !== this.#input.length) {
      this.fail('invalid_json');
    }
    return value;
  }

  private parseValue(depth: number): LosslessJsonValue {
    this.countItem();
    const character = this.#input[this.#offset];

    if (character === '"') {
      return this.parseString();
    }
    if (character === '{') {
      return this.parseObject(depth + 1);
    }
    if (character === '[') {
      return this.parseArray(depth + 1);
    }
    if (character === 't') {
      this.consumeLiteral('true');
      return true;
    }
    if (character === 'f') {
      this.consumeLiteral('false');
      return false;
    }
    if (character === 'n') {
      this.consumeLiteral('null');
      return null;
    }
    if (character === '-' || (character !== undefined && character >= '0' && character <= '9')) {
      return this.parseNumber();
    }

    return this.fail('invalid_json');
  }

  private parseArray(depth: number): readonly LosslessJsonValue[] {
    this.requireDepth(depth);
    this.#offset += 1;
    this.skipWhitespace();
    const values: LosslessJsonValue[] = [];

    if (this.consumeIf(']')) {
      return Object.freeze(values);
    }

    for (;;) {
      values.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.consumeIf(']')) {
        return Object.freeze(values);
      }
      if (!this.consumeIf(',')) {
        return this.fail('invalid_json');
      }
      this.skipWhitespace();
    }
  }

  private parseObject(depth: number): Readonly<Record<string, LosslessJsonValue>> {
    this.requireDepth(depth);
    this.#offset += 1;
    this.skipWhitespace();
    const values: Record<string, LosslessJsonValue> = Object.create(null) as Record<
      string,
      LosslessJsonValue
    >;

    if (this.consumeIf('}')) {
      return Object.freeze(values);
    }

    for (;;) {
      if (this.#input[this.#offset] !== '"') {
        return this.fail('invalid_json');
      }
      const key = this.parseString();
      if (Object.hasOwn(values, key)) {
        return this.fail('duplicate_key');
      }
      this.skipWhitespace();
      if (!this.consumeIf(':')) {
        return this.fail('invalid_json');
      }
      this.skipWhitespace();
      values[key] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.consumeIf('}')) {
        return Object.freeze(values);
      }
      if (!this.consumeIf(',')) {
        return this.fail('invalid_json');
      }
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    const start = this.#offset;
    this.#offset += 1;
    let escaped = false;

    while (this.#offset < this.#input.length) {
      const character = this.#input[this.#offset];
      if (this.#offset - start + 1 > this.#limits.maxTokenLength) {
        return this.fail('token_too_large');
      }
      if (escaped) {
        escaped = false;
        this.#offset += 1;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        this.#offset += 1;
        continue;
      }
      if (character === '"') {
        this.#offset += 1;
        const token = this.#input.slice(start, this.#offset);
        try {
          const decoded: unknown = JSON.parse(token);
          if (typeof decoded !== 'string') {
            return this.fail('invalid_json');
          }
          return decoded;
        } catch {
          return this.fail('invalid_json');
        }
      }
      if (character !== undefined && character.charCodeAt(0) < 0x20) {
        return this.fail('invalid_json');
      }
      this.#offset += 1;
    }

    return this.fail('invalid_json');
  }

  private parseNumber(): JsonNumberToken {
    NUMBER.lastIndex = this.#offset;
    const match = NUMBER.exec(this.#input);
    if (match === null || match.index !== this.#offset) {
      return this.fail('invalid_json');
    }
    const raw = match[0];
    if (raw.length > this.#limits.maxTokenLength) {
      return this.fail('token_too_large');
    }
    this.#offset += raw.length;
    const token = { kind: 'number' as const, raw: raw as JsonNumberLexeme };
    Object.defineProperty(token, jsonNumberTokenBrand, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
    return Object.freeze(token) as JsonNumberToken;
  }

  private consumeLiteral(literal: 'false' | 'null' | 'true'): void {
    if (literal.length > this.#limits.maxTokenLength) {
      this.fail('token_too_large');
    }
    if (!this.#input.startsWith(literal, this.#offset)) {
      this.fail('invalid_json');
    }
    this.#offset += literal.length;
  }

  private skipWhitespace(): void {
    for (;;) {
      const character = this.#input[this.#offset];
      if (character !== ' ' && character !== '\n' && character !== '\r' && character !== '\t') {
        return;
      }
      this.#offset += 1;
    }
  }

  private consumeIf(character: ',' | ':' | ']' | '}'): boolean {
    if (this.#input[this.#offset] !== character) {
      return false;
    }
    this.#offset += 1;
    return true;
  }

  private countItem(): void {
    this.#items += 1;
    if (this.#items > this.#limits.maxItems) {
      this.fail('item_limit_exceeded');
    }
  }

  private requireDepth(depth: number): void {
    if (depth > this.#limits.maxDepth) {
      this.fail('nesting_too_deep');
    }
  }

  private fail(code: LosslessJsonErrorCode): never {
    throw new LosslessJsonParseError(code, this.#offset);
  }
}
