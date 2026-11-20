import { env, isDemo } from './env';

// Tpay is the target provider. Its adapter and verified notifications must be
// implemented before enabling it; SALES_ENABLED alone must not launch old P24.
export function legacyOnlinePaymentsAvailable() {
  return !isDemo() && env('PAYMENT_PROVIDER', 'tpay') === 'p24' && env('SALES_ENABLED') === 'true';
}
