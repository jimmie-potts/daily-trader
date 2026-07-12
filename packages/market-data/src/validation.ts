export class MarketDataValidationError extends Error {
  public readonly field: string;

  public constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'MarketDataValidationError';
    this.field = field;
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new MarketDataValidationError(field, 'must be a string');
  }
  return value;
}

export function requireRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MarketDataValidationError(field, 'must be an object');
  }
  return value as Readonly<Record<string, unknown>>;
}
