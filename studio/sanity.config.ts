import { defineConfig, defineField, defineType } from 'sanity';
import { structureTool } from 'sanity/structure';

const requiredString = (name: string, title: string, description?: string) =>
  defineField({
    name,
    title,
    description,
    type: 'string',
    validation: (rule) => rule.required(),
  });

const optionalString = (name: string, title: string, description?: string) =>
  defineField({ name, title, description, type: 'string' });

const text = (name: string, title: string, description?: string) =>
  defineField({ name, title, description, type: 'text', rows: 5 });

const slug = defineField({
  name: 'slug',
  title: 'Adres URL',
  description: 'Kliknij „Generate”, aby utworzyć adres na podstawie tytułu lub nazwy.',
  type: 'slug',
  options: {
    source: (document) => String(document.name || document.title || ''),
    maxLength: 96,
  },
  validation: (rule) => rule.required(),
});

const image = (name: string, title: string) =>
  defineField({ name, title, type: 'image', options: { hotspot: true } });

const seo = defineField({
  name: 'seo',
  title: 'SEO',
  type: 'object',
  options: { collapsible: true, collapsed: true },
  fields: [
    defineField({
      name: 'title',
      title: 'Tytuł SEO',
      type: 'string',
      validation: (rule) => rule.max(60).warning('Najlepiej nie przekraczać 60 znaków.'),
    }),
    defineField({
      name: 'description',
      title: 'Opis SEO',
      type: 'text',
      rows: 3,
      validation: (rule) => rule.max(160).warning('Najlepiej nie przekraczać 160 znaków.'),
    }),
  ],
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

const product = defineType({
  name: 'product',
  title: 'Produkty',
  type: 'document',
  groups: [
    { name: 'content', title: 'Treść', default: true },
    { name: 'commerce', title: 'Sprzedaż' },
    { name: 'media', title: 'Zdjęcia' },
    { name: 'search', title: 'SEO' },
  ],
  fields: [
    defineField({
      ...requiredString('name', 'Nazwa produktu'),
      group: 'content',
      validation: (rule) => rule.required().min(3).max(120),
    }),
    defineField({ ...slug, group: 'content' }),
    defineField({
      name: 'shortDescription',
      title: 'Krótki opis',
      description: 'Widoczny na kartach produktu i używany jako domyślny opis SEO.',
      type: 'text',
      rows: 3,
      group: 'content',
      validation: (rule) => rule.required().min(20).max(220),
    }),
    defineField({
      name: 'description',
      title: 'Pełny opis',
      type: 'text',
      rows: 8,
      group: 'content',
      validation: (rule) => rule.required().min(40),
    }),
    defineField({
      name: 'images',
      title: 'Zdjęcia',
      description: 'Pierwsze zdjęcie jest okładką produktu.',
      type: 'array',
      group: 'media',
      of: [
        {
          type: 'image',
          options: { hotspot: true },
          fields: [
            defineField({
              name: 'alt',
              title: 'Tekst alternatywny',
              type: 'string',
              validation: (rule) => rule.required(),
            }),
          ],
        },
      ],
      validation: (rule) => rule.required().min(1).max(8),
    }),
    defineField({
      name: 'productType',
      title: 'Typ produktu',
      type: 'string',
      group: 'commerce',
      options: {
        layout: 'radio',
        list: [
          { title: 'E-book / produkt cyfrowy', value: 'digital' },
          { title: 'Produkt fizyczny', value: 'physical' },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'sku',
      title: 'SKU',
      description: 'Unikalny kod produktu używany w zamówieniach.',
      type: 'string',
      group: 'commerce',
      validation: (rule) =>
        rule.required().uppercase().regex(/^[A-Z0-9][A-Z0-9._-]*$/, { name: 'SKU' }),
    }),
    defineField({
      name: 'price',
      title: 'Cena brutto (grosze)',
      description: 'Przykład: 9900 oznacza 99,00 zł.',
      type: 'number',
      group: 'commerce',
      validation: (rule) => rule.required().integer().min(1),
    }),
    defineField({
      name: 'compareAtPrice',
      title: 'Cena porównawcza (grosze)',
      description: 'Opcjonalna cena przekreślona. Nie zastępuje najniższej ceny z 30 dni.',
      type: 'number',
      group: 'commerce',
      validation: (rule) => rule.integer().min(1),
    }),
    defineField({
      name: 'taxRate',
      title: 'Stawka VAT (%)',
      description: 'Stawkę potwierdź z księgowością przed aktywacją sprzedaży.',
      type: 'number',
      group: 'commerce',
      validation: (rule) => rule.required().min(0).max(100),
    }),
    defineField({
      name: 'category',
      title: 'Kategoria',
      type: 'reference',
      group: 'content',
      to: [{ type: 'category' }],
    }),
    defineField({
      name: 'stock',
      title: 'Stan początkowy',
      description: 'Dalsze zmiany stanu produktów fizycznych wykonuj w panelu zamówień.',
      type: 'number',
      group: 'commerce',
      initialValue: 0,
      validation: (rule) => rule.required().integer().min(0),
    }),
    defineField({
      name: 'weight',
      title: 'Waga (gramy)',
      type: 'number',
      group: 'commerce',
      hidden: ({ document }) => document?.productType !== 'physical',
      validation: (rule) => rule.integer().min(0),
    }),
    defineField({
      name: 'digitalAssetReference',
      title: 'Klucz pliku w prywatnym bucket S3',
      description: 'Wpisz klucz obiektu, nigdy publiczny URL.',
      type: 'string',
      group: 'commerce',
      hidden: ({ document }) => document?.productType !== 'digital',
      validation: (rule) =>
        rule.custom((value, context) => {
          const document = context.document as { active?: boolean; productType?: string } | undefined;
          return document?.active && document.productType === 'digital' && !value
            ? 'Aktywny produkt cyfrowy musi wskazywać plik w prywatnym bucket S3.'
            : true;
        }),
    }),
    defineField({
      name: 'featured',
      title: 'Wyróżniony na stronie głównej',
      type: 'boolean',
      group: 'content',
      initialValue: false,
    }),
    defineField({
      name: 'active',
      title: 'Widoczny i dostępny w sklepie',
      type: 'boolean',
      group: 'commerce',
      initialValue: false,
    }),
    defineField({
      name: 'seoTitle',
      title: 'Tytuł SEO',
      type: 'string',
      group: 'search',
      validation: (rule) => rule.max(60).warning('Najlepiej nie przekraczać 60 znaków.'),
    }),
    defineField({
      name: 'seoDescription',
      title: 'Opis SEO',
      type: 'text',
      rows: 3,
      group: 'search',
      validation: (rule) => rule.max(160).warning('Najlepiej nie przekraczać 160 znaków.'),
    }),
  ],
  orderings: [
    { title: 'Nazwa A–Z', name: 'nameAsc', by: [{ field: 'name', direction: 'asc' }] },
    { title: 'Cena rosnąco', name: 'priceAsc', by: [{ field: 'price', direction: 'asc' }] },
  ],
  preview: {
    select: { title: 'name', sku: 'sku', productType: 'productType', media: 'images.0' },
    prepare: ({ title, sku, productType, media }) => ({
      title,
      subtitle: `${productType === 'digital' ? 'E-book' : 'Produkt fizyczny'} · ${sku || 'brak SKU'}`,
      media,
    }),
  },
});

const blogPost = defineType({
  name: 'blogPost',
  title: 'Wpisy blogowe',
  type: 'document',
  groups: [
    { name: 'content', title: 'Treść', default: true },
    { name: 'search', title: 'SEO' },
  ],
  fields: [
    defineField({
      name: 'title',
      title: 'Tytuł',
      type: 'string',
      group: 'content',
      validation: (rule) => rule.required().min(5).max(120),
    }),
    defineField({ ...slug, group: 'content' }),
    defineField({
      name: 'sourcePath',
      title: 'Plik źródłowy',
      type: 'string',
      group: 'content',
      readOnly: true,
      hidden: true,
    }),
    defineField({
      name: 'sourceHash',
      title: 'Suma kontrolna źródła',
      type: 'string',
      group: 'content',
      readOnly: true,
      hidden: true,
    }),
    defineField({
      name: 'excerpt',
      title: 'Zajawka',
      description: 'Krótki opis widoczny na liście artykułów i używany domyślnie przez SEO.',
      type: 'text',
      rows: 3,
      group: 'content',
      validation: (rule) => rule.required().min(30).max(240),
    }),
    defineField({
      name: 'coverImage',
      title: 'Okładka',
      type: 'image',
      group: 'content',
      options: { hotspot: true },
      fields: [
        defineField({
          name: 'alt',
          title: 'Tekst alternatywny',
          type: 'string',
          validation: (rule) => rule.required(),
        }),
      ],
      validation: (rule) => rule.required(),
    }),
    defineField({
      ...content,
      group: 'content',
      validation: (rule) => rule.required().min(1),
    }),
    defineField({
      name: 'publishedAt',
      title: 'Data publikacji',
      description: 'Wpis pojawi się na stronie, gdy ta data nie będzie późniejsza niż bieżąca.',
      type: 'datetime',
      group: 'content',
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required(),
    }),
    defineField({ ...seo, group: 'search' }),
  ],
  orderings: [
    {
      title: 'Najnowsze',
      name: 'publishedAtDesc',
      by: [{ field: 'publishedAt', direction: 'desc' }],
    },
  ],
  preview: {
    select: { title: 'title', publishedAt: 'publishedAt', media: 'coverImage' },
    prepare: ({ title, publishedAt, media }) => ({
      title,
      subtitle: publishedAt
        ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(publishedAt))
        : 'Brak daty publikacji',
      media,
    }),
  },
});

const types = [
  product,
  defineType({
    name: 'category',
    title: 'Kategorie produktów',
    type: 'document',
    fields: [requiredString('name', 'Nazwa'), slug, text('description', 'Opis'), image('image', 'Zdjęcie')],
  }),
  defineType({
    name: 'page',
    title: 'Strony i dokumenty',
    type: 'document',
    fields: [requiredString('title', 'Tytuł'), slug, content, seo],
  }),
  defineType({
    name: 'homepage',
    title: 'Strona główna',
    type: 'document',
    fields: [
      optionalString('title', 'Nazwa dokumentu'),
      optionalString('heroTitle', 'Hero — nagłówek'),
      optionalString('heroAccent', 'Hero — wyróżniona linia'),
      text('heroDescription', 'Hero — opis'),
      image('heroImage', 'Hero — zdjęcie'),
      optionalString('primaryLabel', 'Główny przycisk'),
      optionalString('primaryHref', 'Główny link'),
      optionalString('secondaryLabel', 'Drugi przycisk'),
      optionalString('secondaryHref', 'Drugi link'),
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
                validation: (rule) => rule.required(),
              }),
              optionalString('title', 'Nagłówek'),
              optionalString('subtitle', 'Etykieta'),
              text('body', 'Opis'),
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
        of: [{ type: 'object', fields: [text('quote', 'Opinia'), optionalString('author', 'Autor')] }],
      }),
    ],
  }),
  blogPost,
  defineType({
    name: 'siteSettings',
    title: 'Ustawienia strony',
    type: 'document',
    fields: [
      optionalString('title', 'Nazwa dokumentu'),
      image('logo', 'Logo'),
      optionalString('email', 'E-mail'),
      optionalString('phone', 'Telefon'),
      optionalString('companyName', 'Pełna nazwa firmy'),
      text('address', 'Adres firmy'),
      optionalString('nip', 'NIP'),
      defineField({ name: 'instagram', title: 'Instagram', type: 'url' }),
      defineField({ name: 'facebook', title: 'Facebook', type: 'url' }),
      text('deliveryInfo', 'Informacje o dostawie'),
      optionalString('seoTitle', 'Tytuł SEO'),
      text('seoDescription', 'Opis SEO'),
    ],
  }),
];

export default defineConfig({
  name: 'dietetyka_dla_smyka',
  title: 'Dietetyka dla Smyka',
  projectId: 'fip0o8g2',
  dataset: 'production',
  plugins: [
    structureTool({
      structure: (structure) =>
        structure
          .list()
          .title('Treści')
          .items([
            structure.documentTypeListItem('product').title('Produkty'),
            structure.documentTypeListItem('blogPost').title('Wpisy blogowe'),
            structure.divider(),
            ...structure
              .documentTypeListItems()
              .filter((item) => !['product', 'blogPost'].includes(item.getId() || '')),
          ]),
    }),
  ],
  schema: { types },
});
