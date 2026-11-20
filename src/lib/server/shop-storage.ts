import { createClient, type SanityClient } from '@sanity/client';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from './env';
import { HttpError } from './security';

export const usesSanityOrders = () => env('SHOP_STORAGE', 'sanity') === 'sanity';

export function ordersClient(): SanityClient {
  const token = env('SANITY_ORDERS_TOKEN');
  const dataset = env('SANITY_ORDERS_DATASET', 'orders');
  if (!token) throw new HttpError(503, 'Skonfiguruj SANITY_ORDERS_TOKEN w Netlify (Functions).');
  if (dataset === env('SANITY_DATASET', 'production'))
    throw new HttpError(503, 'Zamówienia wymagają osobnego, prywatnego zbioru Sanity.');
  return createClient({
    projectId: env('SANITY_PROJECT_ID', 'fip0o8g2'),
    dataset,
    apiVersion: '2026-11-05',
    token,
    useCdn: false,
    perspective: 'published',
    timeout: 15000,
    maxRetries: 0,
  });
}

// Verify visibility before reads and writes; never silently fall back to the
// public catalog. Private datasets can change visibility outside this app.
export async function privateOrdersClient() {
  const client = ordersClient();
  const datasets = await client.datasets.list();
  if (datasets.find((d) => d.name === client.config().dataset)?.aclMode !== 'private')
    throw new HttpError(503, 'Zbiór zamówień Sanity musi mieć widoczność private.');
  return client;
}

function encryptionKey() {
  const value = env('SANITY_ORDERS_ENCRYPTION_KEY');
  if (!/^[a-f\d]{64}$/i.test(value))
    throw new HttpError(503, 'Skonfiguruj SANITY_ORDERS_ENCRYPTION_KEY (64 znaki hex) w Netlify.');
  return Buffer.from(value, 'hex');
}

// Even project members reading the private dataset cannot read customer data
// without the server-only key. The authenticated context prevents swapping
// encrypted fields between orders or messages.
export function seal(value: unknown, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}
export function unseal<T>(value: string, context: string): T {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv!);
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(tag!);
  return JSON.parse(Buffer.concat([cipher.update(ciphertext!), cipher.final()]).toString('utf8'));
}

export function conflict(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 409
  );
}
export async function retryConflict<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!conflict(error)) throw error;
      if (attempt >= 4)
        throw new HttpError(409, 'Zamówienie zmieniło się. Odśwież i spróbuj ponownie.');
    }
  }
}
