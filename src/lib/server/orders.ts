import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, type Tx } from './db';
import * as t from './schema';
import { products, contentPage, settings } from '../catalog';
import { calculate } from './pricing';
import type { CheckoutInput } from './checkout-input';
import { hash, HttpError } from './security';
import { env, isDemo, required } from './env';
import { enqueue, escapeHtml } from './email';
import { issueLink } from './digital';
import { cashOnDeliveryAvailable, onlinePaymentsAvailable } from './payment-readiness';
export function salesReady(paymentMethod: CheckoutInput['paymentMethod'] = 'tpay') {
  if (isDemo()) throw new HttpError(503, 'Sklep nie przyjmuje jeszcze zamówień.');
  if (paymentMethod === 'cod' && !cashOnDeliveryAvailable())
    throw new HttpError(503, 'Płatność za pobraniem nie jest obecnie dostępna.');
  if (paymentMethod !== 'cod' && !onlinePaymentsAvailable())
    throw new HttpError(503, 'Sklep nie przyjmuje jeszcze zamówień.');
  required('DATABASE_URL');
  required('SMTP_HOST');
}
export async function createOrder(input: CheckoutInput) {
  salesReady(input.paymentMethod);
  const requestHash = hash(JSON.stringify({ ...input, accessToken: undefined }));
  const [existing] = await db()
    .select()
    .from(t.orders)
    .where(eq(t.orders.idempotencyKey, input.idempotencyKey));
  if (existing) {
    if (existing.accessHash !== hash(input.accessToken) || existing.requestHash !== requestHash)
      throw new HttpError(409, 'Dane ponowionego zamówienia nie są zgodne.');
    const [payment] = await db()
      .select()
      .from(t.payments)
      .where(eq(t.payments.orderId, existing.id));
    if (payment?.status === 'cod_pending' && existing.status === 'pending')
      return { redirect: `/zamowienie/sukces?token=${encodeURIComponent(input.accessToken)}` };
    throw new HttpError(409, 'Zamówienie już istnieje. Sprawdź jego status przed kolejną próbą.');
  }
  const [catalog, legal, privacy, company] = await Promise.all([
    products(true),
    contentPage('regulamin'),
    contentPage('polityka-prywatnosci'),
    settings(),
  ]);
  if (
    !legal?.content?.length ||
    !privacy?.content?.length ||
    !company.email ||
    !company.companyName
  )
    throw new HttpError(503, 'Sklep jest w trakcie przygotowania.');
  const quote = calculate(input.items, catalog, input.shippingMethod);
  if (input.paymentMethod === 'cod') {
    if (!cashOnDeliveryAvailable())
      throw new HttpError(503, 'Płatność za pobraniem nie jest obecnie dostępna.');
    if (!quote.physical || quote.digital)
      throw new HttpError(
        400,
        'Płatność za pobraniem jest dostępna tylko dla produktów fizycznych.',
      );
  }
  if (quote.lines.some((p) => p.demo))
    throw new HttpError(400, 'Produkty demonstracyjne nie mogą być sprzedawane.');
  if (quote.physical && (!input.address || !input.phone?.trim()))
    throw new HttpError(400, 'Uzupełnij adres i telefon do dostawy.');
  if (quote.digital && input.digitalConsent !== true)
    throw new HttpError(400, 'Potwierdź zgodę na dostarczenie treści cyfrowej.');
  if (quote.digital) {
    if (quote.lines.some((p) => p.productType === 'digital' && !p.digitalFileUrl))
      throw new HttpError(503, 'Plik produktu nie został przygotowany.');
  }
  await db().transaction(async (tx) => {
    const [customer] = await tx
      .insert(t.customers)
      .values({ email: input.email, name: `${input.firstName} ${input.lastName}` })
      .onConflictDoUpdate({
        target: t.customers.email,
        set: { name: `${input.firstName} ${input.lastName}` },
      })
      .returning();
    const [order] = await tx
      .insert(t.orders)
      .values({
        customerId: customer!.id,
        email: input.email,
        name: `${input.firstName} ${input.lastName}`,
        phone: input.phone,
        total: quote.total,
        shipping: quote.shipping,
        shippingMethod: quote.shippingMethod,
        address: input.address,
        invoice: input.invoice,
        consents: {
          terms: true,
          digital: input.digitalConsent === true,
          at: new Date().toISOString(),
          version: env('LEGAL_VERSION', '1'),
        },
        accessHash: hash(input.accessToken),
        idempotencyKey: input.idempotencyKey,
        requestHash,
      })
      .returning();
    // Stable lock order prevents deadlocks between mixed carts.
    for (const p of [...quote.lines].sort((a, b) => a._id.localeCompare(b._id))) {
      if (p.productType === 'physical') {
        const [stock] = await tx
          .update(t.inventory)
          .set({ available: sql`${t.inventory.available}-${p.quantity}`, updatedAt: new Date() })
          .where(
            and(eq(t.inventory.productId, p._id), sql`${t.inventory.available}>=${p.quantity}`),
          )
          .returning();
        if (!stock) throw new HttpError(409, `Brak wystarczającego stanu: ${p.name}`);
        await tx.insert(t.inventoryMovements).values({
          productId: p._id,
          orderId: order!.id,
          quantity: -p.quantity,
          kind: 'reserve',
          key: `reserve:${order!.id}:${p._id}`,
        });
      }
      await tx.insert(t.orderItems).values({
        orderId: order!.id,
        productId: p._id,
        sku: p.sku,
        name: p.name,
        type: p.productType,
        quantity: p.quantity,
        unitPrice: p.price,
        taxRate: p.taxRate,
        assetKey: p.digitalFileUrl,
      });
    }
    await tx.insert(t.payments).values({
      orderId: order!.id,
      sessionId: order!.id,
      status: input.paymentMethod === 'cod' ? 'cod_pending' : 'registering',
    });
    if (input.paymentMethod === 'cod') {
      await tx.insert(t.paymentEvents).values({
        orderId: order!.id,
        eventKey: `cod-ordered:${order!.id}`,
        kind: 'cod_ordered',
      });
      await tx.insert(t.shipments).values({ orderId: order!.id });
    }
    await enqueue(
      tx,
      `order:${order!.id}`,
      order!.email,
      'Otrzymaliśmy Twoje zamówienie',
      input.paymentMethod === 'cod'
        ? `<p>Cześć ${escapeHtml(input.firstName)}!</p><p>Numer zamówienia: ${order!.id}</p><p>Zapłacisz ${new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(order!.total / 100)} gotówką przy odbiorze przesyłki. Zamówienie nie jest jeszcze opłacone.</p>`
        : `<p>Cześć ${escapeHtml(input.firstName)}!</p><p>Numer zamówienia: ${order!.id}</p><p>Czekamy na potwierdzenie płatności. To nie jest jeszcze potwierdzenie opłacenia.</p>`,
    );
    return order!;
  });
  return { redirect: `/zamowienie/sukces?token=${encodeURIComponent(input.accessToken)}` };
}
export async function confirmCashOnDelivery(tx: Tx, orderId: string) {
  const [order] = await tx.select().from(t.orders).where(eq(t.orders.id, orderId)).for('update');
  if (!order) throw new HttpError(404, 'Brak zamówienia.');
  if (order.status !== 'pending')
    throw new HttpError(409, 'Zamówienie nie oczekuje już na płatność.');
  const [payment] = await tx
    .select()
    .from(t.payments)
    .where(eq(t.payments.orderId, orderId))
    .for('update');
  if (payment?.status !== 'cod_pending')
    throw new HttpError(409, 'Zamówienie nie ma nieodebranej płatności za pobraniem.');
  const paidAt = new Date();
  await tx
    .update(t.orders)
    .set({ status: 'paid', paidAt, updatedAt: paidAt })
    .where(eq(t.orders.id, orderId));
  await tx.update(t.payments).set({ status: 'cod_collected' }).where(eq(t.payments.id, payment.id));
  await tx.insert(t.paymentEvents).values({
    orderId,
    eventKey: `cod-collected:${orderId}`,
    kind: 'cod_collected',
  });
  await enqueue(
    tx,
    `cod-collected:${orderId}`,
    order.email,
    'Płatność za pobraniem odebrana',
    `<p>Potwierdzamy odbiór płatności za pobraniem do zamówienia ${orderId}. Dziękujemy!</p>`,
  );
}
export async function cancelOrder(tx: Tx, orderId: string) {
  const [order] = await tx.select().from(t.orders).where(eq(t.orders.id, orderId)).for('update');
  if (!order) throw new HttpError(404, 'Brak zamówienia.');
  if (order.status === 'cancelled') return;
  if (order.status !== 'pending')
    throw new HttpError(409, 'Nie można anulować opłaconego zamówienia tym działaniem.');
  const [payment] = await tx.select().from(t.payments).where(eq(t.payments.orderId, orderId));
  if (payment?.status === 'cod_pending') {
    const [shipment] = await tx.select().from(t.shipments).where(eq(t.shipments.orderId, orderId));
    if (shipment && shipment.status !== 'preparing')
      throw new HttpError(409, 'Nie można anulować pobrania po przekazaniu przesyłki do dostawy.');
    await tx
      .update(t.payments)
      .set({ status: 'cod_cancelled' })
      .where(eq(t.payments.id, payment.id));
    await tx.insert(t.paymentEvents).values({
      orderId,
      eventKey: `cod-cancelled:${orderId}`,
      kind: 'cod_cancelled',
    });
  }
  const items = await tx.select().from(t.orderItems).where(eq(t.orderItems.orderId, orderId));
  for (const item of items
    .filter((i) => i.type === 'physical')
    .sort((a, b) => a.productId.localeCompare(b.productId))) {
    await tx
      .update(t.inventory)
      .set({ available: sql`${t.inventory.available}+${item.quantity}`, updatedAt: new Date() })
      .where(eq(t.inventory.productId, item.productId));
    await tx.insert(t.inventoryMovements).values({
      productId: item.productId,
      orderId,
      quantity: item.quantity,
      kind: 'release',
      key: `release:${orderId}:${item.productId}`,
    });
  }
  await tx
    .update(t.orders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(t.orders.id, orderId));
  await enqueue(
    tx,
    `cancel:${orderId}`,
    order.email,
    'Zamówienie anulowane',
    `<p>Zamówienie ${orderId} zostało anulowane. Jeśli płatność została pobrana, skontaktuj się ze sklepem.</p>`,
  );
}
export async function resendLinks(tx: Tx, orderId: string) {
  const [order] = await tx.select().from(t.orders).where(eq(t.orders.id, orderId)).for('update');
  if (!order || order.status !== 'paid') throw new HttpError(409, 'Zamówienie nie jest opłacone.');
  const rows = await tx
    .select()
    .from(t.entitlements)
    .where(and(eq(t.entitlements.orderId, orderId), eq(t.entitlements.active, true)));
  const links = [];
  for (const e of rows) {
    await tx.delete(t.downloadTokens).where(eq(t.downloadTokens.entitlementId, e.id));
    links.push(await issueLink(tx, e.id));
  }
  if (!links.length) throw new HttpError(400, 'Zamówienie nie zawiera ebooków.');
  await enqueue(
    tx,
    `resend:${randomUUID()}`,
    order.email,
    'Nowe linki do Twoich ebooków',
    links
      .map((link, i) => `<p><a href="${escapeHtml(link)}">Pobierz ebook ${i + 1}</a></p>`)
      .join('') + '<p>Linki są ważne przez 72 godziny. Poprzednie linki wygasły.</p>',
  );
}
