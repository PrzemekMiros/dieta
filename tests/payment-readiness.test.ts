import { afterEach, expect, it, vi } from 'vitest';
import { legacyOnlinePaymentsAvailable } from '../src/lib/server/payment-readiness';

afterEach(() => vi.unstubAllEnvs());

it('does not activate P24 when preparing Tpay, even if sales are enabled', () => {
  vi.stubEnv('DEMO_CATALOG', 'false');
  vi.stubEnv('SALES_ENABLED', 'true');
  vi.stubEnv('PAYMENT_PROVIDER', 'tpay');
  expect(legacyOnlinePaymentsAvailable()).toBe(false);
  vi.stubEnv('PAYMENT_PROVIDER', '');
  expect(legacyOnlinePaymentsAvailable()).toBe(false);
});

it('allows the existing provider only when explicitly configured, outside demo', () => {
  vi.stubEnv('DEMO_CATALOG', 'false');
  vi.stubEnv('SALES_ENABLED', 'true');
  vi.stubEnv('PAYMENT_PROVIDER', 'p24');
  expect(legacyOnlinePaymentsAvailable()).toBe(true);
  vi.stubEnv('SALES_ENABLED', 'false');
  expect(legacyOnlinePaymentsAvailable()).toBe(false);
  vi.stubEnv('SALES_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('DEMO_CATALOG', 'true');
  expect(legacyOnlinePaymentsAvailable()).toBe(false);
});
