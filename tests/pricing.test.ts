import { describe, it, expect } from 'vitest';
import { calculate } from '../src/lib/server/pricing';
import { cartSchema, checkoutSchema } from '../src/lib/server/checkout-input';
import { demoProducts } from '../src/data/demo';
import { notificationSign, sign } from '../src/lib/server/p24';
import { passwordHash, passwordMatches, sameOrigin } from '../src/lib/server/security';
import { createHash } from 'node:crypto';
describe('wycena koszyka', () => {
  it('ebook bez kosztu dostawy', () => {
    const q = calculate([{ id: 'demo-1', quantity: 1 }], demoProducts);
    expect(q.total).toBe(8900);
    expect(q.physical).toBe(false);
  });
  it('fizyczny z kosztem dostawy', () => {
    expect(calculate([{ id: 'demo-4', quantity: 2 }], demoProducts).total).toBe(7490);
  });
  it('koszyk mieszany zachowuje ceny serwera', () => {
    const q = calculate(
      [
        { id: 'demo-1', quantity: 1 },
        { id: 'demo-4', quantity: 2 },
      ],
      demoProducts,
    );
    expect(q.total).toBe(16390);
    expect(q.digital && q.physical).toBe(true);
  });
  it('odrzuca nieaktywne produkty i nieznaną dostawę', () => {
    expect(() => calculate([{ id: 'missing', quantity: 1 }], demoProducts)).toThrow();
    expect(() => calculate([{ id: 'demo-4', quantity: 1 }], demoProducts, 'free-hack')).toThrow();
  });
  it('odrzuca duplikaty, ilości ujemne, ułamkowe i wiele kopii ebooka', () => {
    for (const items of [
      [{ id: 'a', quantity: 0 }],
      [{ id: 'a', quantity: 1.5 }],
      [
        { id: 'a', quantity: 1 },
        { id: 'a', quantity: 1 },
      ],
    ])
      expect(cartSchema.safeParse(items).success).toBe(false);
    expect(() => calculate([{ id: 'demo-1', quantity: 2 }], demoProducts)).toThrow();
  });
  it('nie przyjmuje ceny z przeglądarki', () => {
    const parsed = cartSchema.parse([{ id: 'demo-1', quantity: 1, price: 1 }]);
    expect(parsed[0]).not.toHaveProperty('price');
  });
  it('wymaga regulaminu i poprawnego maila', () => {
    expect(
      checkoutSchema.safeParse({
        items: [{ id: 'demo-1', quantity: 1 }],
        terms: false,
        email: 'bad',
      }).success,
    ).toBe(false);
  });
});
describe('bezpieczeństwo', () => {
  it('scrypt weryfikuje hasło i losuje sól', async () => {
    const a = await passwordHash('a very long safe password');
    const b = await passwordHash('a very long safe password');
    expect(a).not.toBe(b);
    expect(await passwordMatches('a very long safe password', a)).toBe(true);
    expect(await passwordMatches('wrong', a)).toBe(false);
  });
  it('blokuje brak Origin oraz obcą domenę', () => {
    expect(() => sameOrigin(new Request('http://localhost/api'))).toThrow();
    expect(() =>
      sameOrigin(new Request('http://localhost/api', { headers: { origin: 'https://evil.test' } })),
    ).toThrow();
    expect(() =>
      sameOrigin(
        new Request('http://localhost/api', { headers: { origin: 'http://localhost:3000' } }),
      ),
    ).not.toThrow();
  });
  it('podpis P24 zachowuje typy, kolejność i UTF-8', () => {
    const n = {
      merchantId: 1,
      posId: 2,
      sessionId: 's/ą',
      amount: 100,
      originAmount: 100,
      currency: 'PLN' as const,
      orderId: 3,
      methodId: 4,
      statement: 'Zażółć',
    };
    const expected = createHash('sha384')
      .update(
        '{"merchantId":1,"posId":2,"sessionId":"s/ą","amount":100,"originAmount":100,"currency":"PLN","orderId":3,"methodId":4,"statement":"Zażółć","crc":"test"}',
      )
      .digest('hex');
    expect(notificationSign(n, 'test')).toBe(expected);
    expect(sign({ a: 1 })).not.toBe(sign({ a: '1' }));
  });
});
