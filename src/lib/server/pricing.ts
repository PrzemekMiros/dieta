import type { Product } from '../types';
import { env } from './env';
import { HttpError } from './security';
export interface ShippingMethod {
  id: string;
  name: string;
  price: number;
}
export function shippingMethods(): ShippingMethod[] {
  const methods = JSON.parse(
    env('SHIPPING_METHODS', '[{"id":"standard","name":"Dostawa standardowa","price":1690}]'),
  ) as ShippingMethod[];
  if (!methods.every((m) => m.id && m.name && Number.isSafeInteger(m.price) && m.price >= 0))
    throw new Error('Niepoprawna konfiguracja dostawy');
  return methods;
}
export function calculate(
  items: { id: string; quantity: number }[],
  catalog: Product[],
  method?: string,
) {
  const lines = items.map((item) => {
    const p = catalog.find((p) => p._id === item.id && p.active);
    if (!p || !Number.isSafeInteger(p.price) || p.price <= 0 || !Number.isInteger(p.taxRate))
      throw new HttpError(400, 'Produkt jest niedostępny.');
    if (p.productType === 'digital' && item.quantity !== 1)
      throw new HttpError(400, 'Ebook można kupić w jednej sztuce.');
    return { ...p, quantity: item.quantity };
  });
  const physical = lines.some((p) => p.productType === 'physical');
  const digital = lines.some((p) => p.productType === 'digital');
  const methods = physical ? shippingMethods() : [];
  const selected = physical ? methods.find((m) => m.id === (method || methods[0]?.id)) : undefined;
  if (physical && !selected) throw new HttpError(400, 'Wybierz dostępną metodę dostawy.');
  const subtotal = lines.reduce((sum, p) => sum + p.price * p.quantity, 0),
    shipping = selected?.price || 0,
    total = subtotal + shipping;
  if (!Number.isSafeInteger(total) || total > 100_000_000)
    throw new HttpError(400, 'Niepoprawna wartość zamówienia.');
  return {
    lines,
    physical,
    digital,
    methods,
    shippingMethod: selected?.id,
    subtotal,
    shipping,
    total,
  };
}
