import type { APIRoute } from 'astro';
import { isDemo, siteUrl } from '../lib/server/env';
export const GET: APIRoute = () =>
  new Response(
    isDemo()
      ? 'User-agent: *\nDisallow: /'
      : `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nDisallow: /koszyk\nDisallow: /zamowienie\nDisallow: /pobierz\nSitemap: ${siteUrl()}/sitemap.xml`,
    { headers: { 'Content-Type': 'text/plain' } },
  );
