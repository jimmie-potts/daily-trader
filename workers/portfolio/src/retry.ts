export interface PortfolioRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterPercent: number;
}

export interface PortfolioRetryDecision {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export interface PortfolioRetryDependencies {
  readonly random: () => number;
  readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly onRetry?: (input: { readonly attempt: number; readonly delayMs: number }) => void;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted');
}

function boundedDelay(
  policy: PortfolioRetryPolicy,
  attempt: number,
  random: number,
  retryAfterMs?: number,
): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jitterRange = (exponential * policy.jitterPercent) / 100;
  const jittered = exponential - jitterRange + random * jitterRange * 2;
  return Math.ceil(Math.min(policy.maxDelayMs, Math.max(retryAfterMs ?? 0, jittered)));
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs one bounded operation; only explicitly retryable failures are repeated. */
export async function withPortfolioRetry<T>(input: {
  readonly policy: PortfolioRetryPolicy;
  readonly signal: AbortSignal;
  readonly operation: (attempt: number) => Promise<T>;
  readonly classify: (error: unknown) => PortfolioRetryDecision;
  readonly dependencies: PortfolioRetryDependencies;
}): Promise<T> {
  const { policy } = input;
  for (const value of [
    policy.maxAttempts,
    policy.baseDelayMs,
    policy.maxDelayMs,
    policy.jitterPercent,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('retry policy is invalid');
  }
  if (policy.maxAttempts < 1 || policy.baseDelayMs < 1 || policy.maxDelayMs < policy.baseDelayMs) {
    throw new TypeError('retry policy is invalid');
  }

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (input.signal.aborted) throw abortError(input.signal);
    try {
      return await input.operation(attempt);
    } catch (error) {
      const decision = input.classify(error);
      if (!decision.retryable || attempt === policy.maxAttempts) throw error;
      const random = input.dependencies.random();
      if (!Number.isFinite(random) || random < 0 || random > 1) {
        throw new TypeError('random must return a value from zero through one');
      }
      const delayMs = boundedDelay(policy, attempt, random, decision.retryAfterMs);
      input.dependencies.onRetry?.({ attempt, delayMs });
      await input.dependencies.delay(delayMs, input.signal);
    }
  }
  throw new TypeError('unreachable retry state');
}
