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
vi.mock('../src/lib/server/p24', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/server/p24')>();
  return { ...original, registerPayment: vi.fn(async () => 'test-provider-token') };
});
import {
  salesReady,
  createOrder,
  acceptPayment,
  cancelOrder,
  confirmCashOnDelivery,
  resendLinks,
} from '../src/lib/server/orders';
import { entitlementFor } from '../src/lib/server/digital';
import { hash, token, limited, session, passwordHash } from '../src/lib/server/security';
import type { Notification } from '../src/lib/server/p24';
import { registerPayment } from '../src/lib/server/p24';
let engine: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
beforeAll(async () => {
  engine = new PGlite();
  database = drizzle(engine, { schema });
  state.db = database;
  await engine.exec(await readFile('drizzle/0000_initial.sql', 'utf8'));
  Object.assign(process.env, {
    SALES_ENABLED: 'true',
    COD_ENABLED: 'true',
    DEMO_CATALOG: 'false',
    APP_ENV: 'test',
    DATABASE_URL: 'test',
    P24_MERCHANT_ID: '1',
    P24_POS_ID: '1',
    P24_CRC: 'test',
    P24_API_KEY: 'test',
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
    digitalAssetReference: p.productType === 'digital' ? 'private/test.pdf' : undefined,
  }));
  await database.insert(schema.inventory).values({ productId: 'demo-4', available: 3 });
  vi.mocked(registerPayment).mockResolvedValue('test-provider-token');
});
afterAll(async () => {
  await engine.close();
});
const input = (items = [{ id: 'demo-1', quantity: 1 }]) => ({
  items,
  paymentMethod: 'p24' as const,
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
async function notification(): Promise<Notification> {
  const [order] = await database.select().from(schema.orders);
  return {
    merchantId: 1,
    posId: 1,
    sessionId: order!.id,
    amount: order!.total,
    originAmount: order!.total,
    currency: 'PLN',
    orderId: 123,
    methodId: 1,
    statement: 'test',
    sign: '0'.repeat(96),
  };
}
describe('zamówienia i callback — prawdziwe transakcje PostgreSQL w PGlite', () => {
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
  it.each(['digital', 'physical', 'mixed'])('realizuje zakup %s po weryfikacji', async (kind) => {
    const items =
      kind === 'digital'
        ? [{ id: 'demo-1', quantity: 1 }]
        : kind === 'physical'
          ? [{ id: 'demo-4', quantity: 2 }]
          : [
              { id: 'demo-1', quantity: 1 },
              { id: 'demo-2', quantity: 1 },
              { id: 'demo-4', quantity: 2 },
            ];
    await createOrder(input(items));
    const verify = vi.fn(async () => {});
    await acceptPayment(await notification(), verify);
    expect(verify).toHaveBeenCalledOnce();
    expect((await database.select().from(schema.orders))[0]?.status).toBe('paid');
    expect((await database.select().from(schema.entitlements)).length).toBe(
      kind === 'digital' ? 1 : kind === 'mixed' ? 2 : 0,
    );
    expect((await database.select().from(schema.shipments)).length).toBe(
      kind === 'digital' ? 0 : 1,
    );
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(
      kind === 'digital' ? 3 : 1,
    );
  });
  it('tworzy pobranie dla produktów fizycznych i oznacza płatność dopiero po odbiorze gotówki', async () => {
    const data = { ...input([{ id: 'demo-4', quantity: 2 }]), paymentMethod: 'cod' as const };
    const register = vi.mocked(registerPayment);
    register.mockClear();
    const salesEnabled = process.env.SALES_ENABLED;
    process.env.SALES_ENABLED = 'false';
    let result: Awaited<ReturnType<typeof createOrder>>;
    try {
      expect(() => salesReady('p24')).toThrow('Sklep nie przyjmuje jeszcze zamówień.');
      result = await createOrder(data);
      expect(await createOrder(data)).toEqual(result);
    } finally {
      if (salesEnabled === undefined) delete process.env.SALES_ENABLED;
      else process.env.SALES_ENABLED = salesEnabled;
    }
    expect(result.redirect).toContain('/zamowienie/sukces?token=');
    expect(register).not.toHaveBeenCalled();
    expect((await database.select().from(schema.orders))[0]?.status).toBe('pending');
    expect((await database.select().from(schema.payments))[0]?.status).toBe('cod_pending');
    expect((await database.select().from(schema.shipments))[0]?.status).toBe('preparing');
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(1);
    const verify = vi.fn(async () => {});
    await expect(acceptPayment(await notification(), verify)).rejects.toThrow();
    expect(verify).not.toHaveBeenCalled();
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
  it('ponowiony callback nie wydaje ebooka ani nie pomniejsza stanu', async () => {
    await createOrder(
      input([
        { id: 'demo-1', quantity: 1 },
        { id: 'demo-4', quantity: 2 },
      ]),
    );
    const n = await notification(),
      verify = vi.fn(async () => {});
    await acceptPayment(n, verify);
    await acceptPayment(n, verify);
    expect(verify).toHaveBeenCalledOnce();
    expect(await database.select().from(schema.entitlements)).toHaveLength(1);
    expect(await database.select().from(schema.downloadTokens)).toHaveLength(1);
    expect(await database.select().from(schema.inventoryMovements)).toHaveLength(1);
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(1);
    expect(await database.select().from(schema.emailOutbox)).toHaveLength(2);
  });
  it('błędna kwota i odrzucona weryfikacja nie realizują zamówienia', async () => {
    await createOrder(input());
    const n = await notification();
    await expect(acceptPayment({ ...n, amount: 1 }, async () => {})).rejects.toThrow();
    await expect(
      acceptPayment(n, async () => {
        throw new Error('P24 failed');
      }),
    ).rejects.toThrow();
    expect((await database.select().from(schema.orders))[0]?.status).toBe('pending');
    expect(await database.select().from(schema.entitlements)).toHaveLength(0);
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
  it('anulowanie zwalnia stan jeden raz; późna płatność trafia do kontroli', async () => {
    await createOrder(
      input([
        { id: 'demo-1', quantity: 1 },
        { id: 'demo-4', quantity: 2 },
      ]),
    );
    const n = await notification();
    await database.transaction((tx) => cancelOrder(tx as never, n.sessionId));
    await database.transaction((tx) => cancelOrder(tx as never, n.sessionId));
    expect((await database.select().from(schema.inventory))[0]?.available).toBe(3);
    await acceptPayment(n, async () => {});
    expect((await database.select().from(schema.orders))[0]?.status).toBe('payment_review');
    expect(await database.select().from(schema.entitlements)).toHaveLength(0);
  });
  it('timeout rejestracji nie powtarza transakcji automatycznie', async () => {
    vi.mocked(registerPayment).mockRejectedValue(new Error('timeout'));
    const data = input();
    await expect(createOrder(data)).rejects.toThrow();
    await expect(createOrder(data)).rejects.toThrow();
    expect((await database.select().from(schema.payments))[0]?.status).toBe('registration_unknown');
    expect(await database.select().from(schema.orders)).toHaveLength(1);
  });
  it('pobieranie wymaga aktywnego opłaconego uprawnienia i ważnego tokenu', async () => {
    await createOrder(input());
    const n = await notification();
    await acceptPayment(n, async () => {});
    const [entitlement] = await database.select().from(schema.entitlements);
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
    await database.transaction((tx) => resendLinks(tx as never, n.sessionId));
    expect(await database.select().from(schema.downloadTokens)).toHaveLength(1);
  });
});
