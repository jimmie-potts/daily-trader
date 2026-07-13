export interface DestroyablePool {
  destroy(): Promise<void>;
}

export interface BoundedPoolShutdown {
  readonly stop: () => void;
  readonly remainingMs: () => number;
  readonly cancel: () => void;
}

/** Starts one process-wide database shutdown deadline at the first stop signal. */
export function createBoundedPoolShutdown(input: {
  readonly controller: AbortController;
  readonly pool: DestroyablePool;
  readonly timeoutMs: number;
}): BoundedPoolShutdown {
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
