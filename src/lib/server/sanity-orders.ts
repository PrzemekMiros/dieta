import { randomUUID } from 'node:crypto';
import type { SanityClient, SanityDocument, Transaction } from '@sanity/client';
import { z } from 'zod';
import { privateOrdersClient, retryConflict, seal, unseal } from './shop-storage';
import { hash, HttpError, token } from './security';
import { env, isDemo, required, siteUrl } from './env';
import { products, contentPage, settings } from '../catalog';
import { calculate } from './pricing';
import type { CheckoutInput } from './checkout-input';
import type { Product } from '../types';
import { cashOnDeliveryAvailable, onlinePaymentsAvailable } from './payment-readiness';
import { escapeHtml } from './email';

type Item = {
  _key: string;
  id: string;
  productId: string;
  name: string;
  sku: string;
  type: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  assetKey?: string;
};
type Event = { _key: string; id: string; kind: string; createdAt: string };
type Audit = { _key: string; id: string; action: string; createdAt: string; actor: string };
type Grant = {
  _key: string;
  itemId: string;
  active: boolean;
  assetKey: string;
  hash: string;
  expiresAt: string;
};
export type ShopOrder = SanityDocument & {
  status: 'pending' | 'paid' | 'cancelled' | 'payment_review';
  total: number;
  shipping: number;
  currency: 'PLN';
  shippingMethod: string | null;
  createdAt: string;
  customer: string;
  accessHash: string;
  requestHash: string;
  items: Item[];
  payment: { status: string };
  shipment: { status: string; tracking: string | null } | null;
  entitlements: Grant[];
  events: Event[];
  audit: Audit[];
};
type Customer = Pick<CheckoutInput, 'email' | 'phone' | 'address' | 'invoice'> & { name: string };
type Stock = SanityDocument & { productId: string; available: number };
export type ShopMail = SanityDocument & {
  payload: string;
  orderId: string;
  attempts: number;
  nextAttempt: string;
  sentAt: string | null;
  leaseUntil: string | null;
};
export type MailPayload = { to: string; subject: string; html: string };
const now = () => new Date().toISOString();
const event = (kind: string): Event => ({
  _key: randomUUID(),
  id: randomUUID(),
  kind,
  createdAt: now(),
});
const stockId = (productId: string) => `stock.${hash(productId)}`;
const orderIdSchema = z.string().regex(/^order\.[a-f0-9]{64}$/);
// These IDs are operational uniqueness constraints, not content identities:
// a create (never upsert) in the same transaction prevents duplicate checkouts.
const orderId = (key: string) => `order.${hash(key)}`;

