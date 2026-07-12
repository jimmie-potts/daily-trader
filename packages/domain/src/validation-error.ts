/** An explicit failure to construct a domain value from untrusted input. */
export class DomainValidationError extends Error {
  public readonly field: string;

  public constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'DomainValidationError';
    this.field = field;
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError(field, 'must be a string');
  }

  return value;
}
