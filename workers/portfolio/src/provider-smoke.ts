import { loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import {
  preparePortfolioProjection,
  projectPortfolioSnapshot,
  reconcilePortfolioProjection,
} from '@daily-trader/portfolio';

import { projectPortfolioWorkerConfig } from './config.js';
import { AlpacaPaperPortfolioProvider, type AlpacaFetch } from './providers/alpaca/index.js';
import { SystemClock } from './system-clock.js';

const nativeFetch: AlpacaFetch = async (input, init) =>
  fetch(input, {
    headers: init.headers,
    method: init.method,
    redirect: init.redirect,
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });

loadOptionalEnvironmentFile();
const config = projectPortfolioWorkerConfig(loadConfig());
const { apiKey, apiSecret, expectedAccountId } = config.portfolio;
if (
  config.portfolio.mode !== 'paper_read_only' ||
  apiKey === undefined ||
  apiSecret === undefined ||
  expectedAccountId === undefined
) {
  process.stderr.write(
    `${JSON.stringify({ event: 'portfolio.provider_smoke.failed', code: 'CONFIGURATION_REQUIRED' })}\n`,
  );
  process.exit(1);
}

const controller = new AbortController();
const timer = setTimeout(
  () => controller.abort(new Error('portfolio provider smoke deadline')),
  config.portfolio.operational.requestTimeoutMs,
);
try {
  const clock = new SystemClock();
  const provider = new AlpacaPaperPortfolioProvider(
    {
      apiKey,
      apiSecret,
      expectedAccountId,
      maxResponseBytes: config.portfolio.operational.maxResponseBytes,
      orderPageSize: config.portfolio.operational.orderPageSize,
      fillPageSize: config.portfolio.operational.fillPageSize,
      maxOrderPages: config.portfolio.operational.maxPages,
      maxFillPages: config.portfolio.operational.maxPages,
      maxPositions: config.portfolio.operational.maxPositions,
      maxOrders: config.portfolio.operational.maxOrders,
      maxFills: config.portfolio.operational.maxFillsPerSync,
    },
    { clock, fetch: nativeFetch },
  );
  const snapshot = await provider.capture({
    previousActivityCutoverAt: null,
    signal: controller.signal,
  });
  const structuralPrepared = preparePortfolioProjection(snapshot, null);
  const basisReconciliation = reconcilePortfolioProjection(snapshot, structuralPrepared, null);
  const projection = projectPortfolioSnapshot(snapshot, basisReconciliation);
  const prepared = preparePortfolioProjection(snapshot, projection.projectionId);
  const reconciliation = reconcilePortfolioProjection(snapshot, prepared, projection.projectionId);
  if (reconciliation.status !== 'converged') throw new Error('provider smoke did not converge');
  process.stdout.write(
    `${JSON.stringify({
      event: 'portfolio.provider_smoke.passed',
      executionEnabled: false,
      fillCount: snapshot.fills.length,
      method: 'GET',
      orderCount: snapshot.orders.length,
      positionCount: snapshot.positions.length,
      projectionState: projection.state,
      reconciliationState: reconciliation.status,
      resourceCount: 4,
      status: 'passed',
    })}\n`,
  );
} catch {
  process.stderr.write(
    `${JSON.stringify({ event: 'portfolio.provider_smoke.failed', code: 'PROVIDER_SMOKE_FAILED' })}\n`,
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