export function publicOrder(order: ShopOrder) {
  return {
    id: order._id,
    status: order.status,
    total: order.total,
    currency: order.currency,
    createdAt: order.createdAt,
    shipping: order.shipping,
    shippingMethod: order.shippingMethod,
  };
}
export function publicDetail(order: ShopOrder) {
  return {
    order: publicOrder(order),
    items: order.items.map(({ id, name, sku, type, quantity, unitPrice, taxRate }) => ({
      id,
      name,
      sku,
      type,
      quantity,
      unitPrice,
      taxRate,
    })),
    payment: { status: order.payment.status },
    shipment: order.shipment
      ? { status: order.shipment.status, tracking: order.shipment.tracking }
      : null,
    entitlements: order.entitlements.map(({ itemId, active }) => ({ itemId, active })),
    audit: order.audit
      .slice(-100)
      .reverse()
      .map(({ id, action, createdAt }) => ({ id, action, createdAt })),
    events: order.events
      .slice(-100)
      .reverse()
      .map(({ id, kind, createdAt }) => ({ id, kind, createdAt })),
  };
}
export async function sanityListOrders(url: URL) {
  const { q, status, page } = z
    .object({
      q: z.string().max(200).default(''),
      status: z.enum(['', 'pending', 'paid', 'cancelled', 'payment_review']).default(''),
      page: z.coerce.number().int().min(1).max(100000).default(1),
    })
    .parse(Object.fromEntries(url.searchParams));
  const client = await privateOrdersClient();
  // An explicit projection keeps ciphertext, hashes and private file keys out
  // of even the list query, before the response is constructed.
  const result = await client.fetch<{
    orders: ReturnType<typeof publicOrder>[];
    stats: { count: number; pending: number; revenue: number };
  }>(
    `{
    "orders": *[_type == "shopOrder" && ($status == "" || status == $status) && ($q == "" || _id match $q)]
      | order(createdAt desc, _id desc)[$start...$end]{"id": _id,status,total,currency,createdAt,shipping,shippingMethod},
    "stats": {"count": count(*[_type == "shopOrder"]),
      "pending": count(*[_type == "shopOrder" && status == "pending"]),
      "revenue": coalesce(math::sum(*[_type == "shopOrder" && status == "paid"].total), 0)}
  }`,
    {
      status,
      q: q ? `*${q.replace(/[\\*?]/g, '')}*` : '',
      start: (page - 1) * 30,
      end: (page - 1) * 30 + 31,
    },
  );
  return {
    orders: result.orders.slice(0, 30),
    hasMore: result.orders.length > 30,
    page,
    stats: { ...result.stats, revenue: String(result.stats.revenue) },
  };
}
async function getOrder(client: SanityClient, id: string) {
  const order = await client.getDocument<ShopOrder>(orderIdSchema.parse(id));
  if (!order || order._type !== 'shopOrder') throw new HttpError(404, 'Nie znaleziono zamówienia.');
  return order;
}
export async function sanityOrderDetail(id: string) {
  return publicDetail(await getOrder(await privateOrdersClient(), id));
}
export async function sanityStock(catalog: Product[]) {
  const client = await privateOrdersClient();
  const rows = await client.getDocuments<Stock>(
    catalog.filter((p) => p.productType === 'physical').map((p) => stockId(p._id)),
  );
  return catalog.map((p) =>
    p.productType === 'physical'
      ? { ...p, stock: rows.find((s) => s?.productId === p._id)?.available || 0 }
      : p,
  );
}
export async function sanityAdjustStock(productId: string, delta: number, actor: string) {
  const catalog = await products(true);
  if (!catalog.some((p) => p._id === productId && p.productType === 'physical'))
    throw new HttpError(400, 'Brak produktu fizycznego.');
  const client = await privateOrdersClient();
  await retryConflict(async () => {
    const id = stockId(productId);
    const stock = await client.getDocument<Stock>(id);
    const available = (stock?.available || 0) + delta;
    if (available < 0) throw new HttpError(409, 'Stan nie może być ujemny.');
    const tx = client.transaction();
    if (stock) tx.patch(id, (p) => p.ifRevisionId(stock._rev).set({ available }));
    else tx.create({ _id: id, _type: 'shopStock', productId, available });
    tx.create({ _type: 'shopStockAdjustment', productId, delta, actor, createdAt: now() });
    await tx.commit({ visibility: 'sync' });
  });
}
function queueMail(tx: Transaction, order: ShopOrder, key: string, subject: string, html: string) {
  const id = `mail.${hash(`${order._id}:${key}`)}`;
  const customer = unseal<Customer>(order.customer, order._id);
  tx.createIfNotExists({
    _id: id,
    _type: 'shopMail',
    orderId: order._id,
    payload: seal({ to: customer.email, subject, html }, id),
    attempts: 0,
    nextAttempt: now(),
    sentAt: null,
    leaseUntil: null,
  });
}
export function sanitySalesReady(method: CheckoutInput['paymentMethod']) {
  if (isDemo() || (method !== 'cod' && !onlinePaymentsAvailable()))
    throw new HttpError(503, 'Sklep nie przyjmuje jeszcze zamówień online.');
  if (method === 'cod' && !cashOnDeliveryAvailable())
    throw new HttpError(503, 'Płatność za pobraniem nie jest obecnie dostępna.');
  required('SMTP_HOST');
  required('SMTP_FROM');
}
export async function sanityCreateOrder(input: CheckoutInput) {
  sanitySalesReady(input.paymentMethod);
  const client = await privateOrdersClient();
  const id = orderId(input.idempotencyKey);
  const requestHash = hash(JSON.stringify({ ...input, accessToken: undefined }));
  const repeat = (existing: ShopOrder) => {
    if (existing.accessHash !== hash(input.accessToken) || existing.requestHash !== requestHash)
      throw new HttpError(409, 'Dane ponowionego zamówienia nie są zgodne.');
    if (existing.status === 'pending' && existing.payment.status === 'cod_pending')
      return { redirect: `/zamowienie/sukces?token=${encodeURIComponent(input.accessToken)}` };
    throw new HttpError(409, 'Zamówienie zapisano. Sprawdź jego status przed kolejną próbą.');
  };
  const existing = await client.getDocument<ShopOrder>(id);
  if (existing) return repeat(existing);
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
  if (quote.lines.some((p) => p.demo))
    throw new HttpError(400, 'Produkty demonstracyjne nie mogą być sprzedawane.');
  if (quote.physical && (!input.address || !input.phone?.trim()))
    throw new HttpError(400, 'Uzupełnij adres i telefon do dostawy.');
  if (input.paymentMethod === 'cod' && (!quote.physical || quote.digital))
    throw new HttpError(400, 'Pobranie jest dostępne tylko dla produktów fizycznych.');
  if (quote.digital) {
    if (input.digitalConsent !== true)
      throw new HttpError(400, 'Potwierdź zgodę na dostarczenie treści cyfrowej.');
    if (quote.lines.some((p) => p.productType === 'digital' && !p.digitalFileUrl))
      throw new HttpError(503, 'Plik produktu nie został przygotowany.');
  }
  const customer: Customer = {
    email: input.email,
    name: `${input.firstName} ${input.lastName}`,
    phone: input.phone,
    address: input.address,
    invoice: input.invoice,
  };
  const order = {
    _id: id,
    _type: 'shopOrder',
    status: 'pending',
    total: quote.total,
    shipping: quote.shipping,
    currency: 'PLN',
    shippingMethod: quote.shippingMethod || null,
    createdAt: now(),
    customer: seal(customer, id),
    accessHash: hash(input.accessToken),
    requestHash,
    consents: {
      terms: true,
      digital: input.digitalConsent === true,
      at: now(),
      version: env('LEGAL_VERSION', '1'),
    },
    items: quote.lines.map((p) => ({
      _key: randomUUID(),
      id: randomUUID(),
      productId: p._id,
      sku: p.sku,
      name: p.name,
      type: p.productType,
      quantity: p.quantity,
      unitPrice: p.price,
      taxRate: p.taxRate,
      ...(p.digitalFileUrl ? { assetKey: p.digitalFileUrl } : {}),
    })),
    payment: { status: input.paymentMethod === 'cod' ? 'cod_pending' : 'registering' },
    shipment: input.paymentMethod === 'cod' ? { status: 'preparing', tracking: null } : null,
    entitlements: [],
    events: [event(input.paymentMethod === 'cod' ? 'cod_ordered' : 'created')],
    audit: [],
  } as unknown as ShopOrder;
  const created = await retryConflict(async () => {
    const previous = await client.getDocument<ShopOrder>(id);
    if (previous) return previous;
    const tx = client.transaction().create(order);
    for (const item of order.items.filter((i) => i.type === 'physical')) {
      const stock = await client.getDocument<Stock>(stockId(item.productId));
      if (!stock || stock.available < item.quantity)
        throw new HttpError(409, `Brak wystarczającego stanu: ${item.name}`);
      tx.patch(stock._id, (p) =>
        p.ifRevisionId(stock._rev).set({ available: stock.available - item.quantity }),
      );
    }
    queueMail(
      tx,
      order,
      'ordered',
      'Otrzymaliśmy Twoje zamówienie',
      `<p>Numer zamówienia: ${id}</p><p>${input.paymentMethod === 'cod' ? 'Płatność przy odbiorze.' : 'Czekamy na potwierdzenie płatności.'}</p>`,
    );
    await tx.commit({ visibility: 'sync' });
    return null;
  });
  if (created) return repeat(created);
  return { redirect: `/zamowienie/sukces?token=${encodeURIComponent(input.accessToken)}` };
}

