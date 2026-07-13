export interface DestroyablePortfolioPool {
  destroy(): Promise<void>;
}

export interface BoundedPortfolioShutdown {
  readonly stop: () => void;
  readonly remainingMs: () => number;
  readonly cancel: () => void;
}

/** Cancels provider reads immediately and force-closes PostgreSQL at one fixed deadline. */
export function createBoundedPortfolioShutdown(input: {
  readonly controller: AbortController;
  readonly pool: DestroyablePortfolioPool;
  readonly timeoutMs: number;
}): BoundedPortfolioShutdown {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive safe integer');
  }
  let deadline: number | null = null;
  let timer: NodeJS.Timeout | undefined;
  const stop = (): void => {
    if (deadline !== null) return;
    deadline = Date.now() + input.timeoutMs;
    input.controller.abort();
    timer = setTimeout(() => {
      void input.pool.destroy().catch(() => undefined);
    }, input.timeoutMs);
  };
  return Object.freeze({
    stop,
    remainingMs: () =>
      deadline === null ? input.timeoutMs : Math.max(1, Math.floor(deadline - Date.now())),
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  });
}
