import { describe, expect, it } from 'vitest';

import { createLogger, sanitizeLogFields } from './logger.js';

describe('createLogger', () => {
  it('emits stable JSON identity, severity, timestamp, and correlation fields', () => {
    const chunks: string[] = [];
    const logger = createLogger({
      environment: 'test',
      serviceName: 'test-service',
      sink: { write: (chunk) => chunks.push(chunk) },
    });

    logger.info('process.healthy', { correlationId: 'correlation-1' });

    const event = JSON.parse(chunks.join('')) as Record<string, unknown>;
    expect(event).toMatchObject({
      correlationId: 'correlation-1',
      environment: 'test',
      event: 'process.healthy',
      service: 'test-service',
      severity: 'info',
    });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts nested secrets, account identifiers, and complete provider payloads', () => {
    expect(
      sanitizeLogFields({
        accountId: 'account-123',
        accountNumber: 'account-number-123',
        nested: { apiToken: 'token-123', safe: 'visible' },
        providerPayload: { price: '10', symbol: 'AAPL' },
        providerResponse: { raw: 'sensitive' },
        rawPayload: { account: 'sensitive' },
        websocketUrl: 'wss://user:secret@provider.example/private',
      }),
    ).toEqual({
      accountId: '[REDACTED]',
      accountNumber: '[REDACTED]',
      nested: { apiToken: '[REDACTED]', safe: 'visible' },
      providerPayload: '[REDACTED]',
      providerResponse: '[REDACTED]',
      rawPayload: '[REDACTED]',
      websocketUrl: '[REDACTED]',
    });
  });
});
