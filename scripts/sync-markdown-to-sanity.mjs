import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { markdownToPortableText } from '@portabletext/markdown';
import { createClient } from '@sanity/client';
import matter from 'gray-matter';

const root = resolve(import.meta.dirname, '..');
const articlesDir = join(root, 'src', 'content', 'artykuly');
const productsDir = join(root, 'src', 'content', 'produkty');
const projectId = process.env.SANITY_PROJECT_ID || process.env.PUBLIC_SANITY_PROJECT_ID || 'fip0o8g2';
const dataset = process.env.SANITY_DATASET || process.env.PUBLIC_SANITY_DATASET || 'production';
const apiVersion = process.env.PUBLIC_SANITY_API_VERSION || '2026-11-05';
const token = process.env.SANITY_WRITE_TOKEN;

if (!token) throw new Error('Brak SANITY_WRITE_TOKEN. Dodaj sekret w GitHub Actions.');

const client = createClient({ projectId, dataset, apiVersion, token, useCdn: false });
const allowedStyles = new Set(['normal', 'h2', 'h3']);

function cleanPortableText(markdown) {
  return markdownToPortableText(markdown)
    .filter((block) => block?._type === 'block')
    .map((block) => {
      const cleaned = {
        ...block,
        style: allowedStyles.has(block.style) ? block.style : 'normal',
        markDefs: [],
        children: (block.children || []).map((child) => ({ ...child, marks: [] })),
      };
      delete cleaned.listItem;
      delete cleaned.level;
      return cleaned;
    });
}

function portableTextToPlainText(blocks) {
  return blocks
    .map((block) => (block.children || []).map((child) => child.text || '').join(''))
    .filter(Boolean)
    .join('\n\n');
}

