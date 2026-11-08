import { defineMiddleware } from 'astro:middleware';
import { session } from './lib/server/security';
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname.startsWith('/admin') && context.url.pathname !== '/admin/login') {
    const user = await session(context.cookies.get('tc_admin')?.value);
    if (!user) return context.redirect('/admin/login');
  }
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (/^\/(admin|api|pobierz|zamowienie)/.test(context.url.pathname))
    response.headers.set('Cache-Control', 'no-store');
  return response;
});
