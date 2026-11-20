import type { Product } from '../types';
import { env, isDemo } from './env';

export async function storefrontStock(catalog: Product[]): Promise<Product[]> {
  if (
    isDemo() ||
    env('SHOP_STORAGE', 'sanity') !== 'sanity' ||
    !catalog.some((p) => p.productType === 'physical')
  )
    return catalog;
  try {
    const { sanityStock } = await import('./sanity-orders');
    return await sanityStock(catalog);
  } catch {
    // A public catalog field must never override the transactional inventory.
    // Keep the catalog readable during a storage outage, without offering stock
    // that the checkout cannot reserve. Do not log tokens or customer details.
    console.error(JSON.stringify({ event: 'storefront_inventory_unavailable' }));
    return catalog.map((p) => (p.productType === 'physical' ? { ...p, stock: 0 } : p));
  }
}
