import { loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import type { ReactNode } from 'react';

import { getFoundationStatus } from '../src/status';

loadOptionalEnvironmentFile();
const status = getFoundationStatus(loadConfig());

export const dynamic = 'force-dynamic';

export default function FoundationStatusPage(): ReactNode {
  return (
    <main>
      <p className="eyebrow">Daily Trader</p>
      <h1>Foundation ready</h1>
      <p>
        Environment: <strong>{status.environment}</strong>
      </p>
      <p>
        Broker mode: <strong>{status.brokerMode} only</strong>
      </p>
      <p>
        Order execution: <strong>{status.execution}</strong>
      </p>
      <p className="note">
        Market data is {status.marketData}; signals, portfolio state, and broker access are not
        configured.
      </p>
    </main>
  );
}
