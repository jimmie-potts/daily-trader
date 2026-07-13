import type { PortfolioSyncSnapshot } from '@daily-trader/portfolio';

import { normalizeAlpacaCapture } from '../../normalization/alpaca.js';
import type { PortfolioSnapshotProvider } from '../types.js';
import {
  AlpacaPaperTradingClient,
  type AlpacaPaperTradingClientDependencies,
  type AlpacaPaperTradingClientOptions,
} from './http-client.js';
import type { AlpacaCaptureRequest } from './types.js';

/**
 * Public read-only provider boundary. It exposes one complete capture operation
 * and deliberately provides no generic HTTP or broker-mutation capability.
 */
export class AlpacaPaperPortfolioProvider implements PortfolioSnapshotProvider {
  readonly #client: AlpacaPaperTradingClient;

  public constructor(
    options: AlpacaPaperTradingClientOptions,
    dependencies: AlpacaPaperTradingClientDependencies,
  ) {
    this.#client = new AlpacaPaperTradingClient(options, dependencies);
  }

  public async capture(request: AlpacaCaptureRequest): Promise<PortfolioSyncSnapshot> {
    return normalizeAlpacaCapture(await this.#client.capture(request));
  }
}

export type {
  AlpacaPaperTradingClientDependencies as AlpacaPaperPortfolioProviderDependencies,
  AlpacaPaperTradingClientOptions as AlpacaPaperPortfolioProviderOptions,
};
