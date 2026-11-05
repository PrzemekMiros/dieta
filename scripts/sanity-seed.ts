import { createClient } from '@sanity/client';
import { demoProducts, demoPosts } from '../src/data/demo';
import { required, env } from '../src/lib/server/env';
if (env('SANITY_DATASET') === 'production' || env('APP_ENV') === 'production')
  throw new Error('Seed dozwolony wyłącznie na datasecie development.');
const client = createClient({
  projectId: required('SANITY_PROJECT_ID'),
  dataset: required('SANITY_DATASET'),
  token: required('SANITY_WRITE_TOKEN'),
  apiVersion: '2026-11-05',
  useCdn: false,
});
for (const p of demoProducts)
  await client.createIfNotExists({
    _type: 'product',
    ...p,
    slug: { _type: 'slug', current: p.slug },
    active: false,
  });
for (const p of demoPosts)
  await client.createIfNotExists({
    _id: `post-${p.slug}`,
    _type: 'blogPost',
    ...p,
    slug: { _type: 'slug', current: p.slug },
  });
console.log('Dodano nieaktywne produkty demonstracyjne i przykładowy artykuł.');
