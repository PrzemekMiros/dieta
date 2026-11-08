import { db } from '../src/lib/server/db';
import { inventory } from '../src/lib/server/schema';
import { products } from '../src/lib/catalog';
import { env, isDemo } from '../src/lib/server/env';
if (env('APP_ENV') === 'production' && isDemo())
  throw new Error('Dane demonstracyjne nie są dozwolone w produkcji.');
const catalog = await products(true);
for (const product of catalog.filter((p) => p.productType === 'physical'))
  await db()
    .insert(inventory)
    .values({ productId: product._id, available: product.stock || 0 })
    .onConflictDoNothing();
console.log('Zainicjalizowano brakujące rekordy magazynowe. Istniejących stanów nie zmieniono.');
process.exit(0);
