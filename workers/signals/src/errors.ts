export type SignalsWorkerErrorCode =
  | 'capacity_exceeded'
  | 'configuration_conflict'
  | 'cursor_conflict'
  | 'journal_gap'
  | 'persistence_failed'
  | 'stored_data_invalid'
  | 'writer_contract_unavailable';

export class SignalsWorkerError extends Error {
  public readonly code: SignalsWorkerErrorCode;

  public constructor(code: SignalsWorkerErrorCode, options?: ErrorOptions) {
    super(`Signal worker failed: ${code}`, options);
    this.name = 'SignalsWorkerError';
    this.code = code;
  }
}