function grantDownloads(order: ShopOrder) {
  const links: string[] = [];
  order.entitlements = order.items
    .filter((item) => item.type === 'digital')
    .map((item) => {
      if (!item.assetKey) throw new HttpError(503, 'Brak pliku produktu.');
      const raw = token();
      links.push(
        `<p><a href="${siteUrl()}/pobierz/${raw}">Pobierz: ${escapeHtml(item.name)}</a></p>`,
      );
      return {
        _key: randomUUID(),
        itemId: item.id,
        active: true,
        assetKey: item.assetKey,
        hash: hash(raw),
        expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
      };
    });
  return links.join('');
}
export const sanityActionSchema = z.object({
  orderId: orderIdSchema,
  action: z.enum(['cancel', 'confirm-cod', 'shipment', 'resend-links', 'resend-email']),
  status: z.enum(['preparing', 'shipped', 'delivered']).optional(),
  tracking: z.string().trim().max(150).optional(),
});
export async function sanityOrderAction(body: unknown, actor: string) {
  const input = sanityActionSchema.parse(body);
  const client = await privateOrdersClient();
  // Keep the same mail key across OCC retries, without repeating side effects.
  const actionId = randomUUID();
  await retryConflict(async () => {
    const order = await getOrder(client, input.orderId);
    const tx = client.transaction();
    let subject = 'Aktualizacja zamówienia';
    let html = `<p>Zamówienie ${order._id}</p>`;
    if (input.action === 'cancel') {
      if (order.status === 'cancelled') return;
      if (order.status !== 'pending' || (order.shipment && order.shipment.status !== 'preparing'))
        throw new HttpError(409, 'Nie można anulować opłaconego lub wysłanego zamówienia.');
      for (const item of order.items.filter((i) => i.type === 'physical')) {
        const stock = await client.getDocument<Stock>(stockId(item.productId));
        if (!stock) throw new HttpError(409, 'Brak stanu magazynowego.');
        tx.patch(stock._id, (p) =>
          p.ifRevisionId(stock._rev).set({ available: stock.available + item.quantity }),
        );
      }
      order.status = 'cancelled';
      if (order.payment.status === 'cod_pending') order.payment.status = 'cod_cancelled';
      subject = 'Zamówienie anulowane';
    }
    if (input.action === 'confirm-cod') {
      if (order.status !== 'pending' || order.payment.status !== 'cod_pending')
        throw new HttpError(409, 'Zamówienie nie oczekuje na pobranie.');
      order.status = 'paid';
      order.payment.status = 'cod_collected';
      order.events.push(event('cod_collected'));
      subject = 'Płatność za pobraniem odebrana';
    }
    if (input.action === 'shipment') {
      if (
        !order.shipment ||
        !input.status ||
        !(
          order.status === 'paid' ||
          (order.status === 'pending' && order.payment.status === 'cod_pending')
        )
      )
        throw new HttpError(409, 'Wysyłka wymaga opłaconego zamówienia lub pobrania.');
      if (input.status === 'shipped' && !input.tracking)
        throw new HttpError(400, 'Uzupełnij numer przesyłki.');
      order.shipment = {
        status: input.status,
        tracking: input.tracking || order.shipment.tracking,
      };
      html += `<p>Status: ${escapeHtml(input.status)}</p><p>Przesyłka: ${escapeHtml(order.shipment.tracking || '')}</p>`;
    }
    if (input.action === 'resend-links') {
      if (order.status !== 'paid' || !order.items.some((i) => i.type === 'digital'))
        throw new HttpError(409, 'Brak opłaconych e-booków.');
      html += grantDownloads(order);
      subject = 'Nowe linki do Twoich e-booków';
    }
    if (input.action === 'resend-email') {
      const originalKey =
        order.status === 'paid' || order.status === 'payment_review' ? 'paid' : 'ordered';
      const mail = await client.getDocument<ShopMail>(
        `mail.${hash(`${order._id}:${originalKey}`)}`,
      );
      if (!mail) throw new HttpError(404, 'Brak wiadomości do ponowienia.');
      const original = unseal<MailPayload>(mail.payload, mail._id);
      html = original.html;
      subject = original.subject;
    }
    order.audit.push({
      _key: actionId,
      id: actionId,
      action: input.action,
      actor,
      createdAt: now(),
    });
    tx.patch(order._id, (p) =>
      p.ifRevisionId(order._rev).set({
        status: order.status,
        payment: order.payment,
        shipment: order.shipment,
        entitlements: order.entitlements,
        events: order.events,
        audit: order.audit,
      }),
    );
    queueMail(tx, order, input.action === 'confirm-cod' ? 'paid' : actionId, subject, html);
    await tx.commit({ visibility: 'sync' });
  });
  return { ok: true };
}
export async function sanityOrderStatus(raw: string) {
  const client = await privateOrdersClient();
  const id = await client.fetch<string | null>(
    '*[_type == "shopOrder" && accessHash == $hash][0]._id',
    { hash: hash(raw) },
  );
  if (!id) throw new HttpError(404, 'Nie znaleziono zamówienia.');
  const order = await getOrder(client, id);
  return {
    ...publicOrder(order),
    paymentMethod: order.payment.status.startsWith('cod_') ? 'cod' : 'online',
    email: unseal<Customer>(order.customer, order._id).email,
    items: order.items.map(({ name, quantity, unitPrice }) => ({ name, quantity, unitPrice })),
  };
}
export async function sanityEntitlement(raw: string) {
  const client = await privateOrdersClient();
  const id = await client.fetch<string | null>(
    '*[_type == "shopOrder" && $hash in entitlements[].hash][0]._id',
    { hash: hash(raw) },
  );
  const order = id ? await getOrder(client, id) : null;
  const grant = order?.entitlements.find(
    (g) => g.hash === hash(raw) && g.active && g.expiresAt > now(),
  );
  if (!order || order.status !== 'paid' || !grant)
    throw new HttpError(410, 'Link wygasł lub nie jest już aktywny.');
  return {
    id: grant._key,
    orderId: order._id,
    itemId: grant.itemId,
    assetKey: grant.assetKey,
    active: true,
  };
}
