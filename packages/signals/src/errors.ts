export type SignalErrorCode =
  | 'arithmetic_overflow'
  | 'configuration_invalid'
  | 'decimal_invalid'
  | 'invariant_violation'
  | 'replay_configuration_mismatch'
  | 'replay_invalid'
  | 'replay_sink_failed'
  | 'serialization_invalid'
  | 'transition_invalid';

/** A safe, classified failure from pure signal construction or evaluation. */
export class SignalError extends Error {
  public readonly code: SignalErrorCode;

  public constructor(code: SignalErrorCode) {
    super(`Signal operation failed: ${code}`);
    this.name = 'SignalError';
    this.code = code;
  }
}
