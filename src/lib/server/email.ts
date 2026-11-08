import nodemailer from 'nodemailer';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { db, type Tx } from './db';
import { emailOutbox } from './schema';
import { env, required } from './env';
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function emailTemplate(title: string, body: string) {
  return `<!doctype html><html lang="pl"><body style="margin:0;background:#f7f6f4;color:#2d2f30;font-family:Arial,sans-serif"><div style="max-width:580px;margin:40px auto;padding:40px;background:#fff"><p style="font-family:Georgia,serif;letter-spacing:2px">TORTOWE CIOCHO</p><h1 style="font:32px Georgia,serif">${escapeHtml(title)}</h1>${body}<hr style="border:0;border-top:1px solid #e5ded7;margin:32px 0"><p style="font-size:12px;color:#646464">Dziękujemy za wspólne słodkie chwile.<br>Tortowe Ciocho</p></div></body></html>`;
}
export async function enqueue(tx: Tx, key: string, to: string, subject: string, body: string) {
  await tx
    .insert(emailOutbox)
    .values({ key, to, subject, html: emailTemplate(subject, body) })
    .onConflictDoNothing();
}
export async function processOutbox() {
  const transport = nodemailer.createTransport({
    host: required('SMTP_HOST'),
    port: Number(env('SMTP_PORT', '587')),
    secure: env('SMTP_SECURE') === 'true',
    auth: env('SMTP_USER')
      ? { user: env('SMTP_USER'), pass: required('SMTP_PASSWORD') }
      : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });
  let count = 0;
  for (let i = 0; i < 25; i++) {
    const found = await db().transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(emailOutbox)
        .where(
          and(
            isNull(emailOutbox.sentAt),
            lte(emailOutbox.nextAttempt, new Date()),
            sql`${emailOutbox.attempts}<12`,
          ),
        )
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return false;
      try {
        await transport.sendMail({
          from: required('SMTP_FROM'),
          to: row.to,
          subject: row.subject,
          html: row.html,
          messageId: `<${row.id}@${env('MAIL_MESSAGE_DOMAIN', 'tortowe.local')}>`,
        });
        await tx
          .update(emailOutbox)
          .set({ sentAt: new Date(), lastError: null })
          .where(eq(emailOutbox.id, row.id));
      } catch {
        await tx
          .update(emailOutbox)
          .set({
            attempts: row.attempts + 1,
            lastError: 'SMTP delivery failed',
            nextAttempt: new Date(Date.now() + Math.min(86400, 60 * 2 ** row.attempts) * 1000),
          })
          .where(eq(emailOutbox.id, row.id));
      }
      return true;
    });
    if (!found) break;
    count++;
  }
  transport.close();
  return count;
}
