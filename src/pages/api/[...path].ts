import type { APIRoute } from 'astro';
import { z, ZodError } from 'zod';
import { and, eq, sql, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  json,
  HttpError,
  readJson,
  sameOrigin,
  limited,
  hash,
  token,
  passwordMatches,
  session,
} from '../../lib/server/security';
import { env, isDemo, siteUrl } from '../../lib/server/env';
import { db } from '../../lib/server/db';
import * as t from '../../lib/server/schema';
import { products } from '../../lib/catalog';
import { cartSchema, checkoutSchema } from '../../lib/server/checkout-input';
import { calculate } from '../../lib/server/pricing';
import { createOrder, acceptPayment, cancelOrder, resendLinks } from '../../lib/server/orders';
import { notificationSchema, validNotification } from '../../lib/server/p24';
import { enqueue, escapeHtml } from '../../lib/server/email';
import { signedDownload } from '../../lib/server/digital';
import {
  availableBookingTimes,
  bookingDateSchema,
  bookingInputSchema,
  createBooking,
} from '../../lib/server/bookings';
export const ALL: APIRoute = async (ctx) => {
  const { request, params, cookies, url } = ctx;
  const path = params.path;
  let ip = 'unknown';
  try {
    ip = ctx.clientAddress;
  } catch {
    /* Adapter may not expose an address in tests. */
  }
  try {
    if (request.method === 'GET') {
      if (path === 'status') {
        const access = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(url.searchParams.get('token'));
        const [order] = await db()
          .select({ id: t.orders.id, status: t.orders.status, total: t.orders.total })
          .from(t.orders)
          .where(eq(t.orders.accessHash, hash(access)));
        if (!order) throw new HttpError(404, 'Nie znaleziono zamówienia.');
        return json(order);
      }
      if (path === 'download') {
        const access = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(url.searchParams.get('token'));
        await limited(`download:${hash(access)}`, 20, 3600);
        return ctx.redirect(await signedDownload(access), 302);
      }
      if (path === 'booking/availability') {
        await limited(`booking-availability:${ip}`, 120, 3600);
        const date = bookingDateSchema.parse(url.searchParams.get('date'));
        return json(await availableBookingTimes(date));
      }
      if (path === 'newsletter/confirm' || path === 'newsletter/unsubscribe') {
        const raw = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(url.searchParams.get('token'));
        const confirm = path.endsWith('confirm');
        const changed = await db()
          .update(t.newsletter)
          .set({ status: confirm ? 'active' : 'unsubscribed' })
          .where(
            confirm
              ? and(eq(t.newsletter.confirmHash, hash(raw)), eq(t.newsletter.status, 'pending'))
              : eq(t.newsletter.unsubscribeHash, hash(raw)),
          )
          .returning();
        return new Response(
          changed.length
            ? confirm
              ? 'Zapis potwierdzony. Dziękujemy!'
              : 'Zapis anulowany. Nie będziemy wysyłać newslettera.'
            : 'Link jest nieaktywny lub został już wykorzystany.',
          { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
        );
      }
      throw new HttpError(404, 'Nie znaleziono zasobu.');
    }
    if (request.method !== 'POST') throw new HttpError(405, 'Niedozwolona metoda.');
    if (path === 'p24/notify') {
      const n = notificationSchema.parse(await readJson(request));
      if (!validNotification(n)) throw new HttpError(400, 'Niepoprawny podpis.');
      await acceptPayment(n);
      return json({ ok: true });
    }
    sameOrigin(request);
    const body = await readJson(request);
    if (path === 'quote') {
      const input = z
        .object({ items: cartSchema, shippingMethod: z.string().optional() })
        .parse(body);
      const catalog = await products(true);
      if (!isDemo()) {
        const stock = await db().select().from(t.inventory);
        catalog.forEach((p) => {
          if (p.productType === 'physical')
            p.stock = stock.find((s) => s.productId === p._id)?.available || 0;
        });
      }
      const q = calculate(input.items, catalog, input.shippingMethod);
      // Private asset keys never leave the server.
      return json({
        ...q,
        lines: q.lines.map(({ _id, name, slug, image, price, quantity, productType, stock }) => ({
          _id,
          name,
          slug,
          image,
          price,
          quantity,
          productType,
          stock,
        })),
      });
    }
    if (path === 'checkout') {
      if (env('SALES_ENABLED') !== 'true' || isDemo())
        throw new HttpError(503, 'Sklep nie przyjmuje jeszcze zamówień.');
      await limited(`checkout:${ip}`, 8, 300);
      return json(await createOrder(checkoutSchema.parse(body)));
    }
    if (path === 'newsletter') {
      if (env('NEWSLETTER_ENABLED') !== 'true')
        throw new HttpError(503, 'Zapisy do newslettera zostaną uruchomione wkrótce.');
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          consent: z.literal(true),
        })
        .parse(body);
      await limited(`newsletter:${ip}`, 5, 3600);
      const confirm = token(),
        unsubscribe = token();
      await db().transaction(async (tx) => {
        const [previous] = await tx
          .select()
          .from(t.newsletter)
          .where(eq(t.newsletter.email, input.email));
        if (previous?.status === 'active') return;
        await tx
          .insert(t.newsletter)
          .values({
            name: input.name,
            email: input.email,
            confirmHash: hash(confirm),
            unsubscribeHash: hash(unsubscribe),
          })
          .onConflictDoUpdate({
            target: t.newsletter.email,
            set: {
              name: input.name,
              status: 'pending',
              confirmHash: hash(confirm),
              unsubscribeHash: hash(unsubscribe),
            },
          });
        await enqueue(
          tx,
          `newsletter:${randomUUID()}`,
          input.email,
          'Potwierdź zapis do słodkich listów',
          `<p>Cześć ${escapeHtml(input.name)}!</p><p><a href="${siteUrl()}/api/newsletter/confirm?token=${confirm}">Potwierdzam zapis</a></p><p><a href="${siteUrl()}/api/newsletter/unsubscribe?token=${unsubscribe}">Rezygnuję z zapisu</a></p>`,
        );
      });
      return json({
        message:
          'Sprawdź skrzynkę i potwierdź zapis. Jeśli masz już aktywną subskrypcję, nic się nie zmieni.',
      });
    }
    if (path === 'booking') {
      await limited(`booking-submit:${ip}`, 5, 3600);
      const input = bookingInputSchema.parse(body);
      return json(await createBooking(input), 201);
    }
    if (path === 'admin/login') {
      const input = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: z.string().min(1).max(200),
        })
        .parse(body);
      await limited(`login:${ip}`, 10, 900);
      await limited(`account:${input.email}`, 10, 900);
      const [user] = await db()
        .select()
        .from(t.adminUsers)
        .where(and(eq(t.adminUsers.email, input.email), eq(t.adminUsers.active, true)));
      const valid = await passwordMatches(
        input.password,
        user?.passwordHash || `scrypt:00000000000000000000000000000000:${'0'.repeat(128)}`,
      );
      if (!user || !valid) throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.');
      const raw = token();
      await db()
        .insert(t.adminSessions)
        .values({
          userId: user.id,
          hash: hash(raw),
          expiresAt: new Date(Date.now() + 8 * 3600_000),
        });
      cookies.set('tc_admin', raw, {
        httpOnly: true,
        secure: env('APP_ENV') === 'production' || siteUrl().startsWith('https://'),
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 3600,
      });
      await db().insert(t.auditLogs).values({ adminId: user.id, action: 'login' });
      return json({ ok: true });
    }
    if (path?.startsWith('admin/')) {
      const admin = await session(cookies.get('tc_admin')?.value);
      if (!admin) throw new HttpError(401, 'Zaloguj się.');
      if (path === 'admin/logout') {
        await db()
          .delete(t.adminSessions)
          .where(eq(t.adminSessions.hash, hash(cookies.get('tc_admin')!.value)));
        cookies.delete('tc_admin', { path: '/' });
        return json({ ok: true });
      }
      await limited(`admin:${admin.id}`, 60, 60);
      if (path === 'admin/inventory') {
        const input = z
          .object({
            productId: z.string().max(100),
            delta: z
              .number()
              .int()
              .min(-10000)
              .max(10000)
              .refine((n) => n !== 0),
            reason: z.string().min(3).max(200),
          })
          .parse(body);
        const catalog = await products(true);
        if (!catalog.some((p) => p._id === input.productId && p.productType === 'physical'))
          throw new HttpError(400, 'Brak produktu fizycznego.');
        await db().transaction(async (tx) => {
          await tx
            .insert(t.inventory)
            .values({ productId: input.productId, available: 0 })
            .onConflictDoNothing();
          const [stock] = await tx
            .update(t.inventory)
            .set({ available: sql`${t.inventory.available}+${input.delta}`, updatedAt: new Date() })
            .where(
              and(
                eq(t.inventory.productId, input.productId),
                sql`${t.inventory.available}+${input.delta}>=0`,
              ),
            )
            .returning();
          if (!stock) throw new HttpError(409, 'Stan nie może być ujemny.');
          await tx.insert(t.inventoryMovements).values({
            productId: input.productId,
            quantity: input.delta,
            kind: 'adjustment',
            key: randomUUID(),
          });
          await tx
            .insert(t.auditLogs)
            .values({ adminId: admin.id, action: 'inventory', data: input });
        });
        return json({ ok: true });
      }
      if (path === 'admin/order') {
        const input = z
          .object({
            orderId: z.uuid(),
            action: z.enum(['cancel', 'resend-links', 'resend-email', 'shipment']),
            tracking: z.string().max(150).optional(),
            status: z.enum(['preparing', 'shipped', 'delivered']).optional(),
          })
          .parse(body);
        await db().transaction(async (tx) => {
          const [order] = await tx
            .select()
            .from(t.orders)
            .where(eq(t.orders.id, input.orderId))
            .for('update');
          if (!order) throw new HttpError(404, 'Brak zamówienia.');
          if (input.action === 'cancel') await cancelOrder(tx, order.id);
          if (input.action === 'resend-links') await resendLinks(tx, order.id);
          if (input.action === 'resend-email') {
            const [mail] = await tx
              .select()
              .from(t.emailOutbox)
              .where(
                eq(
                  t.emailOutbox.key,
                  order.status === 'paid' ? `paid:${order.id}` : `order:${order.id}`,
                ),
              )
              .orderBy(desc(t.emailOutbox.createdAt))
              .limit(1);
            if (!mail) throw new HttpError(404, 'Brak wiadomości.');
            await tx.insert(t.emailOutbox).values({
              key: `manual:${randomUUID()}`,
              to: mail.to,
              subject: mail.subject,
              html: mail.html,
            });
          }
          if (input.action === 'shipment') {
            if (order.status !== 'paid' || !input.status)
              throw new HttpError(409, 'Wysyłka wymaga opłaconego zamówienia.');
            if (input.status === 'shipped' && !input.tracking?.trim())
              throw new HttpError(400, 'Uzupełnij numer przesyłki.');
            const [shipment] = await tx
              .update(t.shipments)
              .set({ status: input.status, tracking: input.tracking, updatedAt: new Date() })
              .where(eq(t.shipments.orderId, order.id))
              .returning();
            if (!shipment) throw new HttpError(400, 'Brak przesyłki w tym zamówieniu.');
            await enqueue(
              tx,
              `shipment:${shipment.id}:${input.status}:${input.tracking || ''}`,
              order.email,
              input.status === 'shipped'
                ? 'Twoje zamówienie jest w drodze'
                : 'Aktualizacja realizacji zamówienia',
              `<p>Zamówienie ${order.id}</p><p>Status: ${escapeHtml(input.status)}</p><p>Numer przesyłki: ${escapeHtml(input.tracking || '—')}</p>`,
            );
          }
          await tx.insert(t.auditLogs).values({
            adminId: admin.id,
            orderId: order.id,
            action: input.action,
            data: { status: input.status, tracking: input.tracking },
          });
        });
        return json({ ok: true });
      }
    }
    throw new HttpError(404, 'Nie znaleziono zasobu.');
  } catch (error) {
    if (error instanceof ZodError)
      return json(
        {
          error: 'Sprawdź poprawność danych formularza.',
          fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400,
      );
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    // Never log payloads, credentials, access tokens or customer details.
    console.error(
      JSON.stringify({
        event: 'api_error',
        path,
        error: error instanceof Error ? error.name : 'Unknown',
      }),
    );
    return json({ error: 'Usługa jest chwilowo niedostępna. Spróbuj ponownie później.' }, 503);
  }
};
