export type PortfolioErrorCode =
  | 'arithmetic_overflow'
  | 'contract_invalid'
  | 'decimal_invalid'
  | 'division_by_zero'
  | 'projection_invalid'
  | 'reconciliation_invalid'
  | 'serialization_invalid';

export class PortfolioError extends Error {
  public readonly code: PortfolioErrorCode;

  public constructor(code: PortfolioErrorCode, options?: ErrorOptions) {
    super(`Portfolio operation failed: ${code}`, options);
    this.name = 'PortfolioError';
    this.code = code;
  }
}
