import { defineConfig, defineType, defineField } from 'sanity';
import { structureTool } from 'sanity/structure';
import 'dotenv/config';
const str = (name: string, title: string, required = false) =>
  defineField({ name, title, type: 'string', validation: (r) => (required ? r.required() : r) });
const txt = (name: string, title: string) => defineField({ name, title, type: 'text' });
const slug = defineField({
  name: 'slug',
  title: 'Adres URL',
  type: 'slug',
  options: { source: (doc) => String(doc.name || doc.title || '') },
  validation: (r) => r.required(),
});
const image = (name: string, title: string) =>
  defineField({ name, title, type: 'image', options: { hotspot: true } });
const seo = defineField({
  name: 'seo',
  type: 'object',
  fields: [str('title', 'Tytuł SEO'), txt('description', 'Opis SEO')],
});
const content = defineField({
  name: 'content',
  title: 'Treść',
  type: 'array',
  of: [
    {
      type: 'block',
      styles: [
        { title: 'Akapit', value: 'normal' },
        { title: 'Nagłówek 2', value: 'h2' },
        { title: 'Nagłówek 3', value: 'h3' },
      ],
      lists: [],
      marks: { decorators: [], annotations: [] },
    },
  ],
});
const types = [
  defineType({
    name: 'product',
    title: 'Produkty',
    type: 'document',
    fields: [
      str('name', 'Nazwa', true),
      slug,
      str('sku', 'SKU', true),
      txt('description', 'Opis'),
      txt('shortDescription', 'Krótki opis'),
      defineField({
        name: 'images',
        title: 'Zdjęcia',
        type: 'array',
        of: [{ type: 'image', options: { hotspot: true } }],
        validation: (r) => r.required().min(1),
      }),
      defineField({
        name: 'price',
        title: 'Cena brutto (grosze)',
        type: 'number',
        validation: (r) => r.required().integer().min(1),
      }),
      defineField({
        name: 'compareAtPrice',
        title: 'Cena porównawcza (grosze) — nie zastępuje najniższej ceny z 30 dni',
        type: 'number',
        validation: (r) => r.integer().min(1),
      }),
      defineField({
        name: 'taxRate',
        title: 'Stawka VAT (%) — potwierdź z księgowością',
        type: 'number',
        validation: (r) => r.required().min(0).max(100),
      }),
      defineField({
        name: 'productType',
        title: 'Typ',
        type: 'string',
        options: { list: ['digital', 'physical'] },
        validation: (r) => r.required(),
      }),
      defineField({
        name: 'category',
        title: 'Kategoria',
        type: 'reference',
        to: [{ type: 'category' }],
      }),
      defineField({ name: 'featured', title: 'Wyróżniony', type: 'boolean', initialValue: false }),
      defineField({ name: 'active', title: 'Aktywny', type: 'boolean', initialValue: false }),
      defineField({
        name: 'stock',
        title: 'Stan początkowy — dalsze zmiany w panelu zamówień',
        type: 'number',
        validation: (r) => r.integer().min(0),
        initialValue: 0,
      }),
      defineField({
        name: 'weight',
        title: 'Waga (gramy)',
        type: 'number',
        validation: (r) => r.min(0),
      }),
      str('digitalAssetReference', 'Klucz pliku w PRYWATNYM bucket S3 (nie URL)'),
      str('seoTitle', 'Tytuł SEO'),
      txt('seoDescription', 'Opis SEO'),
    ],
  }),
  defineType({
    name: 'category',
    title: 'Kategorie',
    type: 'document',
    fields: [
      str('name', 'Nazwa', true),
      slug,
      txt('description', 'Opis'),
      image('image', 'Zdjęcie'),
    ],
  }),
  defineType({
    name: 'page',
    title: 'Strony i dokumenty',
    type: 'document',
    fields: [str('title', 'Tytuł', true), slug, content, seo],
  }),
  defineType({
    name: 'homepage',
    title: 'Strona główna',
    type: 'document',
    fields: [
      str('title', 'Nazwa dokumentu'),
      str('heroTitle', 'Hero — nagłówek'),
      str('heroAccent', 'Hero — wyróżniona linia'),
      txt('heroDescription', 'Hero — opis'),
      image('heroImage', 'Hero — zdjęcie'),
      str('primaryLabel', 'Główny przycisk'),
      str('primaryHref', 'Główny link'),
      str('secondaryLabel', 'Drugi przycisk'),
      str('secondaryHref', 'Drugi link'),
      defineField({
        name: 'sections',
        title: 'Sekcje (przeciągnij, aby zmienić kolejność)',
        type: 'array',
        of: [
          {
            type: 'object',
            fields: [
              defineField({
                name: 'key',
                title: 'Rodzaj sekcji',
                type: 'string',
                options: {
                  list: [
                    'philosophy',
                    'about',
                    'categories',
                    'steps',
                    'products',
                    'testimonials',
                    'faq',
                    'newsletter',
                  ],
                },
                validation: (r) => r.required(),
              }),
              str('title', 'Nagłówek'),
              str('subtitle', 'Etykieta'),
              txt('body', 'Opis'),
              image('image', 'Zdjęcie'),
            ],
            preview: { select: { title: 'key', subtitle: 'title' } },
          },
        ],
      }),
      defineField({
        name: 'featuredProducts',
        title: 'Wyróżnione produkty',
        type: 'array',
        of: [{ type: 'reference', to: [{ type: 'product' }] }],
      }),
      defineField({
        name: 'testimonials',
        title: 'Prawdziwe opinie (z prawem publikacji)',
        type: 'array',
        of: [{ type: 'object', fields: [txt('quote', 'Opinia'), str('author', 'Autor')] }],
      }),
    ],
  }),
  defineType({
    name: 'blogPost',
    title: 'Artykuły',
    type: 'document',
    fields: [
      str('title', 'Tytuł', true),
      slug,
      image('coverImage', 'Okładka'),
      txt('excerpt', 'Zajawka'),
      content,
      defineField({ name: 'publishedAt', type: 'datetime', title: 'Data publikacji' }),
      seo,
    ],
  }),
  defineType({
    name: 'siteSettings',
    title: 'Ustawienia strony',
    type: 'document',
    fields: [
      str('title', 'Nazwa dokumentu'),
      image('logo', 'Logo'),
      str('email', 'E-mail'),
      str('phone', 'Telefon'),
      str('companyName', 'Pełna nazwa firmy'),
      txt('address', 'Adres firmy'),
      str('nip', 'NIP'),
      defineField({ name: 'instagram', type: 'url' }),
      defineField({ name: 'facebook', type: 'url' }),
      txt('deliveryInfo', 'Informacje o dostawie'),
      str('seoTitle', 'Tytuł SEO'),
      txt('seoDescription', 'Opis SEO'),
    ],
  }),
];
export default defineConfig({
  name: 'tortowe-ciocho',
  title: 'Tortowe Ciocho — treści',
  projectId:
    process.env.SANITY_STUDIO_PROJECT_ID || process.env.SANITY_PROJECT_ID || 'missingproject',
  dataset: process.env.SANITY_STUDIO_DATASET || process.env.SANITY_DATASET || 'production',
  plugins: [structureTool()],
  schema: { types },
});
