import type { PortfolioSyncSnapshot } from '@daily-trader/portfolio';

import type { PortfolioSnapshotCaptureRequest, PortfolioSnapshotProvider } from './types.js';

/** Credential-free provider that returns the same validated snapshot on every read. */
export class DeterministicPortfolioSnapshotProvider implements PortfolioSnapshotProvider {
  readonly #snapshot: PortfolioSyncSnapshot;

  public constructor(snapshot: PortfolioSyncSnapshot) {
    this.#snapshot = snapshot;
  }

  public capture(request: PortfolioSnapshotCaptureRequest): Promise<PortfolioSyncSnapshot> {
    if (request.signal?.aborted === true) {
      return Promise.reject(new Error('Fixture portfolio capture was cancelled'));
    }
    return Promise.resolve(this.#snapshot);
  }
}
