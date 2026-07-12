import { MarketDataValidationError } from './validation.js';

export type MarketDataConnectionState =
  | 'disabled'
  | 'connecting'
  | 'authenticating'
  | 'subscribed'
  | 'reconnecting'
  | 'stopped'
  | 'terminal_failure';

export type MarketDataConnectionEvent =
  | 'start'
  | 'socket_opened'
  | 'subscription_acknowledged'
  | 'retryable_failure'
  | 'retry_started'
  | 'terminal_failure'
  | 'stop';

export function transitionMarketDataConnection(
  state: MarketDataConnectionState,
  event: MarketDataConnectionEvent,
): MarketDataConnectionState {
  if (event === 'stop' && state !== 'stopped') {
    return 'stopped';
  }
  if (event === 'terminal_failure' && state !== 'stopped' && state !== 'terminal_failure') {
    return 'terminal_failure';
  }

  const key = `${state}:${event}`;
  const transitions: Readonly<Record<string, MarketDataConnectionState>> = {
    'disabled:start': 'connecting',
    'connecting:socket_opened': 'authenticating',
    'authenticating:subscription_acknowledged': 'subscribed',
    'connecting:retryable_failure': 'reconnecting',
    'authenticating:retryable_failure': 'reconnecting',
    'subscribed:retryable_failure': 'reconnecting',
    'reconnecting:retry_started': 'connecting',
  };
  const next = transitions[key];
  if (next === undefined) {
    throw new MarketDataValidationError(
      'connectionTransition',
      `cannot apply ${event} while ${state}`,
    );
  }
  return next;
}

export interface ReconnectPolicy {
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly maximumAttempts: number;
  readonly jitterRatio: number;
}

export type ReconnectDecision =
  | Readonly<{ kind: 'retry'; attempt: number; delayMs: number }>
  | Readonly<{ kind: 'exhausted'; attempt: number }>;

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = Object.freeze({
  baseDelayMs: 500,
  maximumDelayMs: 30_000,
  maximumAttempts: 8,
  jitterRatio: 0.2,
});

function validateReconnectPolicy(policy: ReconnectPolicy): void {
  if (!Number.isInteger(policy.baseDelayMs) || policy.baseDelayMs < 1) {
    throw new MarketDataValidationError('baseDelayMs', 'must be a positive integer');
  }
  if (
    !Number.isInteger(policy.maximumDelayMs) ||
    policy.maximumDelayMs < policy.baseDelayMs ||
    policy.maximumDelayMs > 300_000
  ) {
    throw new MarketDataValidationError(
      'maximumDelayMs',
      'must be an integer between baseDelayMs and 300000',
    );
  }
  if (
    !Number.isInteger(policy.maximumAttempts) ||
    policy.maximumAttempts < 1 ||
    policy.maximumAttempts > 100
  ) {
    throw new MarketDataValidationError('maximumAttempts', 'must be an integer from 1 through 100');
  }
  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    throw new MarketDataValidationError('jitterRatio', 'must be between zero and one');
  }
}

/** Returns a bounded delay using an injected deterministic jitter sample in [0, 1]. */
export function calculateReconnectDecision(
  attempt: number,
  policy: ReconnectPolicy,
  jitterSample: number,
): ReconnectDecision {
  validateReconnectPolicy(policy);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new MarketDataValidationError('attempt', 'must be a positive integer');
  }
  if (!Number.isFinite(jitterSample) || jitterSample < 0 || jitterSample > 1) {
    throw new MarketDataValidationError('jitterSample', 'must be between zero and one');
  }
  if (attempt > policy.maximumAttempts) {
    return Object.freeze({ kind: 'exhausted', attempt });
  }

  const exponential = Math.min(
    policy.maximumDelayMs,
    policy.baseDelayMs * 2 ** Math.min(attempt - 1, 30),
  );
  const jitterFactor = 1 - policy.jitterRatio + 2 * policy.jitterRatio * jitterSample;
  const delayMs = Math.max(
    0,
    Math.min(policy.maximumDelayMs, Math.round(exponential * jitterFactor)),
  );
  return Object.freeze({ kind: 'retry', attempt, delayMs });
}
