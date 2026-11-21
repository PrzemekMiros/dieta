import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '../src/lib/server/schema';
import { demoProducts } from '../src/data/demo';
const state = vi.hoisted(() => ({ db: undefined as unknown, catalog: [] as unknown[] }));
vi.mock('../src/lib/server/db', () => ({ db: () => state.db }));
vi.mock('../src/lib/catalog', () => ({
  products: async () => state.catalog,
  contentPage: async () => ({ content: [{ _type: 'block' }] }),
  settings: async () => ({ email: 'shop@example.test', companyName: 'Test' }),
}));
import {
  salesReady,
  createOrder,
  cancelOrder,
  confirmCashOnDelivery,
  resendLinks,
} from '../src/lib/server/orders';
import { entitlementFor } from '../src/lib/server/digital';
import { hash, token, limited, session, passwordHash } from '../src/lib/server/security';
let engine: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
beforeAll(async () => {
  vi.stubEnv('SHOP_STORAGE', 'postgres');
  engine = new PGlite();
  database = drizzle(engine, { schema });
  state.db = database;
  await engine.exec(await readFile('drizzle/0000_initial.sql', 'utf8'));
  Object.assign(process.env, {
    SALES_ENABLED: 'true',
    PAYMENT_PROVIDER: 'tpay',
    COD_ENABLED: 'true',
    DEMO_CATALOG: 'false',
    APP_ENV: 'test',
    DATABASE_URL: 'test',
    SMTP_HOST: 'test',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
  });
});
beforeEach(async () => {
  await engine.exec(
    'TRUNCATE customers,orders,order_items,payments,payment_events,shipments,digital_entitlements,download_tokens,inventory,inventory_movements,email_outbox RESTART IDENTITY CASCADE',
  );
  state.catalog = demoProducts.map((p) => ({
    ...p,
    demo: false,
    digitalFileUrl:
      p.productType === 'digital'
        ? 'https://cdn.sanity.io/files/test/dataset/private/test.pdf'
        : undefined,
  }));
  await database.insert(schema.inventory).values({ productId: 'demo-4', available: 3 });
});
afterAll(async () => {
  await engine.close();
});
const input = (items = [{ id: 'demo-4', quantity: 1 }]) => ({
  items,
  paymentMethod: 'cod' as const,
  idempotencyKey: randomUUID(),
  accessToken: token(),
  firstName: 'Jan',
  lastName: 'Test',
  email: 'test@example.test',
  terms: true as const,
  digitalConsent: true,
  phone: '500600700',
  address: { street: 'Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' as const },
});
describe('zamówienia — prawdziwe transakcje PostgreSQL w PGlite', () => {
  it('sesja administratora wygasa i limity blokują nadmiar prób', async () => {
    const [admin] = await database
      .insert(schema.adminUsers)
      .values({
        email: `${randomUUID()}@example.test`,
        passwordHash: await passwordHash('long-test-password-123'),
      })
      .returning();
    const raw = token();
    await database
      .insert(schema.adminSessions)
      .values({ userId: admin!.id, hash: hash(raw), expiresAt: new Date(Date.now() + 60000) });
    expect((await session(raw))?.id).toBe(admin!.id);
    await database
      .update(schema.adminSessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.adminSessions.hash, hash(raw)));
    expect(await session(raw)).toBeNull();
    const key = randomUUID();
    await limited(key, 2);
    await limited(key, 2);
    await expect(limited(key, 2)).rejects.toThrow('Za dużo prób');
  });
  it('tworzy pobranie dla produktów fizycznych i oznacza płatność dopiero po odbiorze gotówki', async () => {
    const data = { ...input([{ id: 'demo-4', quantity: 2 }]), paymentMethod: 'cod' as const };
    const salesEnabled = process.env.SALES_ENABLED;
    process.env.SALES_ENABLED = 'false';
    let result: Awaited<ReturnType<typeof createOrder>>;
    try {
      expect(() => salesReady('tpay')).toThrow('Sklep nie przyjmuje jeszcze zamówień.');
      result = await createOrder(data);
      expect(await createOrder(data)).toEqual(result);
    } finally {
      if (salesEnabled === undefined) delete process.env.SALES_ENABLED;
      else process.env.SALES_ENABLED = salesEnabled;
    }
    expect(result.redirect).toContain('/zamowienie/sukces?token=');
    expect((await database.select().from(schema.orders))[0]?.status).toBe('pending');
    expect((await database.select().from(schema.payments))[0]?.status).toBe('cod_pending');
    expect((await database.select().from(schema.shipments))[0]?.status).toBe('preparing');
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(1);
    expect((await database.select().from(schema.emailOutbox))[0]?.html).toContain(
      'gotówką przy odbiorze przesyłki',
    );

    const [order] = await database.select().from(schema.orders);
    await database.transaction((tx) => confirmCashOnDelivery(tx as never, order!.id));
    expect((await database.select().from(schema.orders))[0]?.status).toBe('paid');
    expect((await database.select().from(schema.payments))[0]?.status).toBe('cod_collected');
    expect((await database.select().from(schema.paymentEvents)).map((event) => event.kind)).toEqual(
      ['cod_ordered', 'cod_collected'],
    );
    expect(await database.select().from(schema.emailOutbox)).toHaveLength(2);
  });
  it('odrzuca pobranie dla ebooków i koszyka mieszanego', async () => {
    const digital = { ...input([{ id: 'demo-1', quantity: 1 }]), paymentMethod: 'cod' as const };
    await expect(createOrder(digital)).rejects.toThrow('tylko dla produktów fizycznych');
    const mixed = {
      ...input([
        { id: 'demo-1', quantity: 1 },
        { id: 'demo-4', quantity: 1 },
      ]),
      paymentMethod: 'cod' as const,
    };
    await expect(createOrder(mixed)).rejects.toThrow('tylko dla produktów fizycznych');
    expect(await database.select().from(schema.orders)).toHaveLength(0);
  });
  it('wymaga jawnego włączenia płatności za pobraniem', async () => {
    const codEnabled = process.env.COD_ENABLED;
    process.env.COD_ENABLED = 'false';
    const data = { ...input([{ id: 'demo-4', quantity: 1 }]), paymentMethod: 'cod' as const };
    try {
      await expect(createOrder(data)).rejects.toThrow('nie jest obecnie dostępna');
      expect(await database.select().from(schema.orders)).toHaveLength(0);
    } finally {
      process.env.COD_ENABLED = codEnabled || 'true';
    }
  });
  it('nie pozwala anulować pobrania po przekazaniu przesyłki do dostawy', async () => {
    const data = { ...input([{ id: 'demo-4', quantity: 1 }]), paymentMethod: 'cod' as const };
    await createOrder(data);
    const [order] = await database.select().from(schema.orders);
    await database
      .update(schema.shipments)
      .set({ status: 'shipped' })
      .where(eq(schema.shipments.orderId, order!.id));
    await expect(database.transaction((tx) => cancelOrder(tx as never, order!.id))).rejects.toThrow(
      'po przekazaniu przesyłki',
    );
    expect((await database.select().from(schema.orders))[0]?.status).toBe('pending');
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(2);
  });
  it('odrzuca brak stanu i wycofuje transakcję', async () => {
    await expect(createOrder(input([{ id: 'demo-4', quantity: 4 }]))).rejects.toThrow();
    expect(await database.select().from(schema.orders)).toHaveLength(0);
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(3);
  });
  it('powtórzony checkout używa istniejącej płatności', async () => {
    const data = input();
    await createOrder(data);
    await createOrder(data);
    expect(await database.select().from(schema.orders)).toHaveLength(1);
    await expect(createOrder({ ...data, email: 'other@example.test' })).rejects.toThrow();
  });
  it('anulowanie zwalnia stan tylko jeden raz', async () => {
    await createOrder(input([{ id: 'demo-4', quantity: 2 }]));
    const [order] = await database.select().from(schema.orders);
    await database.transaction((tx) => cancelOrder(tx as never, order!.id));
    await database.transaction((tx) => cancelOrder(tx as never, order!.id));
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(3);
    expect((await database.select().from(schema.orders))[0]?.status).toBe('cancelled');
    expect(await database.select().from(schema.entitlements)).toHaveLength(0);
  });
  it('blokuje Tpay przed zapisem zamówienia mimo włączonej sprzedaży', async () => {
    await expect(createOrder({ ...input(), paymentMethod: 'tpay' })).rejects.toThrow(
      'Sklep nie przyjmuje',
    );
    expect(await database.select().from(schema.orders)).toHaveLength(0);
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(3);
    expect(await database.select().from(schema.emailOutbox)).toHaveLength(0);
  });
  it('pobieranie wymaga aktywnego opłaconego uprawnienia i ważnego tokenu', async () => {
    await createOrder(input());
    // Seed a historical paid digital order independently of any payment provider.
    const [order] = await database.select().from(schema.orders);
    const [item] = await database.select().from(schema.orderItems);
    await database
      .update(schema.orders)
      .set({ status: 'paid' })
      .where(eq(schema.orders.id, order!.id));
    const [entitlement] = await database
      .insert(schema.entitlements)
      .values({
        orderId: order!.id,
        itemId: item!.id,
        assetKey: 'https://cdn.sanity.io/files/test/dataset/private/test.pdf',
      })
      .returning();
    const raw = token();
    await database.insert(schema.downloadTokens).values({
      entitlementId: entitlement!.id,
      hash: hash(raw),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await entitlementFor(raw)).id).toBe(entitlement!.id);
    await database
      .update(schema.downloadTokens)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.downloadTokens.hash, hash(raw)));
    await expect(entitlementFor(raw)).rejects.toThrow();
    await expect(entitlementFor(token())).rejects.toThrow();
    await database.transaction((tx) => resendLinks(tx as never, order!.id));
    expect(await database.select().from(schema.downloadTokens)).toHaveLength(1);
  });
});
