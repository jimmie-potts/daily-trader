import {
  loadConfig,
  loadOptionalEnvironmentFile,
  type ApplicationConfig,
} from '@daily-trader/config';
import type { ReactNode } from 'react';

import {
  loadPortfolioDashboard,
  type PortfolioDashboardResult,
  type PortfolioDashboardSnapshot,
} from '../src/portfolio';

loadOptionalEnvironmentFile();

export const dynamic = 'force-dynamic';

export function buildPortfolioApiBaseUrl(
  host: ApplicationConfig['api']['host'],
  port: number,
): string {
  const authorityHost = host === '::1' ? `[${host}]` : host;
  return `http://${authorityHost}:${port}`;
}

function ExactValue({ value, suffix = '' }: { value: string | null; suffix?: string }): ReactNode {
  return value === null ? (
    <span className="muted">unavailable</span>
  ) : (
    <code>
      {value}
      {suffix}
    </code>
  );
}

function Summary({ snapshot }: { snapshot: PortfolioDashboardSnapshot }): ReactNode {
  const { account, health, metrics } = snapshot;
  return (
    <>
      <section className="status-grid" aria-label="Portfolio status">
        <article>
          <span>Sync health</span>
          <strong className={`state state-${health.state}`}>
            {health.state.replace('_', ' ')}
          </strong>
          <small>
            Worker: {health.workerLifecycle} · Last failure: {health.lastFailureCode ?? 'none'} ·
            Age: {health.ageMilliseconds === null ? 'unavailable' : `${health.ageMilliseconds} ms`}
          </small>
        </article>
        <article>
          <span>Snapshot as of</span>
          <strong>{health.snapshotAsOf ?? 'No complete snapshot'}</strong>
          <small>
            Knowledge: {health.knowledgeStartAt ?? '—'} to {health.knowledgeEndAt ?? '—'}
          </small>
        </article>
        <article>
          <span>Reconciliation</span>
          <strong>{health.reconciliation ?? 'not available'}</strong>
          <small>
            Projection: {health.projection ?? 'not available'} · Change:{' '}
            {health.change ?? 'not available'}
          </small>
        </article>
      </section>

      {health.incompleteReason === null ? null : (
        <p className="notice">Aggregate projections are incomplete: {health.incompleteReason}.</p>
      )}

      <section className="panel" aria-labelledby="account-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Account observation</p>
            <h2 id="account-heading">Paper portfolio</h2>
          </div>
          <p className="caption">
            Alpaca paper broker marks are observed valuation data, not execution prices.
          </p>
        </div>
        {account === null ? (
          <p className="empty">No complete paper-account snapshot is available.</p>
        ) : (
          <dl className="metric-grid">
            <div>
              <dt>Cash ({account.currency})</dt>
              <dd>
                <ExactValue value={account.cash} />
              </dd>
            </div>
            <div>
              <dt>Equity</dt>
              <dd>
                <ExactValue value={account.equity} />
              </dd>
            </div>
            <div>
              <dt>Buying power</dt>
              <dd>
                <ExactValue value={account.buyingPower} />
              </dd>
            </div>
            <div>
              <dt>Day P&amp;L</dt>
              <dd>
                <ExactValue value={metrics?.dayProfitLoss ?? null} />
              </dd>
            </div>
            <div>
              <dt>Unrealized P&amp;L</dt>
              <dd>
                <ExactValue value={metrics?.unrealizedProfitLoss ?? null} />
              </dd>
            </div>
            <div>
              <dt>Gross exposure</dt>
              <dd>
                <ExactValue value={metrics?.grossExposure ?? null} />
              </dd>
            </div>
            <div>
              <dt>Net exposure</dt>
              <dd>
                <ExactValue value={metrics?.netExposure ?? null} />
              </dd>
            </div>
            <div>
              <dt>Gross exposure / equity</dt>
              <dd>
                <ExactValue value={metrics?.grossExposurePercent ?? null} suffix="%" />
              </dd>
            </div>
            <div>
              <dt>Concentration</dt>
              <dd>
                <ExactValue value={metrics?.concentrationPercent ?? null} suffix="%" />
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="panel" aria-labelledby="positions-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Observed holdings</p>
            <h2 id="positions-heading">Positions</h2>
          </div>
          <p className="caption">
            {snapshot.positions.length} position{snapshot.positions.length === 1 ? '' : 's'}
          </p>
        </div>
        {snapshot.positions.length === 0 ? (
          <p className="empty">No positions were observed.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Side / quantity</th>
                  <th>Broker mark</th>
                  <th>Market value</th>
                  <th>Unrealized P&amp;L</th>
                  <th>Allocation</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.positions.map((position, index) => (
                  <tr
                    key={`${position.symbol}:${position.venue ?? position.providerExchange}:${index}`}
                  >
                    <td>
                      <strong>{position.symbol}</strong>
                      <small>
                        {position.venue ?? position.providerExchange} · {position.assetClass} ·{' '}
                        {position.currency}
                      </small>
                    </td>
                    <td>
                      {position.side} <ExactValue value={position.quantity} />
                      <small>
                        available: <ExactValue value={position.quantityAvailable} />
                      </small>
                    </td>
                    <td>
                      <ExactValue value={position.currentPrice} />
                      <small>
                        average entry: <ExactValue value={position.averageEntryPrice} />
                      </small>
                    </td>
                    <td>
                      <ExactValue value={position.marketValue} />
                    </td>
                    <td>
                      <ExactValue value={position.unrealizedProfitLoss} />
                    </td>
                    <td>
                      <ExactValue value={position.allocationPercent} suffix="%" />
                      {position.projectionSupport === 'unsupported' ? (
                        <small className="warning">{position.unsupportedReason}</small>
                      ) : position.calculationState !== 'complete' ? (
                        <small className="warning">
                          {position.calculationUnavailableReason ?? 'calculation unavailable'}
                        </small>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="observations" aria-label="Observed broker activity">
        <div>
          <p>
            <strong>{snapshot.observedOrders.count}</strong> orders observed in this snapshot
          </p>
          <small>
            {Object.entries(snapshot.observedOrders.byStatus)
              .map(([status, count]) => `${status}: ${count}`)
              .join(' · ') || 'No observed order states'}
          </small>
        </div>
        <div>
          <p>
            <strong>{snapshot.observedFills.count}</strong> fills returned by this{' '}
            {snapshot.observedFills.initialBaseline === true
              ? 'bounded initial activity-created query'
              : 'bounded activity-created query'}
          </p>
          <small>
            Provider creation coverage (created after / before; both bounds exclusive):{' '}
            {snapshot.observedFills.createdAfterExclusive ?? 'unavailable'} to{' '}
            {snapshot.observedFills.createdBeforeExclusive ?? 'unavailable'} · Transaction time is
            separate · Not full account history · Latest execution time:{' '}
            {snapshot.observedFills.latestTransactionAt ?? 'not available'}
          </small>
        </div>
      </section>
    </>
  );
}

export function PortfolioDashboard({
  result,
}: {
  readonly result: PortfolioDashboardResult;
}): ReactNode {
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Daily Trader</p>
          <h1>Portfolio monitor</h1>
          <p className="lede">
            A deterministic, observed view of the configured Alpaca paper account.
          </p>
        </div>
        <div className="safety-badges" aria-label="Safety state">
          <strong>Paper</strong>
          <strong>Read only</strong>
          <strong>Execution disabled</strong>
        </div>
      </header>

      {result.state === 'unavailable' ? (
        <section className="unavailable" role="status">
          <h2>Portfolio API unavailable</h2>
          <p>
            The dashboard cannot read a current snapshot. No account identifiers, credentials, or
            cached financial values are shown.
          </p>
        </section>
      ) : (
        <Summary snapshot={result.snapshot} />
      )}
    </main>
  );
}

export default async function PortfolioStatusPage(): Promise<ReactNode> {
  const config = loadConfig();
  const result = await loadPortfolioDashboard({
    apiBaseUrl: buildPortfolioApiBaseUrl(config.api.host, config.api.port),
  });

  return <PortfolioDashboard result={result} />;
}
