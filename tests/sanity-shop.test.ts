import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { APIContext } from 'astro';
import type { ShopOrder } from '../src/lib/server/sanity-orders';
const state = vi.hoisted(() => ({
  client: {} as unknown,
  catalog: [] as unknown[],
  sendMail: vi.fn(),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: state.sendMail, close: vi.fn() }) },
}));
vi.mock('@sanity/client', () => ({ createClient: () => state.client }));
vi.mock('../src/lib/server/db', () => ({
  db: () => {
    throw new Error('PostgreSQL must not be used');
  },
}));
vi.mock('../src/lib/catalog', () => ({
  products: async () => state.catalog,
  contentPage: async () => ({ content: [{}] }),
  settings: async () => ({ email: 'shop@example.test', companyName: 'Shop' }),
}));
vi.mock('../src/lib/server/p24', async (original) => ({
  ...(await original<typeof import('../src/lib/server/p24')>()),
  registerPayment: vi.fn(async () => 'payment-token'),
}));
import { seal, unseal, privateOrdersClient } from '../src/lib/server/shop-storage';
import {
  sanityCreateOrder,
  sanityOrderAction,
  sanityOrderDetail,
  sanityAcceptPayment,
  sanityStock,
  sanityAdjustStock,
  sanityEntitlement,
} from '../src/lib/server/sanity-orders';
import { hash, token } from '../src/lib/server/security';
import { sanityLimited, processSanityOutbox } from '../src/lib/server/sanity-shop-jobs';
import { ALL } from '../src/pages/api/[...path]';
import type { Notification } from '../src/lib/server/p24';

