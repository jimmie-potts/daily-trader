import { ConfigurationError, loadConfig, loadOptionalEnvironmentFile } from '@daily-trader/config';

loadOptionalEnvironmentFile();

try {
  loadConfig();
} catch (error) {
  const event =
    error instanceof ConfigurationError
      ? { event: 'configuration.invalid', issues: error.issues }
      : { code: 'CONFIGURATION_VALIDATION_FAILED', event: 'configuration.invalid' };
  process.stderr.write(`${JSON.stringify(event)}\n`);
  process.exitCode = 1;
}
