import { afterEach, expect, it, vi } from 'vitest';
import {
  cashOnDeliveryAvailable,
  onlinePaymentsAvailable,
} from '../src/lib/server/payment-readiness';

afterEach(() => vi.unstubAllEnvs());

it('does not activate P24 when preparing Tpay, even if sales are enabled', () => {
  vi.stubEnv('DEMO_CATALOG', 'false');
  vi.stubEnv('SALES_ENABLED', 'true');
  vi.stubEnv('PAYMENT_PROVIDER', 'tpay');
  expect(onlinePaymentsAvailable()).toBe(false);
  vi.stubEnv('PAYMENT_PROVIDER', 'p24');
  expect(onlinePaymentsAvailable()).toBe(false);
  vi.stubEnv('PAYMENT_PROVIDER', '');
  expect(onlinePaymentsAvailable()).toBe(false);
});

it('enables cash on delivery by default without online payments', () => {
  vi.stubEnv('DEMO_CATALOG', 'false');
  vi.stubEnv('COD_ENABLED', undefined);
  vi.stubEnv('SALES_ENABLED', 'false');
  vi.stubEnv('PAYMENT_PROVIDER', 'tpay');
  expect(cashOnDeliveryAvailable()).toBe(true);
  expect(onlinePaymentsAvailable()).toBe(false);
});

it('respects an explicit cash on delivery shutdown and demo mode', () => {
  vi.stubEnv('DEMO_CATALOG', 'false');
  vi.stubEnv('COD_ENABLED', 'false');
  expect(cashOnDeliveryAvailable()).toBe(false);
  vi.stubEnv('COD_ENABLED', 'true');
  expect(cashOnDeliveryAvailable()).toBe(true);
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('DEMO_CATALOG', 'true');
  expect(cashOnDeliveryAvailable()).toBe(false);
});
