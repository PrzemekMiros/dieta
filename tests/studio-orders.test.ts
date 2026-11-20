import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { APIContext } from 'astro';
import * as t from '../src/lib/server/schema';
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/lib/server/db', () => ({ db: () => state.db }));
vi.mock('../src/lib/catalog', () => ({
  products: async () => [],
  contentPage: async () => null,
  settings: async () => ({}),
}));
import { ALL } from '../src/pages/api/[...path]';
import { studioOrigin, studioToken } from '../src/lib/server/studio-access';

let engine: PGlite;
let database: ReturnType<typeof drizzle<typeof t>>;
let orderId: string;
const origin = 'https://dietetyka-dla-smyka.sanity.studio';
const raw = 'a'.repeat(64);
const sanityFetch = vi.fn();
const project = {
  id: 'fip0o8g2',
  members: [
    {
      id: 'sanity-user-1',
      isCurrentUser: true,
      isRobot: false,
      roles: [{ name: 'administrator' }],
    },
  ],
};
const cookies = { get: vi.fn(() => undefined), set: vi.fn(), delete: vi.fn() };

async function request(
  path: string,
  options: { method?: string; body?: unknown; token?: string; origin?: string } = {},
) {
  const url = new URL(`https://shop.example.test/api/${path}`);
  const response = await ALL({
    request: new Request(url, {
      method: options.method || (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        Origin: options.origin ?? origin,
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    url,
    params: { path: path.split('?')[0] },
    cookies,
    clientAddress: '127.0.0.1',
  } as unknown as APIContext);
  return response;
}

beforeAll(async () => {
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('DATABASE_URL', 'test');
  vi.stubEnv('SANITY_STUDIO_ORIGINS', origin);
  engine = new PGlite();
  database = drizzle(engine, { schema: t });
  state.db = database;
  await engine.exec(await readFile('drizzle/0000_initial.sql', 'utf8'));
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', sanityFetch);
  sanityFetch.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => project });
  await engine.exec(
    'TRUNCATE customers, orders, order_items, payments, shipments, audit_logs, email_outbox, rate_limits CASCADE',
  );
  const [customer] = await database
    .insert(t.customers)
    .values({ email: 'client@example.test', name: 'Jan Test' })
    .returning();
  const [order] = await database
    .insert(t.orders)
    .values({
      customerId: customer!.id,
      email: customer!.email,
      name: customer!.name,
      total: 10000,
      shipping: 1000,
      shippingMethod: 'courier',
      accessHash: 'private-access-hash',
      requestHash: 'private-request-hash',
      idempotencyKey: randomUUID(),
      consents: {},
      address: { street: 'Testowa 1' },
      phone: '500600700',
      invoice: { nip: '1234567890', name: 'Private invoice company' },
    })
    .returning();
  orderId = order!.id;
  await database.insert(t.payments).values({
    orderId,
    sessionId: orderId,
    status: 'cod_pending',
    token: 'private-provider-token',
  });
  await database.insert(t.shipments).values({ orderId });
  await database.insert(t.orderItems).values({
    orderId,
    productId: 'test',
    sku: 'TEST',
    name: 'Produkt',
    type: 'physical',
    quantity: 1,
    unitPrice: 9000,
    taxRate: 23,
    assetKey: 'private-asset-key',
  });
});
afterAll(async () => {
  await engine.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('panel zamówień Sanity', () => {
  it('allows only exact configured origins and handles preflight without authentication', async () => {
    const denied = await request('studio/orders', { token: raw, origin: origin + '.evil.test' });
    expect(denied.status).toBe(403);
    expect(denied.headers.has('Access-Control-Allow-Origin')).toBe(false);
    const preflight = await request('studio/orders', { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(preflight.headers.has('Access-Control-Allow-Credentials')).toBe(false);
    expect(() => studioOrigin(new Request('https://shop.example.test'))).toThrow();
    expect(() =>
      studioOrigin(
        new Request('https://shop.example.test', { headers: { Origin: 'http://localhost:3333' } }),
      ),
    ).toThrow();
  });
  it('requires a bearer session even when a shop cookie is supplied', async () => {
    cookies.get.mockReturnValueOnce({ value: raw } as never);
    for (const path of ['studio/orders', `studio/orders/${orderId}`]) {
      const response = await request(path);
      expect(response.status).toBe(401);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
    expect((await request('studio/order', { body: { orderId, action: 'cancel' } })).status).toBe(
      401,
    );
    expect(
      studioToken(
        new Request('https://shop.example.test', { headers: { Authorization: 'Bearer invalid' } }),
      ),
    ).toBeUndefined();
    expect(cookies.get).not.toHaveBeenCalled();
  });
  it('uses Sanity directly without creating a shop account or session', async () => {
    expect((await request('studio/orders', { token: raw })).status).toBe(200);
    expect(sanityFetch).toHaveBeenCalledWith(
      'https://api.sanity.io/v2021-06-07/projects/fip0o8g2?includeMembers=true',
      expect.objectContaining({ headers: { Authorization: 'Bearer ' + raw } }),
    );
    expect(await database.select().from(t.adminUsers)).toHaveLength(0);
    expect(await database.select().from(t.adminSessions)).toHaveLength(0);
    expect((await request('studio/login', { body: {} })).status).toBe(404);
    expect((await request('studio/logout', { body: {}, token: raw })).status).toBe(404);
  });
  it('filters orders and returns details without internal credentials', async () => {
    const response = await request(`studio/orders?q=${orderId.slice(0, 8)}&status=pending`, {
      token: raw,
    });
    const list = await response.json();
    expect(list.orders).toHaveLength(1);
    expect(list.stats.pending).toBe(1);
    expect(
      (await (await request('studio/orders?q=absent', { token: raw })).json()).orders,
    ).toHaveLength(0);
    const detail = await (await request(`studio/orders/${orderId}`, { token: raw })).json();
    for (const order of [...list.orders, detail.order]) {
      for (const field of ['name', 'email', 'phone', 'address', 'invoice', 'customerId'])
        expect(order).not.toHaveProperty(field);
    }
    expect(detail.items).toHaveLength(1);
    const output = JSON.stringify({ list, detail });
    for (const secret of [
      'private-access-hash',
      'private-request-hash',
      'private-provider-token',
      'private-asset-key',
      'Jan Test',
      'client@example.test',
      'Testowa 1',
      '500600700',
      '1234567890',
      'Private invoice company',
    ])
      expect(output).not.toContain(secret);
  });
  it('does not allow customer data to be used as a search oracle', async () => {
    for (const query of ['Jan', 'client@example.test', 'Testowa', '500600700']) {
      const response = await request(`studio/orders?q=${encodeURIComponent(query)}`, {
        token: raw,
      });
      expect((await response.json()).orders).toEqual([]);
    }
  });
  it('validates filters, ids and limits exposed operations', async () => {
    expect((await request('studio/orders?page=-1', { token: raw })).status).toBe(400);
    expect((await request('studio/orders?status=unknown', { token: raw })).status).toBe(400);
    expect((await request('studio/orders/invalid', { token: raw })).status).toBe(400);
    expect((await request(`studio/orders/${randomUUID()}`, { token: raw })).status).toBe(404);
    expect((await request('studio/inventory', { token: raw, body: {} })).status).toBe(404);
    expect((await request('studio/order', { token: raw, method: 'DELETE' })).status).toBe(404);
  });
  it('uses existing shipment validation, saves audit history and queues mail', async () => {
    expect(
      (
        await request('studio/order', {
          token: raw,
          body: { orderId, action: 'shipment', status: 'shipped' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('studio/order', {
          token: raw,
          body: { orderId, action: 'shipment', status: 'shipped', tracking: 'TRACK-123' },
        })
      ).status,
    ).toBe(200);
    const detail = await (await request(`studio/orders/${orderId}`, { token: raw })).json();
    expect(detail.shipment).toEqual({ status: 'shipped', tracking: 'TRACK-123' });
    expect(detail.audit[0].action).toBe('shipment');
    expect(await database.select().from(t.emailOutbox)).toHaveLength(1);
    expect(
      (await request('studio/order', { token: raw, body: { orderId, action: 'cancel' } })).status,
    ).toBe(409);
  });
  it('rejects revoked tokens, other projects, robots and non-administrators', async () => {
    sanityFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    expect((await request('studio/orders', { token: raw })).status).toBe(401);
    for (const data of [
      { ...project, id: 'other-project' },
      { ...project, members: [] },
      { ...project, members: [{ ...project.members[0], isRobot: true }] },
      { ...project, members: [{ ...project.members[0], isCurrentUser: false }] },
      { ...project, members: [{ ...project.members[0], roles: [{ name: 'editor' }] }] },
    ]) {
      sanityFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
      expect((await request('studio/orders', { token: raw })).status).toBe(403);
    }
    sanityFetch.mockRejectedValueOnce(new Error('offline'));
    expect((await request('studio/orders', { token: raw })).status).toBe(503);
  });
  it('rechecks authorization before mutations and records the Sanity actor', async () => {
    expect((await request('studio/orders', { token: raw })).status).toBe(200);
    sanityFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    expect(
      (await request('studio/order', { token: raw, body: { orderId, action: 'confirm-cod' } }))
        .status,
    ).toBe(403);
    expect((await database.select().from(t.orders))[0].status).toBe('pending');
    expect(
      (await request('studio/order', { token: raw, body: { orderId, action: 'confirm-cod' } }))
        .status,
    ).toBe(200);
    const [audit] = await database.select().from(t.auditLogs);
    expect(audit.adminId).toBeNull();
    expect(audit.data).toMatchObject({ sanityUserId: 'sanity-user-1' });
  });
});
