import type { APIRoute } from 'astro';
import { products, posts } from '../lib/catalog';
import { siteUrl, isDemo } from '../lib/server/env';
export const GET: APIRoute = async () => {
  const [catalog, articles] = await Promise.all([products(), posts()]);
  const paths = isDemo()
    ? []
    : [
        '/',
        '/sklep',
        '/ebooki',
        '/produkty',
        '/o-nas',
        '/kontakt',
        '/blog',
        '/regulamin',
        '/polityka-prywatnosci',
        '/dostawa-i-zwroty',
        ...catalog.map((p) => `/produkt/${encodeURIComponent(p.slug)}`),
        ...articles.map((p) => `/blog/${encodeURIComponent(p.slug)}`),
      ];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${(siteUrl() + path).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</loc></url>`).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
};
