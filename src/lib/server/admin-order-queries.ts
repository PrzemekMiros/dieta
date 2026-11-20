import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import * as t from './schema';
import { HttpError } from './security';

// Explicit projections keep payment tokens, access hashes and private asset
// keys out of the browser API.
const orderFields = {
  id: t.orders.id,
  status: t.orders.status,
  total: t.orders.total,
  currency: t.orders.currency,
  createdAt: t.orders.createdAt,
};

export async function listAdminOrders(url: URL) {
  const { q, status, page } = z
    .object({
      q: z.string().max(200).default(''),
      status: z.enum(['', 'pending', 'paid', 'cancelled', 'payment_review']).default(''),
      page: z.coerce.number().int().min(1).max(100000).default(1),
    })
    .parse(Object.fromEntries(url.searchParams));
  const filter = and(
    q ? sql`${t.orders.id}::text ilike ${'%' + q + '%'}` : undefined,
    status ? eq(t.orders.status, status) : undefined,
  );
  const [rows, stats] = await Promise.all([
    db()
      .select(orderFields)
      .from(t.orders)
      .where(filter)
      .orderBy(desc(t.orders.createdAt), desc(t.orders.id))
      .limit(31)
      .offset((page - 1) * 30),
    db()
      .select({
        count: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where status='pending')::int`,
        revenue: sql<string>`coalesce(sum(case when status='paid' then total else 0 end),0)::text`,
      })
      .from(t.orders),
  ]);
  return { orders: rows.slice(0, 30), hasMore: rows.length > 30, page, stats: stats[0] };
}

export async function adminOrderDetail(rawId: string) {
  const id = z.uuid().parse(rawId);
  const [order] = await db()
    .select({
      ...orderFields,
      shipping: t.orders.shipping,
      shippingMethod: t.orders.shippingMethod,
    })
    .from(t.orders)
    .where(eq(t.orders.id, id));
  if (!order) throw new HttpError(404, 'Nie znaleziono zamówienia.');
  const [items, payments, shipments, entitlements, audit, events] = await Promise.all([
    db()
      .select({
        id: t.orderItems.id,
        name: t.orderItems.name,
        sku: t.orderItems.sku,
        type: t.orderItems.type,
        quantity: t.orderItems.quantity,
        unitPrice: t.orderItems.unitPrice,
        taxRate: t.orderItems.taxRate,
      })
      .from(t.orderItems)
      .where(eq(t.orderItems.orderId, id)),
    db()
      .select({ status: t.payments.status, p24OrderId: t.payments.p24OrderId })
      .from(t.payments)
      .where(eq(t.payments.orderId, id)),
    db()
      .select({ status: t.shipments.status, tracking: t.shipments.tracking })
      .from(t.shipments)
      .where(eq(t.shipments.orderId, id)),
    db()
      .select({ itemId: t.entitlements.itemId, active: t.entitlements.active })
      .from(t.entitlements)
      .where(eq(t.entitlements.orderId, id)),
    db()
      .select({ id: t.auditLogs.id, action: t.auditLogs.action, createdAt: t.auditLogs.createdAt })
      .from(t.auditLogs)
      .where(eq(t.auditLogs.orderId, id))
      .orderBy(desc(t.auditLogs.createdAt))
      .limit(100),
    db()
      .select({
        id: t.paymentEvents.id,
        kind: t.paymentEvents.kind,
        createdAt: t.paymentEvents.createdAt,
      })
      .from(t.paymentEvents)
      .where(eq(t.paymentEvents.orderId, id))
      .orderBy(desc(t.paymentEvents.createdAt))
      .limit(100),
  ]);
  return {
    order,
    items,
    payment: payments[0] || null,
    shipment: shipments[0] || null,
    entitlements,
    audit,
    events,
  };
}
