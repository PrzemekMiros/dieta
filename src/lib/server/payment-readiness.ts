import { env, isDemo } from './env';

// Online payments stay disabled until the Tpay adapter and verified notifications are implemented.
// Environment flags alone must never enable an unfinished payment integration.
export function onlinePaymentsAvailable(): boolean {
  return false;
}

// Physical orders can use cash on delivery while online payments are being prepared.
export function cashOnDeliveryAvailable() {
  return !isDemo() && env('COD_ENABLED', 'true') === 'true';
}
