export type AlpacaPaperApiErrorClassification =
  | 'account_mismatch'
  | 'authentication'
  | 'authorization'
  | 'cancelled'
  | 'invalid_request'
  | 'malformed_response'
  | 'rate_limited'
  | 'redirect_rejected'
  | 'resource_limit'
  | 'retryable_transport';

/** A bounded provider failure that never includes credentials or response bodies. */
export class AlpacaPaperApiError extends Error {
  public readonly classification: AlpacaPaperApiErrorClassification;
  public readonly code: string;
  public readonly retryAfterMs: number | undefined;

  public constructor(input: {
    readonly classification: AlpacaPaperApiErrorClassification;
    readonly code: string;
    readonly retryAfterMs?: number;
  }) {
    super('The Alpaca paper Trading API request failed');
    this.name = 'AlpacaPaperApiError';
    this.classification = input.classification;
    this.code = input.code;
    this.retryAfterMs = input.retryAfterMs;
  }
}
