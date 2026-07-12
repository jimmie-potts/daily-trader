import { spawnSync } from 'node:child_process';

const composeArguments = ['compose', '-f', 'infrastructure/compose.yaml', ...process.argv.slice(2)];
const candidates = process.env.WSL_DISTRO_NAME ? ['docker.exe', 'docker'] : ['docker'];

for (const command of candidates) {
  const result = spawnSync(command, composeArguments, { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    continue;
  }
  if (result.error !== undefined) {
    process.stderr.write('Docker Compose could not be started.\n');
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
  break;
}

if (process.exitCode === undefined) {
  process.stderr.write('Docker was not found. Install Docker with Compose v2.\n');
  process.exitCode = 1;
}
