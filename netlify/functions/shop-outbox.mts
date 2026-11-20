import { processSanityOutbox } from '../../src/lib/server/sanity-shop-jobs';
import { env } from '../../src/lib/server/env';

export default async () => {
  if (!env('SANITY_ORDERS_TOKEN')) return new Response(null, { status: 204 });
  await processSanityOutbox();
  return new Response(null, { status: 204 });
};
export const config = { schedule: '* * * * *' };
