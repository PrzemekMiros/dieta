import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Product } from '../src/lib/types';
const stock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/server/sanity-orders', () => ({ sanityStock: stock }));
import { storefrontStock } from '../src/lib/server/storefront-stock';
beforeEach(() => {
  vi.stubEnv('SHOP_STORAGE', 'sanity');
  vi.stubEnv('DEMO_CATALOG', 'false');
  stock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const physical = { _id: 'bread', productType: 'physical', stock: 0 } as Product;
it('shows inventory stock even when the old catalog field is zero', async () => {
  stock.mockResolvedValue([{ ...physical, stock: 5 }]);
  expect((await storefrontStock([physical]))[0]!.stock).toBe(5);
});
it('does not use outdated catalog stock when inventory cannot be read', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  stock.mockRejectedValue(new Error('private configuration details'));
  expect((await storefrontStock([{ ...physical, stock: 100 }]))[0]!.stock).toBe(0);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private configuration details');
});
it('does not require the private inventory for digital-only catalogs', async () => {
  const digital = { ...physical, productType: 'digital' } as Product;
  expect(await storefrontStock([digital])).toEqual([digital]);
  expect(stock).not.toHaveBeenCalled();
});
