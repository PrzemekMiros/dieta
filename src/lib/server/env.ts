import 'dotenv/config';
export const env = (key: string, fallback = '') => process.env[key] || fallback;
export function required(key: string) {
  const value = env(key);
  if (!value) throw new Error(`Brak konfiguracji: ${key}`);
  return value;
}
export const isDemo = () =>
  env('DEMO_CATALOG', process.env.NODE_ENV === 'production' ? 'false' : 'true') === 'true' &&
  env('APP_ENV') !== 'production';
export function siteUrl() {
  return env('SITE_URL', 'http://localhost:4321').replace(/\/$/, '');
}
