export type PortfolioWorkerErrorCode =
  | 'account_mismatch'
  | 'claim_lost'
  | 'database_unavailable'
  | 'projection_failed'
  | 'provider_authentication'
  | 'provider_authorization'
  | 'provider_capacity'
  | 'provider_malformed_data'
  | 'provider_rate_limited'
  | 'provider_transport'
  | 'shutdown_interrupted'
  | 'sync_failed';

/** Safe bounded worker failure; it never carries a provider payload or identifier. */
export class PortfolioWorkerError extends Error {
  public constructor(
    readonly code: PortfolioWorkerErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PortfolioWorkerError';
  }
}