// A transactional store with revision preconditions. Every commit applies to a
// clone, so a conflicting stock patch rolls back creation of the order and mail.
type Doc = Record<string, unknown> & { _id: string; _rev: string; _type: string };
let docs: Map<string, Doc>;
let revision: number;
let privateDataset: boolean;
class Patch {
  rev?: string;
  values: Record<string, unknown> = {};
  constructor(public id: string) {}
  ifRevisionId(rev: string) {
    this.rev = rev;
    return this;
  }
  set(values: Record<string, unknown>) {
    this.values = values;
    return this;
  }
  async commit() {
    const tx = new Tx();
    tx.ops.push(this);
    await tx.commit();
    return structuredClone(docs.get(this.id));
  }
}
class Tx {
  ops: (Patch | { doc: Record<string, unknown>; optional: boolean })[] = [];
  create(doc: Record<string, unknown>) {
    this.ops.push({ doc, optional: false });
    return this;
  }
  createIfNotExists(doc: Record<string, unknown>) {
    this.ops.push({ doc, optional: true });
    return this;
  }
  patch(id: string, fn: (p: Patch) => Patch) {
    this.ops.push(fn(new Patch(id)));
    return this;
  }
  async commit() {
    const next = structuredClone(docs);
    for (const op of this.ops) {
      if (op instanceof Patch) {
        const previous = next.get(op.id);
        if (!previous || previous._rev !== op.rev) throw { statusCode: 409 };
        next.set(op.id, { ...previous, ...op.values, _rev: String(++revision) });
      } else {
        const id = String(op.doc._id || randomUUID());
        if (next.has(id)) {
          if (op.optional) continue;
          throw { statusCode: 409 };
        }
        next.set(id, { ...op.doc, _id: id, _rev: String(++revision) } as Doc);
      }
    }
    docs = next;
  }
}
const input = () => ({
  items: [{ id: 'book', quantity: 1 }],
  paymentMethod: 'cod' as const,
  idempotencyKey: randomUUID(),
  accessToken: token(),
  firstName: 'Synthetic',
  lastName: 'Customer',
  email: 'synthetic@example.test',
  phone: '500600700',
  terms: true as const,
  address: { street: 'Test 1', postalCode: '00-001', city: 'Test', country: 'PL' as const },
});
const idFor = (key: string) => `order.${hash(key)}`;
beforeEach(() => {
  state.sendMail.mockReset().mockResolvedValue({});
  docs = new Map();
  revision = 0;
  privateDataset = true;
  vi.stubEnv('SHOP_STORAGE', 'sanity');
  vi.stubEnv('SANITY_ORDERS_TOKEN', 'test-only');
  vi.stubEnv('SANITY_ORDERS_DATASET', 'orders');
  vi.stubEnv('SANITY_ORDERS_ENCRYPTION_KEY', 'ab'.repeat(32));
  vi.stubEnv('DEMO_CATALOG', 'false');
  vi.stubEnv('COD_ENABLED', 'true');
  vi.stubEnv('SMTP_HOST', 'mail.example.test');
  vi.stubEnv('SMTP_FROM', 'shop@example.test');
  vi.stubEnv('PAYMENT_PROVIDER', 'p24');
  vi.stubEnv('SALES_ENABLED', 'true');
  vi.stubEnv('P24_ENV', 'sandbox');
  vi.stubEnv('P24_MERCHANT_ID', '1');
  vi.stubEnv('P24_POS_ID', '1');
  vi.stubEnv('P24_CRC', 'test');
  vi.stubEnv('P24_API_KEY', 'test');
  state.client = {
    fetch: async (query: string, params: { hash?: string; now?: string }) => {
      if (query.includes('shopMail'))
        return [...docs.values()]
          .filter(
            (d) =>
              d._type === 'shopMail' &&
              !d.sentAt &&
              Number(d.attempts) < 12 &&
              String(d.nextAttempt) <= params.now! &&
              (!d.leaseUntil || String(d.leaseUntil) <= params.now!),
          )
          .map((d) => d._id);
      if (query.includes('entitlements[].hash'))
        return (
          [...docs.values()].find(
            (d) =>
              d._type === 'shopOrder' &&
              (d as unknown as ShopOrder).entitlements.some((g) => g.hash === params.hash),
          )?._id || null
        );
      throw new Error('Unhandled query');
    },
    config: () => ({ dataset: 'orders' }),
    datasets: {
      list: async () => [{ name: 'orders', aclMode: privateDataset ? 'private' : 'public' }],
    },
    getDocument: async (id: string) => structuredClone(docs.get(id)),
    getDocuments: async (ids: string[]) => ids.map((id) => structuredClone(docs.get(id)) || null),
    transaction: () => new Tx(),
    patch: (id: string) => new Patch(id),
    create: async (doc: Record<string, unknown>) => new Tx().create(doc).commit(),
  };
  state.catalog = [
    {
      _id: 'book',
      name: 'Book',
      sku: 'B1',
      productType: 'physical',
      price: 1000,
      taxRate: 5,
      active: true,
    },
  ];
  docs.set(`stock.${hash('book')}`, {
    _id: `stock.${hash('book')}`,
    _type: 'shopStock',
    _rev: '0',
    productId: 'book',
    available: 1,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('private Sanity commerce without PostgreSQL', () => {
  it('leases queued mail so simultaneous workers deliver once and retries SMTP failure', async () => {
    await sanityCreateOrder(input());
    state.sendMail.mockRejectedValueOnce(new Error('SMTP failed'));
    expect(await processSanityOutbox()).toBe(0);
    const failed = [...docs.values()].find((d) => d._type === 'shopMail')!;
    expect(failed.sentAt).toBeNull();
    expect(failed.attempts).toBe(1);
    expect(String(failed.nextAttempt) > new Date().toISOString()).toBe(true);
    failed.nextAttempt = '2000-01-01T00:00:00.000Z';
    state.sendMail.mockClear();
    const counts = await Promise.all([processSanityOutbox(), processSanityOutbox()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(state.sendMail).toHaveBeenCalledTimes(1);
    expect(state.sendMail.mock.calls[0]![0].to).toBe('synthetic@example.test');
  });
  it('only verified payment grants downloads; resending revokes old links', async () => {
    state.catalog = [
      {
        _id: 'ebook',
        name: 'Ebook',
        sku: 'E1',
        productType: 'digital',
        price: 2000,
        taxRate: 5,
        active: true,
        digitalAssetReference: 'private/file.pdf',
      },
    ];
    vi.stubEnv('S3_BUCKET', 'test');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'test');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test');
    const data = {
      ...input(),
      items: [{ id: 'ebook', quantity: 1 }],
      paymentMethod: 'p24' as const,
      digitalConsent: true,
    };
    await sanityCreateOrder(data);
    const orderId = idFor(data.idempotencyKey);
    expect(docs.get(orderId)!.entitlements).toEqual([]);
    await sanityAcceptPayment(
      {
        sessionId: orderId,
        amount: 2000,
        originAmount: 2000,
        currency: 'PLN',
        orderId: 100,
      } as Notification,
      async () => {},
    );
    const mail = docs.get(`mail.${hash(`${orderId}:paid`)}`)!;
    const html = unseal<{ html: string }>(String(mail.payload), mail._id).html;
    const raw = /pobierz\/([a-f0-9]{64})/.exec(html)![1]!;
    expect((await sanityEntitlement(raw)).assetKey).toBe('private/file.pdf');
    expect(JSON.stringify(await sanityOrderDetail(orderId))).not.toContain('private/file.pdf');
    await sanityOrderAction({ orderId, action: 'resend-links' }, 'admin');
    await expect(sanityEntitlement(raw)).rejects.toThrow('Link wygasł');
  });
  it('fails closed when the dataset becomes public or credentials are absent', async () => {
    privateDataset = false;
    await expect(privateOrdersClient()).rejects.toThrow('private');
    vi.stubEnv('SANITY_ORDERS_TOKEN', '');
    await expect(privateOrdersClient()).rejects.toThrow('SANITY_ORDERS_TOKEN');
  });
  it('authenticates encrypted customer data and binds it to the order', () => {
    const sealed = seal({ email: 'secret@example.test' }, 'one');
    expect(sealed).not.toContain('secret');
    expect(unseal(sealed, 'one')).toEqual({ email: 'secret@example.test' });
    expect(() => unseal(sealed, 'two')).toThrow();
    vi.stubEnv('SANITY_ORDERS_ENCRYPTION_KEY', 'cd'.repeat(32));
    expect(() => unseal(sealed, 'one')).toThrow();
  });
  it('atomically saves the order, encrypted mail and inventory reservation', async () => {
    const data = input();
    await sanityCreateOrder(data);
    const order = docs.get(idFor(data.idempotencyKey))!;
    expect(order.status).toBe('pending');
    expect([...docs.values()].filter((d) => d._type === 'shopMail')).toHaveLength(1);
    expect(JSON.stringify([...docs.values()])).not.toContain(data.email);
    expect(JSON.stringify([...docs.values()])).not.toContain(data.address.street);
    expect((await sanityStock(state.catalog as never))[0]!.stock).toBe(0);
    const detail = await sanityOrderDetail(order._id);
    expect(detail.order).not.toHaveProperty('customer');
    expect(detail.order).not.toHaveProperty('accessHash');
    expect(detail.items[0]).not.toHaveProperty('assetKey');
  });
  it('repeated and simultaneous checkout only reserve stock once', async () => {
    const data = input();
    const results = await Promise.all([sanityCreateOrder(data), sanityCreateOrder(data)]);
    expect(results[0]).toEqual(results[1]);
    expect([...docs.values()].filter((d) => d._type === 'shopOrder')).toHaveLength(1);
    expect((await sanityStock(state.catalog as never))[0]!.stock).toBe(0);
    await expect(sanityCreateOrder({ ...data, email: 'changed@example.test' })).rejects.toThrow(
      'nie są zgodne',
    );
  });
  it('only one buyer can reserve the last item; failed checkout leaves no orphan mail/order', async () => {
    const results = await Promise.allSettled([
      sanityCreateOrder(input()),
      sanityCreateOrder(input()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect([...docs.values()].filter((d) => d._type === 'shopOrder')).toHaveLength(1);
    expect([...docs.values()].filter((d) => d._type === 'shopMail')).toHaveLength(1);
  });
  it('cancellation restores stock once and shipment of a cancelled order is denied', async () => {
    const data = input();
    await sanityCreateOrder(data);
    const orderId = idFor(data.idempotencyKey);
    await Promise.all([
      sanityOrderAction({ orderId, action: 'cancel' }, 'admin'),
      sanityOrderAction({ orderId, action: 'cancel' }, 'admin'),
    ]);
    expect((await sanityStock(state.catalog as never))[0]!.stock).toBe(1);
    await expect(
      sanityOrderAction(
        { orderId, action: 'shipment', status: 'shipped', tracking: '123' },
        'admin',
      ),
    ).rejects.toThrow('Wysyłka wymaga');
  });
  it('COD collection and shipment actions require valid order states', async () => {
    const data = input();
    await sanityCreateOrder(data);
    const orderId = idFor(data.idempotencyKey);
    await expect(
      sanityOrderAction({ orderId, action: 'shipment', status: 'shipped' }, 'admin'),
    ).rejects.toThrow('numer przesyłki');
    await sanityOrderAction({ orderId, action: 'confirm-cod' }, 'admin');
    await expect(sanityOrderAction({ orderId, action: 'confirm-cod' }, 'admin')).rejects.toThrow(
      'nie oczekuje',
    );
    expect((await sanityOrderDetail(orderId)).payment.status).toBe('cod_collected');
  });
  it('verified notifications are idempotent and late payment does not fulfill cancelled orders', async () => {
    const data = input();
    await sanityCreateOrder({ ...data, paymentMethod: 'p24' });
    const orderId = idFor(data.idempotencyKey);
    const order = docs.get(orderId) as unknown as ShopOrder;
    const n = {
      sessionId: orderId,
      amount: order.total,
      originAmount: order.total,
      currency: 'PLN',
      orderId: 123,
    } as Notification;
    await expect(sanityAcceptPayment({ ...n, amount: 1 }, vi.fn())).rejects.toThrow('Niezgodne');
    await sanityOrderAction({ orderId, action: 'cancel' }, 'admin');
    const verify = vi.fn(async () => {});
    await sanityAcceptPayment(n, verify);
    await sanityAcceptPayment(n, verify);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(docs.get(orderId)!.status).toBe('payment_review');
    expect(docs.get(orderId)!.entitlements).toEqual([]);
    expect((await sanityStock(state.catalog as never))[0]!.stock).toBe(1);
  });
  it('inventory adjustments reject negative stock and rate limiting persists in Sanity', async () => {
    await expect(sanityAdjustStock('book', -2, 'admin')).rejects.toThrow('ujemny');
    await sanityLimited('test', 1, 60);
    await expect(sanityLimited('test', 1, 60)).rejects.toThrow('Za dużo prób');
  });
  it('Studio API requires Sanity auth and returns only safe details without SQL', async () => {
    const data = input();
    await sanityCreateOrder(data);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'fip0o8g2',
              members: [
                {
                  id: 'admin',
                  roles: [{ name: 'administrator' }],
                  isCurrentUser: true,
                  isRobot: false,
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const url = new URL(
      `https://dietetykadlasmyka.pl/api/studio/orders/${idFor(data.idempotencyKey)}`,
    );
    const context = (authorized: boolean) =>
      ({
        url,
        params: { path: url.pathname.slice(5) },
        request: new Request(url, {
          headers: {
            Origin: 'https://dietetyka-dla-smyka.sanity.studio',
            ...(authorized ? { Authorization: 'Bearer test-user-token-long-enough' } : {}),
          },
        }),
        cookies: { get: () => undefined },
        clientAddress: '127.0.0.1',
      }) as unknown as APIContext;
    expect((await ALL(context(false))).status).toBe(401);
    const response = await ALL(context(true));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(data.email);
    expect(text).not.toContain('customer');
    expect(text).not.toContain('accessHash');
  });
});
