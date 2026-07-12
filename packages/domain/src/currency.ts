import { DomainValidationError, requireString } from './validation-error.js';

declare const currencyCodeBrand: unique symbol;

/** A syntactically valid, uppercase ISO 4217-style currency code. */
export type CurrencyCode = string & {
  readonly [currencyCodeBrand]: 'CurrencyCode';
};

const CURRENCY_CODE = /^[A-Z]{3}$/u;

/**
 * Validates the ISO 4217 lexical form. Registry membership is intentionally a
 * separate concern because assigned codes can change over time.
 */
export function createCurrencyCode(value: unknown): CurrencyCode {
  const candidate = requireString(value, 'currency');

  if (!CURRENCY_CODE.test(candidate)) {
    throw new DomainValidationError(
      'currency',
      'must contain exactly three uppercase ASCII letters',
    );
  }

  return candidate as CurrencyCode;
}
