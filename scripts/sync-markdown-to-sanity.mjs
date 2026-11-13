import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { createClient } from '@sanity/client';
import { markdownToPortableText } from '@portabletext/markdown';
import matter from 'gray-matter';

const root = resolve(import.meta.dirname, '..');
const articlesDir = join(root, 'src', 'content', 'artykuly');
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
    .map((block) => ({
      ...block,
      style: allowedStyles.has(block.style) ? block.style : 'normal',
      markDefs: [],
      children: (block.children || []).map((child) => ({ ...child, marks: [] })),
      listItem: undefined,
      level: undefined,
    }))
    .map(({ listItem, level, ...block }) => block);
}

function requiredText(data, key, file) {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${file}: brak wymaganego pola frontmatter „${key}”.`);
  }
  return value.trim();
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

async function syncFile(filePath) {
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

  const asset = await client.assets.upload('image', createReadStream(imagePath), {
    filename: basename(imagePath),
  });
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
    console.log(`Zaktualizowano: ${sourcePath}`);
  } else {
    await client.create(document);
    console.log(`Utworzono: ${sourcePath}`);
  }
}

const requested = process.argv.slice(2);
const files = requested.length
  ? requested.map((file) => resolve(root, file))
  : (await readdir(articlesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(articlesDir, entry.name));

if (!files.length) {
  console.log('Brak plików Markdown do synchronizacji.');
} else {
  for (const file of files) await syncFile(file);
}
