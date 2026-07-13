import { loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';

import { projectSignalsWorkerConfig } from '../config.js';
import { createPgSignalsPool } from '../persistence/pg-pool.js';
import { renderReplayInspection } from './inspection.js';
import { PostgresSignalReplayPersistencePort, ReplayPersistenceError } from './postgres-port.js';
import { runCheckedSignalReplay, verifyCheckedSignalReplayFixture } from './verifier.js';

interface ReplayFlags {
  readonly repeat: boolean;
  readonly interruptAfter: number | undefined;
  readonly restart: boolean;
}

function replayFlags(arguments_: readonly string[]): ReplayFlags {
  let interruptAfter: number | undefined;
  let repeat = false;
  let restart = false;
  for (const argument of arguments_) {
    if (argument === '--repeat') repeat = true;
    else if (argument === '--restart') restart = true;
    else if (argument.startsWith('--interrupt-after=')) {
      const raw = argument.slice('--interrupt-after='.length);
      if (!/^\d+$/u.test(raw)) throw new TypeError('invalid interruption count');
      interruptAfter = Number(raw);
      if (!Number.isSafeInteger(interruptAfter)) throw new TypeError('invalid interruption count');
    } else {
      throw new TypeError('unknown replay argument');
    }
  }
  if (restart && interruptAfter === undefined)
    throw new TypeError('--restart requires interruption');
  return { repeat, interruptAfter, restart };
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'recording:verify';
  if (command === 'recording:verify') {
    const projection = await verifyCheckedSignalReplayFixture();
    process.stdout.write(
      `${JSON.stringify({
        mode: 'REPLAY_RECORDING_VERIFY',
        targetId: projection.output.targetId,
        outputChecksum: projection.output.checksum,
        catalogEventCount: projection.output.catalogEventCount,
        scheduleEntryCount: projection.output.scheduleEntryCount,
        associationCount: projection.output.associations.length,
      })}\n`,
    );
    return;
  }

  loadOptionalEnvironmentFile();
  const config = projectSignalsWorkerConfig(loadConfig());
  const pool = createPgSignalsPool({
    connectionString: config.database.url,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    statementTimeoutMs: config.signal.operational.statementTimeoutMs,
  });
  try {
    if (command === 'replay') {
      const flags = replayFlags(process.argv.slice(3));
      const result = await runCheckedSignalReplay(pool, {
        repeat: flags.repeat,
        ...(flags.interruptAfter === undefined
          ? {}
          : { interruptAfterAssociations: flags.interruptAfter }),
        restartAfterInterruption: flags.restart,
      });
      process.stdout.write(
        `${JSON.stringify({
          mode: 'REPLAY',
          targetId: result.projection.output.targetId,
          state: result.inspection.state,
          cursor: result.inspection.cursor,
          repeated: result.repeated,
          restarted: result.restarted,
          outputChecksum: result.projection.output.checksum,
        })}\n${result.projection.serializedOutput}`,
      );
      return;
    }
    if (command === 'inspect') {
      const targetId = process.argv[3];
      if (targetId === undefined || process.argv.length !== 4) {
        throw new TypeError('inspect requires one target');
      }
      const inspection = await new PostgresSignalReplayPersistencePort(pool).inspectObservations(
        targetId,
      );
      process.stdout.write(renderReplayInspection(inspection));
      return;
    }
    throw new TypeError('usage: replay-cli recording:verify|replay|inspect');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const cause =
    error instanceof ReplayPersistenceError &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    typeof error.cause.code === 'string'
      ? error.cause.code
      : undefined;
  process.stderr.write(
    `${JSON.stringify({
      event: 'signal_replay.failed',
      code: error instanceof ReplayPersistenceError ? error.code : 'replay_failed',
      ...(cause === undefined ? {} : { databaseCode: cause }),
    })}\n`,
  );
  process.exitCode = 1;
});
