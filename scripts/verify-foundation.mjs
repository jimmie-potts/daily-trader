import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runScript(name) {
  const result = spawnSync(npmCommand, ['run', name], { stdio: 'inherit' });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`Foundation step failed: ${name}`);
  }
}

let servicesAttempted = false;
let failed = false;

try {
  runScript('ci');
  servicesAttempted = true;
  runScript('services:up');
  runScript('services:check');
  runScript('smoke');
} catch (error) {
  failed = true;
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Foundation verification failed'}\n`,
  );
} finally {
  if (servicesAttempted) {
    try {
      runScript('services:stop');
    } catch {
      failed = true;
      process.stderr.write('Foundation cleanup failed: services:stop\n');
    }
  }
}

process.exitCode = failed ? 1 : 0;
