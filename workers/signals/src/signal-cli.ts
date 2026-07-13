import { randomUUID } from 'node:crypto';

import { loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';
import { createLogger, getMeter } from '@daily-trader/observability';

import { projectSignalsWorkerConfig } from './config.js';
import { createPgSignalsPool } from './persistence/pg-pool.js';
import { SignalsRepository } from './persistence/repository.js';
import { drainClaim } from './runtime.js';
import { renderSignalStatus } from './status.js';
import { SystemClock } from './system-clock.js';

async function closePoolWithin(
  pool: ReturnType<typeof createPgSignalsPool>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const completed = await Promise.race([
    pool.end().then(
      () => true,
      () => false,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (!completed) await pool.destroy();
}

async function main(): Promise<void> {
  loadOptionalEnvironmentFile();
  const config = projectSignalsWorkerConfig(loadConfig());
  const pool = createPgSignalsPool({
    connectionString: config.database.url,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.signal.operational.statementTimeoutMs,
  });
  const repository = new SignalsRepository(pool, `signal-cli-${randomUUID()}`);
  const clock = new SystemClock();
  try {
    const command = process.argv[2] ?? 'status';
    if (command === 'status') {
      process.stdout.write(
        renderSignalStatus(await repository.status(), clock, config.worker.heartbeatIntervalMs * 2),
      );
      return;
    }
    if (command === 'disable') {
      let claim = await repository.disable(clock, config.signal.operational.claimLeaseMs);
      while (claim !== null) {
        await drainClaim(
          {
            repository,
            clock,
            logger: createLogger({
              environment: config.environment,
              level: config.runtime.logLevel,
              serviceName: 'daily-trader-signals-worker',
            }),
            meter: getMeter('daily-trader-signals-worker'),
          },
          claim,
          new AbortController().signal,
        );
        claim = await repository.disable(clock, config.signal.operational.claimLeaseMs);
      }
      await repository.heartbeat(null, 'disabled', clock);
      process.stdout.write('Signal monitoring disabled; captured journal debt drained.\n');
      return;
    }
    throw new TypeError('usage: signal-cli status|disable');
  } finally {
    await closePoolWithin(pool, config.signal.operational.shutdownTimeoutMs);
  }
}

void main().catch(() => {
  process.stderr.write('{"event":"signals_cli.failed"}\n');
  process.exitCode = 1;
});
