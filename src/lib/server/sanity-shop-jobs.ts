import nodemailer from 'nodemailer';
import { privateOrdersClient, conflict, unseal } from './shop-storage';
import { env, required } from './env';
import { hash, HttpError } from './security';
import type { SanityDocument } from '@sanity/client';
import type { ShopMail, MailPayload } from './sanity-orders';

export async function sanityLimited(key: string, max = 10, seconds = 60) {
  const client = await privateOrdersClient();
  // One deterministic control document per rate-limit subject. Expired
  // documents are reused rather than creating one document per request.
  const id = `limit.${hash(key)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await client.getDocument<SanityDocument & { count: number; resetAt: number }>(id);
    const expired = !row || row.resetAt <= Date.now();
    if (!expired && row.count >= max) throw new HttpError(429, 'Za dużo prób. Spróbuj za chwilę.');
    const values = {
      count: expired ? 1 : row.count + 1,
      resetAt: expired ? Date.now() + seconds * 1000 : row.resetAt,
    };
    try {
      if (row)
        await client.patch(id).ifRevisionId(row._rev).set(values).commit({ visibility: 'sync' });
      else
        await client.create({ _id: id, _type: 'shopRateLimit', ...values }, { visibility: 'sync' });
      return;
    } catch (error) {
      if (!conflict(error)) throw error;
    }
  }
  throw new HttpError(429, 'Za dużo równoczesnych prób. Spróbuj za chwilę.');
}

export async function processSanityOutbox() {
  const client = await privateOrdersClient();
  const timestamp = new Date().toISOString();
  const ids = await client.fetch<string[]>(
    `*[_type == "shopMail" && sentAt == null && attempts < 12 &&
    nextAttempt <= $now && (leaseUntil == null || leaseUntil <= $now)] | order(nextAttempt asc)[0...5]._id`,
    { now: timestamp },
  );
  if (!ids.length) return 0;
  const transport = nodemailer.createTransport({
    host: required('SMTP_HOST'),
    port: Number(env('SMTP_PORT', '587')),
    secure: env('SMTP_SECURE') === 'true',
    auth: env('SMTP_USER')
      ? { user: env('SMTP_USER'), pass: required('SMTP_PASSWORD') }
      : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  });
  let count = 0;
  const started = Date.now();
  try {
    for (const id of ids) {
      if (Date.now() - started > 10000) break;
      const row = await client.getDocument<ShopMail>(id);
      if (!row || row.sentAt || (row.leaseUntil && row.leaseUntil > new Date().toISOString()))
        continue;
      let leased: ShopMail;
      try {
        leased = await client
          .patch(id)
          .ifRevisionId(row._rev)
          .set({
            leaseUntil: new Date(Date.now() + 120000).toISOString(),
            attempts: row.attempts + 1,
          })
          .commit<ShopMail>({ visibility: 'sync' });
      } catch (error) {
        if (conflict(error)) continue;
        throw error;
      }
      const payload = unseal<MailPayload>(leased.payload, id);
      try {
        await transport.sendMail({
          from: required('SMTP_FROM'),
          ...payload,
          messageId: `<${id}@${env('MAIL_MESSAGE_DOMAIN', 'dietetykadlasmyka.pl')}>`,
        });
      } catch {
        await client
          .patch(id)
          .ifRevisionId(leased._rev)
          .set({
            leaseUntil: null,
            nextAttempt: new Date(
              Date.now() + Math.min(86400, 60 * 2 ** row.attempts) * 1000,
            ).toISOString(),
          })
          .commit();
        continue;
      }
      // SMTP is at-least-once: if this acknowledgement fails after delivery,
      // a retry uses the same Message-ID. Never mark failed delivery as sent.
      await client
        .patch(id)
        .ifRevisionId(leased._rev)
        .set({ sentAt: new Date().toISOString(), leaseUntil: null })
        .commit();
      count++;
    }
  } finally {
    transport.close();
  }
  return count;
}