function requiredText(data, key, file) {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${file}: brak wymaganego pola frontmatter „${key}”.`);
  }
  return value.trim();
}

function requiredNumber(data, key, file, { integer = false, min = 0 } = {}) {
  const value = Number(data[key]);
  if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    throw new Error(`${file}: pole „${key}” musi być liczbą${integer ? ' całkowitą' : ''} nie mniejszą niż ${min}.`);
  }
  return value;
}

function optionalNumber(data, key, file, options) {
  if (data[key] === undefined || data[key] === null || data[key] === '') return undefined;
  return requiredNumber(data, key, file, options);
}

function booleanValue(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function localImagePath(value, file) {
  if (!value.startsWith('/')) throw new Error(`${file}: pole image musi zaczynać się od „/”.`);
  const imagePath = resolve(root, 'public', value.slice(1));
  const publicRoot = resolve(root, 'public') + sep;
  if (!imagePath.startsWith(publicRoot) || !existsSync(imagePath)) {
    throw new Error(`${file}: nie znaleziono obrazu ${value}.`);
  }
  return imagePath;
}

async function uploadImage(imagePath) {
  return client.assets.upload('image', createReadStream(imagePath), {
    filename: basename(imagePath),
  });
}

async function syncArticle(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const { data, content: markdown } = matter(raw);
  const sourcePath = relative(root, filePath).replaceAll('\\', '/');
  const title = requiredText(data, 'title', sourcePath);
  const slug = requiredText(data, 'slug', sourcePath);
  const excerpt = requiredText(data, 'excerpt', sourcePath);
  const image = requiredText(data, 'image', sourcePath);
  const imageAlt = requiredText(data, 'imageAlt', sourcePath);
  const publishedAt = new Date(data.publishedAt || data.date);
  if (Number.isNaN(publishedAt.valueOf())) {
    throw new Error(`${sourcePath}: publishedAt musi być poprawną datą ISO.`);
  }

  const imagePath = localImagePath(image, sourcePath);
  const imageBuffer = readFileSync(imagePath);
  const sourceHash = createHash('sha256').update(raw).update(imageBuffer).digest('hex');
  const existing = await client.fetch(
    `*[_type == "blogPost" && !(_id in path("drafts.**")) &&
      (sourcePath == $sourcePath || slug.current == $slug)][0]{_id, sourceHash}`,
    { sourcePath, slug },
  );

  if (existing?.sourceHash === sourceHash) {
    console.log(`Bez zmian: ${sourcePath}`);
    return;
  }

  const asset = await uploadImage(imagePath);
  const document = {
    _type: 'blogPost',
    title,
    slug: { _type: 'slug', current: slug },
    excerpt,
    coverImage: {
      _type: 'image',
      asset: { _type: 'reference', _ref: asset._id },
      alt: imageAlt,
    },
    content: cleanPortableText(markdown),
    publishedAt: publishedAt.toISOString(),
    seo: {
      _type: 'object',
      title: typeof data.seoTitle === 'string' ? data.seoTitle : title,
      description: typeof data.seoDescription === 'string' ? data.seoDescription : excerpt,
    },
    sourcePath,
    sourceHash,
  };

  if (existing?._id) {
    await client.patch(existing._id).set(document).commit();
    console.log(`Zaktualizowano artykuł: ${sourcePath}`);
  } else {
    await client.create(document);
    console.log(`Utworzono artykuł: ${sourcePath}`);
  }
}

async function findCategoryReference(category, sourcePath) {
  if (!category) return undefined;
  const value = String(category).trim();
  const match = await client.fetch(
    `*[_type == "category" && !(_id in path("drafts.**")) &&
      (slug.current == $value || lower(name) == lower($value))][0]{_id}`,
    { value },
  );
  if (!match?._id) {
    throw new Error(`${sourcePath}: nie znaleziono kategorii produktu „${value}” w Sanity.`);
  }
  return { _type: 'reference', _ref: match._id };
}

async function syncProduct(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const { data, content: markdown } = matter(raw);
  const sourcePath = relative(root, filePath).replaceAll('\\', '/');
  const name = requiredText(data, 'name', sourcePath);
  const slug = requiredText(data, 'slug', sourcePath);
  const shortDescription = requiredText(data, 'shortDescription', sourcePath);
  const productType = requiredText(data, 'productType', sourcePath);
  const sku = requiredText(data, 'sku', sourcePath).toUpperCase();
  const image = requiredText(data, 'image', sourcePath);
  const imageAlt = requiredText(data, 'imageAlt', sourcePath);
  const price = requiredNumber(data, 'price', sourcePath, { integer: true, min: 1 });
  const taxRate = requiredNumber(data, 'taxRate', sourcePath, { min: 0 });

  if (!['digital', 'physical'].includes(productType)) {
    throw new Error(`${sourcePath}: productType musi mieć wartość „digital” albo „physical”.`);
  }
  if (!markdown.trim()) throw new Error(`${sourcePath}: opis produktu w treści Markdown jest pusty.`);

  const content = cleanPortableText(markdown);
  const imagePath = localImagePath(image, sourcePath);
  const imageBuffer = readFileSync(imagePath);
  const sourceHash = createHash('sha256').update(raw).update(imageBuffer).digest('hex');
  const existing = await client.fetch(
    `*[_type == "product" && !(_id in path("drafts.**")) &&
      (sourcePath == $sourcePath || sku == $sku || slug.current == $slug)][0]{_id, sourceHash}`,
    { sourcePath, sku, slug },
  );

  if (existing?.sourceHash === sourceHash) {
    console.log(`Bez zmian: ${sourcePath}`);
    return;
  }

  const category = await findCategoryReference(data.category, sourcePath);
  const asset = await uploadImage(imagePath);
  const compareAtPrice = optionalNumber(data, 'compareAtPrice', sourcePath, { integer: true, min: 1 });
  const weight = optionalNumber(data, 'weight', sourcePath, { integer: true, min: 0 });
  const document = {
    _type: 'product',
    name,
    slug: { _type: 'slug', current: slug },
    shortDescription,
    description: portableTextToPlainText(content),
    content,
    images: [
      {
        _key: 'cover',
        _type: 'image',
        asset: { _type: 'reference', _ref: asset._id },
        alt: imageAlt,
      },
    ],
    productType,
    sku,
    price,
    taxRate,
    featured: booleanValue(data.featured),
    active: booleanValue(data.active),
    seoTitle: typeof data.seoTitle === 'string' ? data.seoTitle : name,
    seoDescription:
      typeof data.seoDescription === 'string' ? data.seoDescription : shortDescription,
    sourcePath,
    sourceHash,
    ...(category ? { category } : {}),
    ...(compareAtPrice === undefined ? {} : { compareAtPrice }),
    ...(weight === undefined ? {} : { weight }),
  };

  if (existing?._id) {
    const unset = [
      ...(category ? [] : ['category']),
      ...(compareAtPrice === undefined ? ['compareAtPrice'] : []),
      ...(weight === undefined ? ['weight'] : []),
    ];
    const patch = client.patch(existing._id).set(document);
    await (unset.length ? patch.unset(unset) : patch).commit();
    console.log(`Zaktualizowano produkt: ${sourcePath}`);
  } else {
    await client.create({
      ...document,
      stock: optionalNumber(data, 'initialStock', sourcePath, { integer: true, min: 0 }) ?? 0,
    });
    console.log(`Utworzono produkt: ${sourcePath}`);
  }
}

async function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(directory, entry.name));
}

async function syncFile(filePath) {
  const sourcePath = relative(root, filePath).replaceAll('\\', '/');
  if (sourcePath.startsWith('src/content/artykuly/')) return syncArticle(filePath);
  if (sourcePath.startsWith('src/content/produkty/')) return syncProduct(filePath);
  throw new Error(`${sourcePath}: obsługiwane są tylko katalogi artykułów i produktów.`);
}

const requested = process.argv.slice(2);
const files = requested.length
  ? requested.map((file) => resolve(root, file))
  : [...(await markdownFiles(articlesDir)), ...(await markdownFiles(productsDir))];

if (!files.length) {
  console.log('Brak plików Markdown do synchronizacji.');
} else {
  for (const file of files) await syncFile(file);
}
