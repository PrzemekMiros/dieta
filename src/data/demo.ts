import type { Product, Post } from '../lib/types';
const names = [
  'E-book: 7 dni zdrowego jedzenia',
  'Plan żywieniowy na 30 dni',
  'Zdrowe pieczywo na co dzień',
  'Chlebek pełnoziarnisty z dodatkami',
  'Bułki z dynią i siemieniem',
  'Kajzerki z mąki żytniej',
  'Pieczywo na śniadanie',
  'Zestaw zdrowych pieczyw',
  'Mieszanka do pieczywa domowego',
  'Wafle pełnoziarniste',
  'Rogaliki z dodatkami',
  'Bochenek z otrębami',
  'Mini pieczywo fit',
];
const slugs = [
  'ebook-7-dni-zdrowego-jedzenia',
  'plan-zywieniowy-30-dni',
  'zdrowe-pieczywo-na-co-dzien',
  'chlebek-pelnoziarnisty',
  'bulki-z-dynia',
  'kajzerki-zytnie',
  'pieczywo-na-sniadanie',
  'zestaw-zdrowych-pieczyw',
  'mieszanka-do-pieczywa',
  'wafle-pelnoziarniste',
  'rogaliki-z-dodatkami',
  'bochenek-z-otrębami',
  'mini-pieczywo-fit',
];
const productImages = [
  '/images/IMG_7495.png',
  '/images/IMG_8219.png',
  '/images/IMG_7423.png',
  '/images/IMG_7344.png',
  '/images/IMG_7254.png',
  '/images/IMG_5522.png',
];
export const demoProducts: Product[] = names.map((name, i) => ({
  _id: `demo-${i + 1}`,
  name,
  slug: slugs[i]!,
  sku: `DD-DEMO-${i + 1}`,
  description:
    'Przykładowa pozycja demonstracyjna. Możesz ją łatwo zastąpić rzeczywistymi ebookami lub produktami piekarniczymi w Sanity.',
  shortDescription:
    i < 3
      ? [
          'Prosty plan, który pomaga lepiej jeść bez reżimu i wyrzutów.',
          'Gotowy program na spokojną, trwałą zmianę nawyków.',
          'Zdrowy wybór na co dzień — smaczny, sycący i prosty w przygotowaniu.',
        ][i]!
      : 'Smaczne i pożywne pieczywo wspierające codzienną dietę.',
  image: productImages[i % productImages.length]!,
  price: [8900, 6900, 5900, 2900, 7900, 4900, 1900, 1200, 2400, 5900, 14900, 11900, 9900][i]!,
  productType: i < 3 ? 'digital' : 'physical',
  featured: [0, 1, 3, 12].includes(i),
  active: true,
  stock: i < 3 ? 999 : 10,
  taxRate: i < 3 ? 5 : 23,
  demo: true,
}));
export const demoPosts: Post[] = [
  {
    title: 'Dobry tort zaczyna się od planu',
    slug: 'dobry-tort-zaczyna-sie-od-planu',
    excerpt: 'Kilka spokojnych kroków, które ułatwiają domowe pieczenie.',
    image: '/images/cake-editorial.webp',
    publishedAt: '2026-11-05',
    content: [
      {
        _key: 'a',
        _type: 'block',
        children: [
          {
            text: 'Rozpisz pracę na etapy: przygotowanie składników, pieczenie, studzenie, składanie i dekorowanie. Zostaw czas na schłodzenie. Dzięki temu ostatni etap może być przyjemnością, a nie wyścigiem z zegarem.',
          },
        ],
      },
      {
        _key: 'b',
        _type: 'block',
        style: 'h2',
        children: [{ text: 'Zacznij od prostych połączeń' }],
      },
      {
        _key: 'c',
        _type: 'block',
        children: [
          {
            text: 'Wybierz jeden krem i jeden owocowy akcent. Zważ składniki przed rozpoczęciem pracy i przeczytaj cały przepis. Małe przygotowania robią dużą różnicę.',
          },
        ],
      },
    ],
  },
];
