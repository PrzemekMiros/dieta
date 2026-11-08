import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env, required, siteUrl } from './env';
export const notificationSchema = z.object({
  merchantId: z.number().int().positive(),
  posId: z.number().int().positive(),
  sessionId: z.string().max(100),
  amount: z.number().int().positive(),
  originAmount: z.number().int().positive(),
  currency: z.literal('PLN'),
  orderId: z.number().int().positive().refine(Number.isSafeInteger),
  methodId: z.number().int(),
  statement: z.string().max(300),
  sign: z.string().regex(/^[a-fA-F0-9]{96}$/),
});
export type Notification = z.infer<typeof notificationSchema>;
export const sign = (data: Record<string, unknown>) =>
  createHash('sha384').update(JSON.stringify(data)).digest('hex');
export function p24Config() {
  const production = env('P24_ENV', 'sandbox') === 'production';
  if (production && env('P24_PRODUCTION_APPROVED') !== 'true')
    throw new Error('Brak zgody na płatności produkcyjne.');
  const merchantId = Number(required('P24_MERCHANT_ID')),
    posId = Number(required('P24_POS_ID'));
  if (
    !Number.isSafeInteger(merchantId) ||
    merchantId <= 0 ||
    !Number.isSafeInteger(posId) ||
    posId <= 0
  )
    throw new Error('Niepoprawne identyfikatory P24');
  return {
    merchantId,
    posId,
    crc: required('P24_CRC'),
    apiKey: required('P24_API_KEY'),
    base: production ? 'https://secure.przelewy24.pl' : 'https://sandbox.przelewy24.pl',
  };
}
export function notificationSign(n: Omit<Notification, 'sign'>, crc: string) {
  return sign({
    merchantId: n.merchantId,
    posId: n.posId,
    sessionId: n.sessionId,
    amount: n.amount,
    originAmount: n.originAmount,
    currency: n.currency,
    orderId: n.orderId,
    methodId: n.methodId,
    statement: n.statement,
    crc,
  });
}
export function validNotification(n: Notification) {
  const c = p24Config();
  const expected = Buffer.from(notificationSign(n, c.crc), 'hex');
  const received = Buffer.from(n.sign, 'hex');
  return (
    n.merchantId === c.merchantId &&
    n.posId === c.posId &&
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}
async function request(path: string, method: string, body?: unknown) {
  const c = p24Config();
  const response = await fetch(`${c.base}/api/v1/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.posId}:${c.apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`P24 ${path}: HTTP ${response.status}`);
  return response.json();
}
export async function registerPayment(
  order: { id: string; total: number; email: string; name: string },
  access: string,
) {
  const c = p24Config();
  if (!siteUrl().startsWith('https://'))
    throw new Error('Callback P24 wymaga publicznej domeny HTTPS.');
  const payload = {
    merchantId: c.merchantId,
    posId: c.posId,
    sessionId: order.id,
    amount: order.total,
    currency: 'PLN',
    description: `Tortowe Ciocho ${order.id}`,
    email: order.email,
    client: order.name.slice(0, 40),
    country: 'PL',
    language: 'pl',
    urlReturn: `${siteUrl()}/zamowienie/sukces?token=${access}`,
    urlStatus: `${siteUrl()}/api/p24/notify`,
    timeLimit: 30,
    encoding: 'UTF-8',
    sign: sign({
      sessionId: order.id,
      merchantId: c.merchantId,
      amount: order.total,
      currency: 'PLN',
      crc: c.crc,
    }),
  };
  const result = await request('transaction/register', 'POST', payload);
  const parsed = z
    .object({ data: z.object({ token: z.string().min(1) }), responseCode: z.literal(0) })
    .parse(result);
  return parsed.data.token;
}
export async function verifyPayment(n: Notification) {
  const c = p24Config();
  const result = await request('transaction/verify', 'PUT', {
    merchantId: c.merchantId,
    posId: c.posId,
    sessionId: n.sessionId,
    amount: n.amount,
    currency: n.currency,
    orderId: n.orderId,
    sign: sign({
      sessionId: n.sessionId,
      orderId: n.orderId,
      amount: n.amount,
      currency: n.currency,
      crc: c.crc,
    }),
  });
  if (result?.data?.status !== 'success' || result.responseCode !== 0)
    throw new Error('P24 nie potwierdziło weryfikacji.');
}
export const paymentUrl = (value: string) =>
  `${p24Config().base}/trnRequest/${encodeURIComponent(value)}`;
export async function lookupPayment(sessionId: string) {
  const result = await request(`transaction/by/sessionId/${encodeURIComponent(sessionId)}`, 'GET');
  return z
    .object({
      data: z.object({
        sessionId: z.string(),
        orderId: z.number().int().refine(Number.isSafeInteger),
        status: z.number().int(),
        amount: z.number().int(),
        currency: z.string(),
        paymentMethod: z.number().int(),
        statement: z.string(),
      }),
      responseCode: z.literal(0),
    })
    .parse(result).data;
}
