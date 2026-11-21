import { expect, it } from 'vitest';
import { serviceError } from '../src/lib/server/service-error';

it.each(['SMTP_HOST', 'SMTP_FROM', 'SMTP_PASSWORD'])('identifies missing %s without its value', (key) => {
  expect(serviceError(new Error(`Brak konfiguracji: ${key}`))).toEqual({
    reason: 'mail_not_configured', configuration: key,
  });
});

it('logs upstream status without SDK messages, tokens or customer payloads', () => {
  const error = new Error('private customer', {
    cause: { statusCode: 403, message: 'secret token', response: { body: 'customer address' } },
  });
  expect(serviceError(error)).toEqual({ reason: 'upstream_service_error', upstreamStatus: 403 });
});

it('ignores unknown configuration and handles circular causes', () => {
  expect(serviceError(new Error('Brak konfiguracji: PRIVATE_SECRET'))).toBeUndefined();
  const error: { cause?: unknown } = {};
  error.cause = error;
  expect(serviceError(error)).toBeUndefined();
  expect(serviceError(null)).toBeUndefined();
});
