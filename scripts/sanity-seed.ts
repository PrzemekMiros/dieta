import { createReadStream } from 'node:fs';
import { basename, join } from 'node:path';
import { createClient } from '@sanity/client';
import { demoProducts, demoPosts } from '../src/data/demo';
import { required, env } from '../src/lib/server/env';

if (env('SANITY_DATASET') === 'production' || env('APP_ENV') === 'production') {
  throw new Error('Seed jest dozwolony wyłącznie na datasecie development.');
}

const client = createClient({
  projectId: required('SANITY_PROJECT_ID'),
  dataset: required('SANITY_DATASET'),
  token: required('SANITY_WRITE_TOKEN'),
  apiVersion: '2026-11-05',
  useCdn: false,
});

const uploadedAssets = new Map<string, string>();

async function uploadDemoImage(publicPath: string) {
  const existing = uploadedAssets.get(publicPath);
  if (existing) return existing;

  const absolutePath = join(process.cwd(), 'public', publicPath.replace(/^\//, ''));
  const asset = await client.assets.upload('image', createReadStream(absolutePath), {
    filename: basename(absolutePath),
  });
  uploadedAssets.set(publicPath, asset._id);
  return asset._id;
}

for (const product of demoProducts) {
  const assetId = await uploadDemoImage(product.image);
  const { _id: _legacyId, image: _legacyImage, images: _legacyImages, demo: _demo, ...fields } =
    product;
  const exists = await client.fetch<boolean>('count(*[_type == "product" && sku == $sku]) > 0', {
    sku: product.sku,
  });

  if (exists) continue;

  await client.create({
    ...fields,
    _type: 'product',
    slug: { _type: 'slug', current: product.slug },
    images: [
      {
        _key: 'cover',
        _type: 'image',
        alt: product.name,
        asset: { _type: 'reference', _ref: assetId },
      },
    ],
    active: false,
  });
}

for (const post of demoPosts) {
  const assetId = post.image ? await uploadDemoImage(post.image) : undefined;
  const { image: _legacyImage, imageAlt: _imageAlt, seoTitle, seoDescription, ...fields } = post;
  const exists = await client.fetch<boolean>(
    'count(*[_type == "blogPost" && slug.current == $slug]) > 0',
    { slug: post.slug },
  );

  if (exists) continue;

  await client.create({
    ...fields,
    _type: 'blogPost',
    slug: { _type: 'slug', current: post.slug },
    coverImage: assetId
      ? {
          _type: 'image',
          alt: post.imageAlt || post.title,
          asset: { _type: 'reference', _ref: assetId },
        }
      : undefined,
    seo: seoTitle || seoDescription ? { title: seoTitle, description: seoDescription } : undefined,
  });
}

console.log('Dodano nieaktywne produkty demonstracyjne i przykładowe wpisy blogowe.');
