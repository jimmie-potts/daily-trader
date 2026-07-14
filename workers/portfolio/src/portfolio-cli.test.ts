import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closePool: vi.fn(() => Promise.resolve()),
}));

vi.mock('@daily-trader/config', () => ({
  loadConfig: (): Readonly<Record<string, never>> => Object.freeze({}),
  loadOptionalEnvironmentFile: (): void => undefined,
}));

vi.mock('./config.js', () => ({
  projectPortfolioWorkerConfig: () => ({
    database: {
      connectionTimeoutMs: 5_000,
      url: 'postgresql://fixture:fixture@localhost:5432/fixture',
    },
    portfolio: { operational: { requestTimeoutMs: 10_000 } },
  }),
}));

vi.mock('./persistence/pg-pool.js', () => ({
  createPgPortfolioPool: () => ({ end: mocks.closePool }),
}));

vi.mock('./persistence/repository.js', () => ({
  PortfolioRepository: class {
    public readStatus(): Promise<Readonly<Record<string, unknown>>> {
      return Promise.resolve({
        lifecycle: 'degraded',
        failureCode: 'provider_transport',
        heartbeatAt: '2026-07-13T13:31:02.500Z',
        leaseExpiresAt: '2026-07-13T13:31:12.500Z',
        leaseState: 'expired',
        lastSyncStartedAt: '2026-07-13T13:31:00.000Z',
        lastSyncCompletedAt: '2026-07-13T13:30:00.000Z',
        currentSyncRunId: 'portfolio-sync-internal-only',
        currentSnapshotAt: '2026-07-13T13:30:01.000Z',
        projectionState: 'complete',
        reconciliationState: 'converged',
        changeState: 'unchanged',
        positionCount: 2,
        orderCount: 1,
        fillCount: 1,
        accountId: 'raw-account-must-not-escape',
        ownerId: 'worker-owner-must-not-escape',
        fenceToken: 'worker-fence-must-not-escape',
        apiSecret: 'secret-must-not-escape',
      });
    }
  },
}));

const originalArguments = [...process.argv];
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArguments);
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('portfolio status CLI', () => {
  it('renders only bounded read-only paper status without internal or broker identifiers', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk): boolean => {
      chunks.push(String(chunk));
      return true;
    });
    const errorChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk): boolean => {
      errorChunks.push(String(chunk));
      return true;
    });
    process.argv[2] = 'status';

    await import('./portfolio-cli.js');

    expect(errorChunks).toEqual([]);
    expect(mocks.closePool).toHaveBeenCalledOnce();
    expect(chunks).toHaveLength(1);
    const output = JSON.parse(chunks[0]!) as Readonly<Record<string, unknown>>;
    expect(output).toEqual({
      access: 'read_only',
      changeState: 'unchanged',
      currentSnapshotAt: '2026-07-13T13:30:01.000Z',
      environment: 'paper',
      executionEnabled: false,
      failureCode: 'provider_transport',
      fillCount: 1,
      heartbeatAt: '2026-07-13T13:31:02.500Z',
      lastSyncCompletedAt: '2026-07-13T13:30:00.000Z',
      lastSyncStartedAt: '2026-07-13T13:31:00.000Z',
      leaseExpiresAt: '2026-07-13T13:31:12.500Z',
      leaseState: 'expired',
      lifecycle: 'degraded',
      orderCount: 1,
      positionCount: 2,
      projectionState: 'complete',
      reconciliationState: 'converged',
    });
    expect(JSON.stringify(output)).not.toMatch(
      /account|apiSecret|fence|internal-only|owner|secret-must/u,
    );
  });
});
