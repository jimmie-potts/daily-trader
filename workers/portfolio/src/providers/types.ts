import type { UtcTimestamp } from '@daily-trader/domain';
import type { PortfolioRequestReceipt, PortfolioSyncSnapshot } from '@daily-trader/portfolio';

export interface PortfolioSnapshotCaptureRequest {
  readonly previousActivityCutoverAt: UtcTimestamp | null;
  readonly captureAttempt?: number;
  readonly onRequestReceipt?: (receipt: PortfolioRequestReceipt) => Promise<void>;
  readonly signal?: AbortSignal;
}

/** Application-owned read port with no vendor or broker-mutation capability. */
export interface PortfolioSnapshotProvider {
  capture(request: PortfolioSnapshotCaptureRequest): Promise<PortfolioSyncSnapshot>;
}
