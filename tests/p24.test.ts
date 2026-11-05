import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  registerPayment,
  verifyPayment,
  notificationSign,
  validNotification,
  sign,
  type Notification,
  p24Config,
} from '../src/lib/server/p24';
beforeEach(() => {
  Object.assign(process.env, {
    P24_ENV: 'sandbox',
    P24_MERCHANT_ID: '123',
    P24_POS_ID: '123',
    P24_CRC: 'crc-test',
    P24_API_KEY: 'api-test',
    SITE_URL: 'https://shop.example.test',
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.P24_PRODUCTION_APPROVED;
});
it('rejestruje transakcję w sandboxie przez Basic Auth z poprawnym podpisem', async () => {
  const request = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: { token: 'abc' }, responseCode: 0 }), { status: 200 }),
  );
  vi.stubGlobal('fetch', request);
  expect(
    await registerPayment(
      { id: 'session-1', total: 12300, email: 'test@example.test', name: 'Jan Test' },
      'access',
    ),
  ).toBe('abc');
  const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://sandbox.przelewy24.pl/api/v1/transaction/register');
  const payload = JSON.parse(options.body as string);
  expect(payload.amount).toBe(12300);
  expect(payload.sign).toBe(
    sign({
      sessionId: 'session-1',
      merchantId: 123,
      amount: 12300,
      currency: 'PLN',
      crc: 'crc-test',
    }),
  );
  expect(payload.urlStatus).toBe('https://shop.example.test/api/p24/notify');
  expect(options.method).toBe('POST');
});
it('weryfikuje podpis callbacku i odrzuca manipulację', () => {
  const n: Notification = {
    merchantId: 123,
    posId: 123,
    sessionId: 'session',
    amount: 100,
    originAmount: 100,
    currency: 'PLN',
    orderId: 1234,
    methodId: 1,
    statement: 'test',
    sign: '',
  };
  n.sign = notificationSign(n, 'crc-test');
  expect(validNotification(n)).toBe(true);
  expect(validNotification({ ...n, amount: 1 })).toBe(false);
  expect(validNotification({ ...n, posId: 1 })).toBe(false);
});
it('potwierdza płatność metodą PUT i odrzuca błąd API', async () => {
  const n: Notification = {
    merchantId: 123,
    posId: 123,
    sessionId: 'session',
    amount: 100,
    originAmount: 100,
    currency: 'PLN',
    orderId: 1234,
    methodId: 1,
    statement: 'test',
    sign: '',
  };
  const request = vi.fn(
    async () => new Response(JSON.stringify({ data: { status: 'success' }, responseCode: 0 })),
  );
  vi.stubGlobal('fetch', request);
  await verifyPayment(n);
  expect((request.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('PUT');
  vi.stubGlobal('fetch', async () => new Response('fail', { status: 500 }));
  await expect(verifyPayment(n)).rejects.toThrow();
});
it('blokuje produkcję bez jawnej zgody', () => {
  process.env.P24_ENV = 'production';
  expect(() => p24Config()).toThrow('Brak zgody');
});
